import { app, session } from 'electron';
import type { WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import type {
  AppSettings,
  AsrPlatform,
  AsrSettings,
  PageInfo,
  SubtitleLine
} from '../shared/types';
import { fetchAudioRange, getAudioCandidates } from './page';
import { loadSettings } from './settings';
import { needsApiKey } from './platformKey';
import { applyCorrectionToLines } from './correction';

const CHUNK_BYTES = 384 * 1024;

type Progress = (stage: 'prepare' | 'download' | 'convert' | 'transcribe' | 'merge', percent: number, message: string) => void;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('已终止');
    error.name = 'AbortError';
    throw error;
  }
}

function activeAsr(settings: AppSettings): AsrPlatform {
  const platform =
    settings.asr.platforms.find((item) => item.id === settings.asr.activeId) ||
    settings.asr.platforms[0];
  if (!platform) throw new Error('没有可用的语音识别平台');
  if (!platform.baseUrl.trim()) throw new Error('语音识别平台缺少 Base URL');
  if (!platform.model.trim()) throw new Error('语音识别平台缺少模型名');
  if (needsApiKey(platform) && !platform.apiKey.trim()) throw new Error('语音识别平台还没填 API Key');
  return platform;
}

async function fetchAsr(
  url: string,
  init: RequestInit,
  timeoutSeconds: number,
  outerSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('语音识别超时')),
    Math.max(30, timeoutSeconds || 120) * 1000
  );
  const forward = () => controller.abort();
  outerSignal?.addEventListener('abort', forward, { once: true });
  try {
    return await session.defaultSession.fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', forward);
  }
}

function ffmpegPath(): string {
  if (!ffmpegStatic) throw new Error('没有找到 ffmpeg');
  return app.isPackaged ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : ffmpegStatic;
}

function totalFromContentRange(value: string): number {
  const match = /\/(\d+)\s*$/.exec(String(value || ''));
  return match ? Number(match[1]) || 0 : 0;
}

function chooseFormat(platform: AsrPlatform, settings: AsrSettings): 'm4a' | 'wav' {
  if (platform.audioFormat && platform.audioFormat !== 'auto') return platform.audioFormat;
  if (settings.audioFormat !== 'auto') return settings.audioFormat;
  const model = platform.model;
  // 实测：SenseVoice 只吃 M4A；带时间戳/部分中文模型只吃 WAV。
  if (/XingChenASR|Diarize|GSR|TeleSpeech/i.test(model)) return 'wav';
  return 'm4a';
}

async function downloadAudio(
  wc: WebContents,
  info: PageInfo,
  dir: string,
  onProgress: Progress,
  signal?: AbortSignal
): Promise<string> {
  onProgress('download', 0, '获取音轨候选…');
  const candidates = await getAudioCandidates(wc, info);
  let lastError: unknown = null;

  for (const candidate of candidates.slice(0, 5)) {
    const urls = [candidate.url, ...(candidate.backupUrl || [])];
    for (const url of urls.slice(0, 3)) {
      throwIfAborted(signal);
      const file = path.join(dir, 'audio.m4s');
      try {
        fs.rmSync(file, { force: true });
        const head = await fetchAudioRange(wc, url, 0, 0);
        const total = totalFromContentRange(head.contentRange);
        const stream = fs.createWriteStream(file);
        let received = 0;

        const write = (buffer: Buffer) =>
          new Promise<void>((resolve, reject) => {
            stream.write(buffer, (error) => (error ? reject(error) : resolve()));
          });

        try {
          if (total > 0) {
            for (let start = 0; start < total; start += CHUNK_BYTES) {
              throwIfAborted(signal);
              const end = Math.min(total - 1, start + CHUNK_BYTES - 1);
              const part = await fetchAudioRange(wc, url, start, end);
              if (!part.bytes.length) break;
              await write(part.bytes);
              received += part.bytes.length;
              onProgress(
                'download',
                Math.min(99, (received / total) * 100),
                `下载音轨 ${(received / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`
              );
            }
          } else {
            for (let start = 0; ; start += CHUNK_BYTES) {
              throwIfAborted(signal);
              const part = await fetchAudioRange(wc, url, start, start + CHUNK_BYTES - 1);
              if (!part.bytes.length) break;
              await write(part.bytes);
              received += part.bytes.length;
              onProgress('download', 0, `下载音轨 ${(received / 1024 / 1024).toFixed(1)} MB`);
            }
          }
        } finally {
          await new Promise<void>((resolve) => stream.end(resolve));
        }

        if (!received) throw new Error('音轨为空');
        onProgress('download', 100, `音轨下载完成（${(received / 1024 / 1024).toFixed(1)} MB）`);
        return file;
      } catch (error) {
        lastError = error;
        try {
          fs.rmSync(file, { force: true });
        } catch {
          // ignore
        }
        if ((error as Error).name === 'AbortError') throw error;
      }
    }
  }

  throw new Error(`音轨下载失败：${(lastError as Error)?.message || '所有候选都不可用'}`);
}

