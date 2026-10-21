import { session } from 'electron';
import type { ChatMessage, PageInfo, SubtitleLine } from '../shared/types';
import { activePlatform, loadSettings } from './settings';
import { buildTranscript } from './ai';
import { glossaryTerms } from './correction';

const MAX_HISTORY = 16;
const REQUEST_TIMEOUT_MS = 300000;

export interface ChatOptions {
  info: PageInfo;
  lines: SubtitleLine[];
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

function errorForStatus(status: number, body: string): string {
  if (status === 401 || status === 403) return 'API Key 无效或没有权限（401/403）';
  if (status === 404) return '地址或模型不存在（404）';
  if (status === 429) return '请求过于频繁或额度不足（429）';
  if (status >= 500) return `服务端错误（${status}）`;
  return `请求失败（HTTP ${status}）：${body.slice(0, 200)}`;
}

export async function chat(options: ChatOptions): Promise<{ text: string; model: string }> {
  const settings = loadSettings();
  const platform = activePlatform(settings);
  if (!platform || !platform.baseUrl.trim()) throw new Error('请先在设置里选择一个 AI 平台');
  if (!platform.model.trim()) throw new Error('请先在设置里填写模型名');
  if (!platform.apiKey.trim()) throw new Error('请先在设置里填写 API Key');

  const transcript = buildTranscript(options.info, options.lines);
  if (!transcript.trim()) throw new Error('没有可用的字幕内容');

  const glossary = glossaryTerms(settings);
  const glossaryBlock = glossary.length
    ? `\n\n术语表（回答时统一使用以下写法）：\n${glossary
        .slice(0, 80)
        .map((term) => `- ${term.from} → ${term.to}${term.note ? `（${term.note}）` : ''}`)
        .join('\n')}`
    : '';

  const system = [
    settings.prompt.chat,
    glossaryBlock,
    `视频标题：${options.info.title || '未知'}`,
    `UP 主：${options.info.owner || '未知'}`
  ]
    .filter(Boolean)
    .join('\n\n');

  const history = options.messages
    .slice(-MAX_HISTORY)
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').slice(0, 4000)
    }));

  const messages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `以下是当前视频的字幕（带时间戳），请作为回答依据：\n\n${transcript}`
    },
    ...history
  ];

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
        messages
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
          // 忽略非 JSON 行
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
