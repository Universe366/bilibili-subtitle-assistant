import type { AppSettings, SubtitleLine } from '../shared/types';
import { activePlatform, loadSettings } from './settings';
import { chatOnce } from './aiClient';

const MAX_BATCH_LINES = 40;
const MAX_BATCH_CHARS = 6000;
const REQUEST_TIMEOUT_MS = 180000;

type Progress = (percent: number, message: string) => void;

function batchesOf(lines: SubtitleLine[]): SubtitleLine[][] {
  const batches: SubtitleLine[][] = [];
  let current: SubtitleLine[] = [];
  let chars = 0;
  for (const line of lines) {
    const length = line.text.length + 8;
    if (current.length >= MAX_BATCH_LINES || (current.length && chars + length > MAX_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(line);
    chars += length;
  }
  if (current.length) batches.push(current);
  return batches;
}

function parseTranslatedLines(raw: string, expected: number): string[] {
  const text = String(raw || '').replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const json = JSON.parse(text.slice(start, end + 1));
      const rows = Array.isArray(json?.lines)
        ? json.lines
        : Array.isArray(json?.translations)
          ? json.translations
          : null;
      if (rows) {
        return Array.from({ length: expected }, (_, index) => String(rows[index] ?? ''));
      }
    } catch {
      // 继续按行解析
    }
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+\s*[.、:：)\]]\s*/, '').trim())
    .filter(Boolean);
  return Array.from({ length: expected }, (_, index) => lines[index] || '');
}

export async function translateLines(
  lines: SubtitleLine[],
  target: string,
  onProgress: Progress,
  signal?: AbortSignal,
  settingsOverride?: AppSettings
): Promise<{ lines: SubtitleLine[]; language: string }> {
  const settings = settingsOverride || loadSettings();
  const platform = activePlatform(settings);
  if (!platform || !platform.baseUrl.trim()) throw new Error('请先在设置里选择一个 AI 平台');
  if (!platform.model.trim()) throw new Error('请先在设置里填写模型名');
  if (!platform.apiKey.trim()) throw new Error('请先在设置里填写 API Key');
  if (!lines.length) throw new Error('没有可翻译的字幕');

  const batches = batchesOf(lines);
  const translated: string[] = [];

  for (let index = 0; index < batches.length; index += 1) {
    if (signal?.aborted) throw new Error('已终止');
    const batch = batches[index];
    const numbered = batch.map((line, lineIndex) => `${lineIndex + 1}. ${line.text}`).join('\n');
    onProgress(
      (index / batches.length) * 100,
      `翻译第 ${index + 1} / ${batches.length} 批（${batch.length} 行）`
    );

    const result = await chatOnce(
      platform,
      [
        {
          role: 'system',
          content: `${settings.prompt.translate}\n\n目标语言：${target}`
        },
        {
          role: 'user',
          content: `共 ${batch.length} 条字幕，请逐条翻译：\n${numbered}`
        }
      ],
      {
        temperature: 0.2,
        maxTokens: settings.ai.maxTokens || undefined,
        timeoutMs: REQUEST_TIMEOUT_MS,
        signal
      }
    );

    const rows = parseTranslatedLines(result.text, batch.length);
    if (!rows.some(Boolean)) throw new Error('AI 没有返回可解析的译文');
    for (let lineIndex = 0; lineIndex < batch.length; lineIndex += 1) {
      translated.push(rows[lineIndex] || batch[lineIndex].text);
    }
  }

  onProgress(100, `翻译完成，共 ${translated.length} 行`);
  return {
    language: target,
    lines: lines.map((line, index) => ({
      ...line,
      text: translated[index] || line.text
    }))
  };
}