async function runFfmpeg(
  args: string[],
  duration: number,
  onProgress: Progress,
  signal: AbortSignal | undefined,
  label: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, { windowsHide: true });
    let stderr = '';
    let settled = false;
    const abort = () => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
    };
    signal?.addEventListener('abort', abort, { once: true });

    proc.stdout.on('data', (chunk) => {
      const text = String(chunk);
      const match = /out_time_ms=(\d+)/.exec(text);
      if (match && duration > 0) {
        const percent = Math.min(99, (Number(match[1]) / 1e6 / duration) * 100);
        onProgress('convert', percent, `${label} ${Math.round(percent)}%`);
      }
    });
    proc.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-3000);
    });
    proc.on('error', (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      reject(error);
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(new Error('已终止'));
      else if (code === 0) resolve();
      else reject(new Error(`音频转换失败（ffmpeg ${code}）：${stderr.slice(-300)}`));
    });
  });
}

async function convertToChunks(
  input: string,
  format: 'm4a' | 'wav',
  settings: AsrSettings,
  duration: number,
  dir: string,
  chunkSeconds: number,
  onProgress: Progress,
  signal?: AbortSignal
): Promise<string[]> {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('chunk-')) {
      try {
        fs.rmSync(path.join(dir, name), { force: true });
      } catch {
        // ignore
      }
    }
  }
  const ext = format === 'wav' ? 'wav' : 'm4a';
  const codec =
    format === 'wav'
      ? ['-c:a', 'pcm_s16le']
      : ['-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart'];
  const overlap = Math.max(
    0,
    Math.min(settings.overlapSeconds || 0, Math.max(0, chunkSeconds - 1))
  );

  if (overlap > 0 && duration > 0) {
    const step = Math.max(1, chunkSeconds - overlap);
    const count = Math.max(1, Math.ceil(duration / step));
    for (let index = 0; index < count; index += 1) {
      const start = index * step;
      if (start >= duration) break;
      const sliceDuration = Math.min(chunkSeconds, duration - start);
      const output = path.join(dir, `chunk-${String(index).padStart(3, '0')}.${ext}`);
      const args = [
        '-y',
        '-ss',
        String(start),
        '-i',
        input,
        '-t',
        String(sliceDuration),
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        ...codec,
        '-progress',
        'pipe:1',
        '-nostats',
        output
      ];
      await runFfmpeg(
        args,
        sliceDuration,
        (stage, percent, message) =>
          onProgress(
            'convert',
            Math.min(99, ((index + percent / 100) / count) * 100),
            message
          ),
        signal,
        `切片 ${index + 1}/${count}`
      );
    }
  } else {
    const pattern = path.join(dir, `chunk-%03d.${ext}`);
    const args = [
      '-y',
      '-i',
      input,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      ...codec,
      '-f',
      'segment',
      '-segment_time',
      String(chunkSeconds),
      '-reset_timestamps',
      '1',
      '-progress',
      'pipe:1',
      '-nostats',
      pattern
    ];
    onProgress('convert', 0, '解码并切分音频…');
    await runFfmpeg(args, duration, onProgress, signal, '解码音频');
  }

  const files = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('chunk-') && name.endsWith(`.${ext}`))
    .sort()
    .map((name) => path.join(dir, name));
  if (!files.length) throw new Error('音频切片为空');
  return files;
}

class TransportError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function parseSegments(json: any): Array<{ start: number; end: number; text: string }> {
  const rows = Array.isArray(json?.segments)
    ? json.segments
    : Array.isArray(json?.result?.segments)
      ? json.result.segments
      : [];
  return rows
    .map((item: any) => ({
      start: Number(item.start ?? item.start_time ?? 0) || 0,
      end: Number(item.end ?? item.end_time ?? 0) || 0,
      text: String(item.text || item.content || '').trim()
    }))
    .filter((item: any) => item.text);
}

