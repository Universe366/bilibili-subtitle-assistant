import type { AppSettings, OptimizeSuggestion, SubtitleLine, WebReference } from '../shared/types';
import { activePlatform, loadSettings } from './settings';
import { needsApiKey } from './platformKey';
import { chatOnce } from './aiClient';
import { glossaryTerms } from './correction';
import { rankReferences, searchWeb } from './search';

const MAX_BATCH_LINES = 30;
const MAX_BATCH_CHARS = 5000;
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

function parseSuggestions(raw: string, batch: SubtitleLine[]): string[] {
  const text = String(raw || '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const json = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(json?.lines)) {
        return batch.map((line, index) => String(json.lines[index] ?? line.text));
      }
      if (Array.isArray(json?.corrections)) {
        const byIndex = new Map<number, string>();
        for (const item of json.corrections) {
          const index = Number(item?.index);
          if (Number.isFinite(index) && index >= 1) byIndex.set(index, String(item?.text || ''));
        }
        return batch.map((line, index) => byIndex.get(index + 1) ?? line.text);
      }
    } catch {
      // 继续按行解析
    }
  }

  const rows = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+\s*[.、:：)\]]\s*/, '').trim())
    .filter(Boolean);
  return batch.map((line, index) => rows[index] || line.text);
}

async function verifySuggestions(
  settings: AppSettings,
  platform: ReturnType<typeof activePlatform>,
  suggestions: OptimizeSuggestion[],
  signal?: AbortSignal
): Promise<void> {
  const targets = suggestions.slice(0, 6);
  const rows: Array<{ item: OptimizeSuggestion; refs: WebReference[] }> = [];

  for (const item of targets) {
    if (signal?.aborted) return;
    try {
      const query = item.suggestion.slice(0, 80);
      const found = await searchWeb(
        { ...settings, search: { ...settings.search, enabled: true } },
        query
      );
      rows.push({ item, refs: rankReferences(query, found).slice(0, 2) });
    } catch {
      rows.push({ item, refs: [] });
    }
  }

  for (const row of rows) {
    const domains = new Set(
      row.refs
        .map((ref) => {
          try {
            return new URL(ref.url).hostname.replace(/^www\./i, '');
          } catch {
            return '';
          }
        })
        .filter(Boolean)
    );
    row.item.sources = domains.size;
  }

  const withEvidence = rows.filter((row) => row.refs.length);
  if (!withEvidence.length) {
    suggestions.forEach((item) => {
      if (!item.verdict) item.verdict = 'unknown';
    });
    return;
  }

  const payload = withEvidence.map((row) => ({
    index: row.item.index,
    original: row.item.original,
    suggestion: row.item.suggestion,
    evidence: row.refs.map((ref) => ({
      title: ref.title,
      url: ref.url,
      snippet: ref.snippet.slice(0, 600)
    }))
  }));

  try {
    const result = await chatOnce(
      platform,
      [
        {
          role: 'system',
          content:
            '你是事实核查员。对每条字幕修改，统计 evidence 中支持/反对修改的条数，并给出 overall verdict：support=支持，refute=反对，unknown=证据不足或冲突无法判断。' +
            '必须从 evidence 中逐字引用 4-50 字作为 quote；找不到就输出 unknown。' +
            '只输出 JSON 数组：[{"index":0,"verdict":"support","support":2,"refute":0,"quote":"证据原文"}]，不要解释。'
        },
        {
          role: 'user',
          content: JSON.stringify(payload)
        }
      ],
      { temperature: 0, maxTokens: 2000, signal }
    );
    const content = result.text;
    const start = content.indexOf('[');
    const end = content.lastIndexOf(']');
    const parsed = start >= 0 && end > start ? JSON.parse(content.slice(start, end + 1)) : [];
    const byIndex = new Map<number, Record<string, unknown>>();
    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        const index = Number(row?.index);
        if (Number.isFinite(index)) byIndex.set(index, row);
      }
    }

    for (const row of rows) {
      const verdict = byIndex.get(row.item.index);
      if (!verdict || !['support', 'refute', 'unknown'].includes(String(verdict.verdict))) {
        row.item.verdict = 'unknown';
        continue;
      }
      const quote = String(verdict.quote || '').trim();
      const evidenceText = row.refs.map((ref) => `${ref.title}\n${ref.snippet}`).join('\n');
      if (verdict.verdict !== 'unknown' && (!quote || !evidenceText.includes(quote))) {
        row.item.verdict = 'unknown';
        continue;
      }
      row.item.verdict = verdict.verdict as typeof row.item.verdict;
      row.item.evidence = quote.slice(0, 80);
      const sources = row.item.sources || 0;
      const support = Math.max(0, Math.min(sources, Number(verdict.support) || 0));
      const refute = Math.max(0, Math.min(sources, Number(verdict.refute) || 0));
      row.item.supportCount = support;
      row.item.refuteCount = refute;
      if (support > 0 && refute > 0) row.item.consistency = 'conflict';
      else if (row.item.verdict === 'support' || row.item.verdict === 'refute') {
        row.item.consistency = sources >= 2 ? 'multi' : 'single';
      }
    }
  } catch {
    rows.forEach((row) => {
      row.item.verdict = 'unknown';
    });
  }
}

