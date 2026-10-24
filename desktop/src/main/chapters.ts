import type { Chapter, PageInfo, SubtitleLine } from '../shared/types';
import { activePlatform, loadSettings } from './settings';
import { needsApiKey } from './platformKey';
import { chatOnce } from './aiClient';
import { buildTranscript } from './ai';

const REQUEST_TIMEOUT_MS = 180000;

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
  const text = String(raw || '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  let rows: Array<Record<string, unknown>> = [];
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
      if (Array.isArray(parsed)) rows = parsed as Array<Record<string, unknown>>;
    } catch {
      // 尝试对象形状
    }
  }
  if (!rows.length) {
    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      try {
        const parsed = JSON.parse(text.slice(objectStart, objectEnd + 1)) as { chapters?: unknown };
        if (Array.isArray(parsed?.chapters))
          rows = parsed.chapters as Array<Record<string, unknown>>;
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
  if (needsApiKey(platform) && !platform.apiKey.trim()) throw new Error('请先在设置里填写 API Key');
  if (!lines.length) throw new Error('没有可用的字幕内容');

  const transcript = buildTranscript(info, lines);
  const result = await chatOnce(
    platform,
    [
      { role: 'system', content: settings.prompt.chapters },
      {
        role: 'user',
        content: `视频标题：${info.title || '未知'}\n视频时长：${Math.round(
          info.duration || 0
        )} 秒\n\n字幕：\n${transcript}`
      }
    ],
    {
      temperature: 0.2,
      maxTokens: settings.ai.maxTokens || undefined,
      timeoutMs: REQUEST_TIMEOUT_MS,
      signal
    }
  );
  const chapters = parseChapters(result.text, info.duration);
  if (!chapters.length) throw new Error('AI 没有返回可解析的章节');
  return chapters;
}
