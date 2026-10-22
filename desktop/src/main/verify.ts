import type { AppSettings, PageInfo, SubtitleLine, WebReference } from '../shared/types';
import { rankReferences, searchWeb } from './search';

const STOPWORDS = new Set([
  '视频', '内容', '我们', '他们', '你们', '这个', '那个', '什么', '怎么', '为什么',
  '可以', '应该', '如果', '因为', '所以', '但是', '而且', '然后', '现在', '今天',
  '一个', '一些', '非常', '特别', '其实', '就是', '这样', '那样', '大家', '自己',
  '问题', '时候', '地方', '东西', '事情', '情况', '方面', '方式', '方法', '结果',
  '第一', '第二', '第三', '最后', '开始', '结束', 'the', 'and', 'for', 'with', 'this',
  'that', 'from', 'have', 'will', 'your', 'about', 'into', 'than', 'then', 'they',
  'app', 'application', 'pro', 'max', 'plus', 'new'
]);

type Progress = (done: number, total: number, message: string) => void;

export interface VerifyItem {
  query: string;
  line: string;
  references: WebReference[];
}

export interface VerifyResult {
  items: VerifyItem[];
  references: WebReference[];
  attempted: number;
  failed: number;
}

function clean(value: string): string {
  return String(value || '')
    .replace(/[，。、；：！？“”‘’（）【】《》〈〉·…—～\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasValue(value: string): boolean {
  const term = value.toLowerCase();
  return term.length >= 2 && !STOPWORDS.has(term) && !/^\d+$/.test(term);
}

interface TermScore {
  term: string;
  score: number;
  count: number;
  kind: 'year' | 'number' | 'version' | 'en' | 'cn';
}

function scoreTerms(text: string): Map<string, TermScore> {
  const bag = new Map<string, TermScore>();
  const add = (value: string, kind: TermScore['kind'], weight: number) => {
    const term = clean(value);
    if (!hasValue(term) || term.length > 32) return;
    const previous = bag.get(term);
    if (previous) {
      previous.score += weight;
      previous.count += 1;
    } else {
      bag.set(term, { term, score: weight, count: 1, kind });
    }
  };

  for (const match of text.matchAll(/(19|20)\d{2}\s*年?/g)) add(match[0], 'year', 5);
  for (const match of text.matchAll(
    /\d+(?:\.\d+)?\s*(?:亿|万|千万|百万|千|百|%|％|倍|TB|GB|MB|KB|人|元|美元|次|个)/g
  )) {
    add(match[0], 'number', 5);
  }
  for (const match of text.matchAll(/\b[vV]?\d+(?:\.\d+){1,3}\b/g)) add(match[0], 'version', 4);
  for (const match of text.matchAll(/\b[A-Za-z][A-Za-z0-9+#._-]{2,30}\b/g)) {
    add(match[0], 'en', /[A-Z]/.test(match[0]) || /\d/.test(match[0]) ? 3 : 1.5);
  }
  for (const match of text.matchAll(/[\u4e00-\u9fa5]{2,8}/g)) add(match[0], 'cn', 1);
  return bag;
}

function topTerms(bag: Map<string, TermScore>, limit: number): TermScore[] {
  return [...bag.values()]
    .filter((item) => item.kind !== 'cn' || item.count >= 2)
    .sort((a, b) => b.score - a.score || b.term.length - a.term.length)
    .slice(0, Math.max(0, limit));
}

function extractItems(lines: SubtitleLine[], limit: number): Array<{ term: string; line: string }> {
  const total = Math.max(1, Math.min(20, limit));
  if (!lines.length) return [];
  const segCount = Math.max(1, Math.min(4, Math.ceil(lines.length / 120), total));
  const perSegment = Math.max(1, Math.ceil(total / segCount));
  const size = Math.ceil(lines.length / segCount);
  const picked: Array<{ term: string; line: string }> = [];
  const seen = new Set<string>();

  const take = (bag: Map<string, TermScore>, count: number, from = 0, to = lines.length) => {
    for (const item of topTerms(bag, count)) {
      if (picked.length >= total) return;
      if (seen.has(item.term.toLowerCase())) continue;
      const line = lines
        .slice(from, to)
        .find((candidate) => candidate.text.toLowerCase().includes(item.term.toLowerCase()));
      if (!line) continue;
      seen.add(item.term.toLowerCase());
      picked.push({ term: item.term, line: line.text });
    }
  };

  for (let segment = 0; segment < segCount; segment += 1) {
    const from = segment * size;
    const to = segment === segCount - 1 ? lines.length : Math.min(lines.length, from + size);
    take(scoreTerms(lines.slice(from, to).map((line) => line.text).join('\n')), perSegment, from, to);
  }
  take(scoreTerms(lines.map((line) => line.text).join('\n')), total * 2);
  return picked.slice(0, total);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
}

function relevant(query: string, reference: WebReference): boolean {
  const text = `${reference.title} ${reference.snippet}`.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9一-龥]+/i)
    .filter((term) => term.length >= 2 && !STOPWORDS.has(term));
  if (!terms.length) return Boolean(reference.snippet.trim());
  return terms.some((term) => text.includes(term));
}

export async function verifySummary(
  settings: AppSettings,
  info: PageInfo,
  lines: SubtitleLine[],
  signal: AbortSignal | undefined,
  onProgress: Progress
): Promise<VerifyResult> {
  const limit = Math.max(1, Math.min(20, Number(settings.search.verifyItemCount) || 12));
  const items = extractItems(lines, limit).map((item) => ({
    query: item.term,
    line: item.line
  }));

  if (!items.length) {
    return { items: [], references: [], attempted: 0, failed: 0 };
  }

  let done = 0;
  let failed = 0;
  const results = await mapLimit(items, 2, async (item) => {
    if (signal?.aborted) throw new Error('已终止');
    try {
      const raw = await searchWeb(settings, item.query);
      const ranked = rankReferences(item.query, raw)
        .filter((reference) => relevant(item.query, reference))
        .slice(0, 2);
      done += 1;
      onProgress(done, items.length, item.query);
      return { ...item, references: ranked };
    } catch {
      failed += 1;
      done += 1;
      onProgress(done, items.length, item.query);
      return { ...item, references: [] as WebReference[] };
    }
  });

  const byUrl = new Map<string, WebReference>();
  for (const item of results) {
    for (const reference of item.references) {
      if (!byUrl.has(reference.url)) byUrl.set(reference.url, reference);
    }
  }

  return {
    items: results,
    references: [...byUrl.values()].slice(0, 10),
    attempted: items.length,
    failed
  };
}

export function buildVerifyBlock(result: VerifyResult): string {
  const rows: string[] = [];
  const refs: string[] = [];
  const indexOf = new Map<string, number>();

  for (const item of result.items) {
    if (!item.references.length) continue;
    const ids = item.references.map((reference) => {
      let id = indexOf.get(reference.url);
      if (!id) {
        id = indexOf.size + 1;
        indexOf.set(reference.url, id);
        refs.push(
          `[${id}] ${reference.title}\n${reference.url}\n${reference.snippet.slice(0, 260)}`
        );
      }
      return `[${id}]`;
    });
    rows.push(`- ${item.query}（字幕原句：${item.line.slice(0, 90)}）→ ${ids.join(' ')}`);
  }

  if (!rows.length) return '';
  return [
    '',
    '【联网核对（只列字幕里可核实的具体项；证据仅用于纠正/补充，不要照抄）】',
    ...rows,
    '',
    '【证据】',
    ...refs,
    '',
    '写作要求：',
    '- 字幕与证据冲突时，以证据纠正具体数字/时间/术语；无法确认的不要改。',
    '- 只在确实补充或纠正了视频内容时引用，使用 [n]，不要罗列来源。',
    '- 证据与视频无关时忽略，不要为了“用上检索”而硬加内容。'
  ].join('\n');
}