async function transcribeChunk(
  platform: AsrPlatform,
  buffer: Buffer,
  format: 'm4a' | 'wav',
  settings: AsrSettings,
  signal?: AbortSignal
): Promise<{ text: string; segments: Array<{ start: number; end: number; text: string }> }> {
  const base = platform.baseUrl.replace(/\/+$/, '');
  const key = platform.apiKey.trim();
  const ext = format === 'wav' ? 'wav' : 'm4a';
  const mime = format === 'wav' ? 'audio/wav' : 'audio/mp4';
  const language = settings.language === 'auto' ? '' : settings.language;
  const fullParams =
    platform.paramStyle === 'minimal'
      ? false
      : platform.paramStyle === 'full'
        ? true
        : !/siliconflow/i.test(base);
  const preferred =
    platform.transport && platform.transport !== 'auto'
      ? platform.transport
      : settings.transport;
  const transports: Array<'multipart' | 'base64-json' | 'chat-audio'> =
    preferred === 'auto'
      ? ['multipart', 'base64-json', 'chat-audio']
      : [
          preferred,
          ...(['multipart', 'base64-json', 'chat-audio'] as const).filter(
            (item) => item !== preferred
          )
        ];

  let lastError: unknown = null;
  for (const transport of transports) {
    throwIfAborted(signal);
    try {
      let body: BodyInit;
      const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};

      if (transport === 'multipart') {
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), `chunk.${ext}`);
        form.append('model', platform.model);
        // 显式选了语言就发给平台；minimal 平台（硅基流动）只发 file+model，
        // 但用户明确指定语言时仍应尊重设置。
        if (language && (fullParams || settings.language !== 'auto')) {
          form.append('language', language);
        }
        if (fullParams) form.append('response_format', 'verbose_json');
        body = form;
      } else if (transport === 'base64-json') {
        headers['content-type'] = 'application/json';
        body = JSON.stringify({
          model: platform.model,
          audio: buffer.toString('base64'),
          ...(language ? { language } : {})
        });
      } else {
        headers['content-type'] = 'application/json';
        body = JSON.stringify({
          model: platform.model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_audio',
                  input_audio: {
                    data: `data:${mime};base64,${buffer.toString('base64')}`,
                    format: ext
                  }
                },
                { type: 'text', text: '请转写这段音频，只输出转写文本。' }
              ]
            }
          ]
        });
      }

      const response = await fetchAsr(
        `${base}/audio/transcriptions`,
        { method: 'POST', headers, body },
        settings.timeoutSeconds,
        signal
      );
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new TransportError(`HTTP ${response.status}：${text.slice(0, 160)}`, response.status);
      }
      const json: any = await response.json();
      const text = String(
        json?.text ?? json?.result?.text ?? json?.choices?.[0]?.message?.content ?? ''
      ).trim();
      if (!text) throw new Error('语音识别返回为空');
      return { text, segments: parseSegments(json) };
    } catch (error) {
      lastError = error;
      if ((error as Error).name === 'AbortError') throw error;
      if (error instanceof TransportError && ![400, 415, 422].includes(error.status)) {
        throw error;
      }
    }
  }
  throw new Error(`语音识别失败：${(lastError as Error)?.message || '所有传输方式都失败'}`);
}

function splitText(text: string, max = 60): string[] {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const pieces = clean.split(/(?<=[。！？!?；;])/);
  const lines: string[] = [];
  let buffer = '';
  for (const piece of pieces) {
    if (!piece) continue;
    if (buffer && buffer.length + piece.length > max) {
      lines.push(buffer.trim());
      buffer = '';
    }
    if (piece.length > max) {
      for (let index = 0; index < piece.length; index += max) {
        lines.push(piece.slice(index, index + max).trim());
      }
    } else {
      buffer += piece;
    }
  }
  if (buffer.trim()) lines.push(buffer.trim());
  return lines.filter(Boolean);
}