export async function optimizeLines(
  lines: SubtitleLine[],
  onProgress: Progress,
  signal?: AbortSignal,
  settingsOverride?: AppSettings
): Promise<OptimizeSuggestion[]> {
  const settings = settingsOverride || loadSettings();
  const platform = activePlatform(settings);
  if (!platform || !platform.baseUrl.trim()) throw new Error('请先在设置里选择一个 AI 平台');
  if (!platform.model.trim()) throw new Error('请先在设置里填写模型名');
  if (needsApiKey(platform) && !platform.apiKey.trim()) throw new Error('请先在设置里填写 API Key');
  if (!lines.length) throw new Error('没有可优化的字幕');

  const glossary = glossaryTerms(settings);
  const glossaryBlock = glossary.length
    ? `\n\n术语表（必须使用以下写法）：\n${glossary
        .slice(0, 80)
        .map((term) => `- ${term.from} → ${term.to}${term.note ? `（${term.note}）` : ''}`)
        .join('\n')}`
    : '';

  const batches = batchesOf(lines);
  const suggestions: OptimizeSuggestion[] = [];
  let offset = 0;

  for (let index = 0; index < batches.length; index += 1) {
    if (signal?.aborted) throw new Error('已终止');
    const batch = batches[index];
    const numbered = batch.map((line, lineIndex) => `${lineIndex + 1}. ${line.text}`).join('\n');
    onProgress(
      (index / batches.length) * 100,
      `校对第 ${index + 1} / ${batches.length} 批（${batch.length} 行）`
    );

    const result = await chatOnce(
      platform,
      [
        {
          role: 'system',
          content: `${settings.prompt.optimize}${glossaryBlock}`
        },
        {
          role: 'user',
          content: `共 ${batch.length} 条字幕，请逐条校对：\n${numbered}`
        }
      ],
      {
        temperature: 0.1,
        maxTokens: settings.ai.maxTokens || undefined,
        timeoutMs: REQUEST_TIMEOUT_MS,
        signal
      }
    );

    const content = result.text;
    const rows = parseSuggestions(content, batch);
    if (!rows.length) throw new Error('AI 没有返回可解析的结果');

    for (let lineIndex = 0; lineIndex < batch.length; lineIndex += 1) {
      const original = batch[lineIndex].text;
      const suggestion = String(rows[lineIndex] || '').trim();
      if (suggestion && suggestion !== original.trim()) {
        suggestions.push({
          index: offset + lineIndex,
          original,
          suggestion
        });
      }
    }

    offset += batch.length;
  }

  if (settings.search.enabled && settings.search.verify && suggestions.length) {
    onProgress(95, '联网核对改动…');
    await verifySuggestions(settings, platform, suggestions, signal);
  }

  onProgress(
    100,
    suggestions.length ? `发现 ${suggestions.length} 处改动` : '没有发现需要修改的地方'
  );
  return suggestions;
}
