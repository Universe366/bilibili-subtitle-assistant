import { session } from 'electron';
import type { Chapter, PageInfo, SubtitleLine } from '../shared/types';
import { activePlatform, loadSettings } from './settings';
import { buildTranscript } from './ai';

const REQUEST_TIMEOUT_MS = 180000;

function errorForStatus(status: number, body: string): string {
  if (status === 401 || status === 403) return 'API Key 无效或没有权限（401/403）';
  if (status === 404) return '地址或模型不存在（404）';
  if (status === 429) return '请求过于频繁或额度不足（429）';
  if (status >= 500) return `服务端错误（${status}）`;
  return `请求失败（HTTP ${status}）：${body.slice(0, 200)}`;
}

function parseTime(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  const text = String(value || '').trim();
  if (!text) return 0;
  const parts = text.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Math.max(0, Number(text) || 0);
}

function parseChapters(raw: string, duration: number): Chapter[] {
  const text = String(raw || '').replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  let rows: any[] = [];
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) rows = parsed;
    } catch {
      // 尝试对象形状
    }
  }
  if (!rows.length) {
    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      try {
        const parsed = JSON.parse(text.slice(objectStart, objectEnd + 1));
        if (Array.isArray(parsed?.chapters)) rows = parsed.chapters;
      } catch {
        // ignore
      }
    }
  }

  const chapters: Chapter[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const chapterStart = parseTime(row.start ?? row.from ?? row.start_time);
    const chapterEnd = parseTime(row.end ?? row.to ?? row.end_time);
    const title = String(row.title || row.name || '').trim();
    if (!title) continue;
    const safeStart = Math.max(0, Math.min(duration > 0 ? duration : chapterStart, chapterStart));
    const safeEnd = Math.max(
      safeStart + 1,
      Math.min(duration > 0 ? duration : chapterEnd, chapterEnd || safeStart + 60)
    );
    chapters.push({
      start: Math.round(safeStart * 100) / 100,
      end: Math.round(safeEnd * 100) / 100,
      title: title.slice(0, 60)
    });
  }

  chapters.sort((a, b) => a.start - b.start);
  return chapters.slice(0, 30);
}

export async function generateChapters(
  info: PageInfo,
  lines: SubtitleLine[],
  signal?: AbortSignal
): Promise<Chapter[]> {
  const settings = loadSettings();
  const platform = activePlatform(settings);
  if (!platform || !platform.baseUrl.trim()) throw new Error('请先在设置里选择一个 AI 平台');
  if (!platform.model.trim()) throw new Error('请先在设置里填写模型名');
  if (!platform.apiKey.trim()) throw new Error('请先在设置里填写 API Key');
  if (!lines.length) throw new Error('没有可用的字幕内容');

  const transcript = buildTranscript(info, lines);
  const base = platform.baseUrl.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('章节生成超时（3 分钟）')),
    REQUEST_TIMEOUT_MS
  );
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    const response = await session.defaultSession.fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${platform.apiKey.trim()}`
      },
      body: JSON.stringify({
        model: platform.model.trim(),
        stream: false,
        temperature: 0.2,
        max_tokens: settings.ai.maxTokens || undefined,
        messages: [
          { role: 'system', content: settings.prompt.chapters },
          {
            role: 'user',
            content: `视频标题：${info.title || '未知'}\n视频时长：${Math.round(
              info.duration || 0
            )} 秒\n\n字幕：\n${transcript}`
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(errorForStatus(response.status, body));
    }
    const json: any = await response.json();
    const content = String(json?.choices?.[0]?.message?.content || '');
    const chapters = parseChapters(content, info.duration);
    if (!chapters.length) throw new Error('AI 没有返回可解析的章节');
    return chapters;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