function mergeChunks(
  results: Array<{ text: string; segments: Array<{ start: number; end: number; text: string }> }>,
  chunkSeconds: number,
  duration: number,
  overlapSeconds = 0
): SubtitleLine[] {
  const lines: SubtitleLine[] = [];
  const step = Math.max(1, chunkSeconds - Math.max(0, overlapSeconds));
  results.forEach((result, index) => {
    const offset = index * step;
    const dropBefore = index > 0 ? offset + Math.max(0, overlapSeconds) * 0.5 : -1;
    if (result.segments.length) {
      for (const segment of result.segments) {
        const start = offset + Math.max(0, segment.start);
        if (start < dropBefore) continue;
        lines.push({
          start,
          end: offset + Math.max(segment.start + 0.3, segment.end || segment.start + 2),
          text: segment.text
        });
      }
      return;
    }

    const texts = splitText(result.text);
    if (!texts.length) return;
    const available = Math.max(
      1,
      duration > 0 ? Math.min(chunkSeconds, duration - offset) : chunkSeconds
    );
    const weights = texts.map((text) => Math.max(1, text.length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    let cursor = 0;
    texts.forEach((text, textIndex) => {
      const span = available * (weights[textIndex] / totalWeight);
      lines.push({
        start: offset + cursor,
        end: offset + cursor + Math.max(0.5, span),
        text
      });
      cursor += span;
    });
  });

  return lines
    .filter((line) => line.text.trim())
    .sort((a, b) => a.start - b.start)
    .filter((line, index, all) => index === 0 || line.text !== all[index - 1].text);
}

export async function transcribeFile(
  input: string,
  info: PageInfo,
  onProgress: Progress,
  signal?: AbortSignal,
  settingsOverride?: AppSettings
): Promise<{ lines: SubtitleLine[]; model: string; duration: number }> {
  const settings = settingsOverride || loadSettings();
  const platform = activeAsr(settings);
  const format = chooseFormat(platform, settings.asr);
  const dir = path.dirname(input);

  let chunkSeconds = settings.asr.chunkSeconds;
  let chunks: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    chunks = await convertToChunks(
      input,
      format,
      settings.asr,
      info.duration,
      dir,
      chunkSeconds,
      onProgress,
      signal
    );
    const limit = Math.max(1, settings.asr.maxFileMb) * 1024 * 1024;
    const largest = chunks.reduce((max, file) => Math.max(max, fs.statSync(file).size), 0);
    if (!largest || largest <= limit) break;
    if (attempt === 2) {
      onProgress('convert', 100, `单段仍超过 ${settings.asr.maxFileMb}MB，继续识别`);
      break;
    }
    chunkSeconds = Math.max(20, Math.floor(chunkSeconds * 0.7));
    onProgress('convert', 0, `单段过大，缩小到 ${chunkSeconds}s 重试…`);
  }
  onProgress('transcribe', 0, `识别音频（${chunks.length} 段）…`);

  const results: Array<{
    text: string;
    segments: Array<{ start: number; end: number; text: string }>;
  }> = new Array(chunks.length);
  let next = 0;
  let done = 0;

  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= chunks.length) return;
      throwIfAborted(signal);
      const buffer = fs.readFileSync(chunks[index]);
      results[index] = await transcribeChunk(platform, buffer, format, settings.asr, signal);
      done += 1;
      onProgress(
        'transcribe',
        (done / chunks.length) * 100,
        `识别音频 ${done} / ${chunks.length}`
      );
    }
  };

  const workers = Math.min(
    Math.max(1, settings.asr.concurrency),
    chunks.length
  );
  await Promise.all(Array.from({ length: workers }, () => worker()));

  onProgress('merge', 0, '合并转写结果…');
  const lines = mergeChunks(results, chunkSeconds, info.duration, settings.asr.overlapSeconds);
  if (!lines.length) throw new Error('语音识别没有返回可用文本');
  onProgress('merge', 100, `转写完成，共 ${lines.length} 行`);
  return { lines, model: platform.model, duration: info.duration };
}

export async function transcribe(
  wc: WebContents,
  info: PageInfo,
  onProgress: Progress,
  signal?: AbortSignal
): Promise<{ lines: SubtitleLine[]; model: string; duration: number }> {
  const settings = loadSettings();
  activeAsr(settings);
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'bsub-asr-'));
  try {
    const input = await downloadAudio(wc, info, dir, onProgress, signal);
    const result = await transcribeFile(input, info, onProgress, signal, settings);
    return { ...result, lines: applyCorrectionToLines(result.lines, settings) };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
