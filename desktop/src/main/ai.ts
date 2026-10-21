import { session } from 'electron';
import type { AiPlatform, PageInfo, SubtitleLine } from '../shared/types';
import { activePlatform, activePrompt, loadSettings } from './settings';

const MAX_TRANSCRIPT_CHARS = 30000;
const REQUEST_TIMEOUT_MS = 300000;

export interface SummarizeOptions {
  info: PageInfo;
  lines: SubtitleLine[];
  platform?: AiPlatform;
  prompt?: string;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function buildTranscript(info: PageInfo, lines: SubtitleLine[]): string {
  let text = lines.map((line) => `[${clock(line.start)}] ${line.text}`).join('\n');
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    const head = text.slice(0, MAX_TRANSCRIPT_CHARS - 6000);
    const tail = text.slice(-5000);
    text = `${head}\n…（中间字幕过长，已省略）…\n${tail}`;
  }
  return text;
}

function errorForStatus(status: number, body: string): string {
  if (status === 401 || status === 403) return 'API Key 无效或没有权限（401/403）';
  if (status === 404) return '地址或模型不存在（404）';
  if (status === 429) return '请求过于频繁或额度不足（429）';
  if (status >= 500) return `服务端错误（${status}）`;
  return `请求失败（HTTP ${status}）：${body.slice(0, 200)}`;
}

export async function summarize(options: SummarizeOptions): Promise<{ text: string; model: string }> {
  const settings = loadSettings();
  const platform = options.platform || activePlatform(settings);
  const template = activePrompt(settings);
  const prompt = options.prompt || template.text;

  if (!platform || !platform.baseUrl.trim()) throw new Error('请先在设置里选择一个 AI 平台');
  if (!platform.model.trim()) throw new Error('请先在设置里填写模型名');
  if (!platform.apiKey.trim()) throw new Error('请先在设置里填写 API Key');

  const info = options.info;
  const transcript = buildTranscript(info, options.lines);
  if (!transcript.trim()) throw new Error('没有可用的字幕内容');

  const userContent = [
    `视频标题：${info.title || '未知'}`,
    `UP 主：${info.owner || '未知'}`,
    `视频时长：${clock(info.duration)}`,
    `链接：${info.url || ''}`,
    '',
    '字幕（带时间戳）：',
    transcript
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('AI 请求超时（5 分钟）')), REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    const base = platform.baseUrl.replace(/\/+$/, '');
    const response = await session.defaultSession.fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${platform.apiKey.trim()}`
      },
      body: JSON.stringify({
        model: platform.model.trim(),
        stream: settings.ai.stream !== false,
        temperature: settings.ai.temperature,
        max_tokens: settings.ai.maxTokens || undefined,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: userContent }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(errorForStatus(response.status, body));
    }

    const contentType = response.headers.get('content-type') || '';
    if (!response.body || !contentType.includes('text/event-stream')) {
      const json: any = await response.json();
      const text = String(json?.choices?.[0]?.message?.content || '');
      if (!text.trim()) throw new Error('AI 返回为空');
      options.onDelta?.(text);
      return { text, model: platform.model };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let finished = false;

    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const rawLine = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!rawLine.startsWith('data:')) continue;
        const data = rawLine.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') {
          finished = true;
          break;
        }
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.text ?? '';
          if (typeof delta === 'string' && delta) {
            text += delta;
            options.onDelta?.(delta);
          }
        } catch {
          // 忽略非 JSON 的 data 行
        }
      }
    }

    if (!text.trim()) throw new Error('AI 返回为空');
    return { text, model: platform.model };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}
