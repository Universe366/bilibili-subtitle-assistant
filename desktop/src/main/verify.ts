import { session } from 'electron';
import type {
  AppSettings,
  PageInfo,
  SubtitleLine,
  VerificationSummary,
  VerifiedReference,
  VerifyVerdict,
  WebReference
} from '../shared/types';
import { activePlatform } from './settings';
import { rankReferences, searchWeb } from './search';

const STOPWORDS = new Set([
  '视频', '内容', '我们', '他们', '你们', '这个', '那个', '什么', '怎么', '为什么',
  '可以', '应该', '如果', '因为', '所以', '但是', '而且', '然后', '现在', '今天',
  '一个', '一些', '非常', '特别', '其实', '就是', '这样', '那样', '大家', '自己',
  '问题', '时候', '地方', '东西', '事情', '情况', '方面', '方式', '方法', '结果',
  '第一', '第二', '第三', '最后', '开始', '结束', 'the', 'and', 'for', 'with', 'this',
  'that', 'from', 'have', 'will', 'your', 'about', 'into', 'than', 'then', 'they',
  'app', 'application', 'pro', 'max', 'plus', 'new', 'never', 'what', 'running', 'door'
]);

type Progress = (done: number, total: number, message: string) => void;

export interface VerifyItem {
  label?: string;
  query: string;
  line: string;
  context?: string;
  references: VerifiedReference[];
}

export type VerifyResult = VerificationSummary;

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
    .filter((item) => {
      if (item.kind === 'cn') return item.count >= 2;
      if (item.kind === 'en') {
        // 短的全大写/全小写词只出现一次，多半是语音错字或泛词（DOO/app）。
        if (item.count < 2 && !/\d/.test(item.term)) {
          if (item.term.length <= 3) return false;
          if (/^[A-Z]{2,5}$/.test(item.term)) return false;
          if (/^[a-z]+$/.test(item.term)) return false;
        }
        return item.term.length >= 4 || /\d/.test(item.term);
      }
      return true;
    })
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

function contextWindowFor(lines: SubtitleLine[], lineText: string, maxChars = 140): string {
  const index = lines.findIndex((line) => line.text === lineText);
  if (index < 0) return clean(lineText).slice(0, maxChars);
  const picked: string[] = [];
  let total = 0;
  const take = (at: number) => {
    const text = clean(lines[at]?.text || '');
    if (!text || total + text.length > maxChars) return;
    picked.push(text);
    total += text.length + 1;
  };
  take(index);
  for (let distance = 1; distance <= 2 && total < maxChars; distance += 1) {
    take(index - distance);
    take(index + distance);
  }
  return picked.join(' ').slice(0, maxChars);
}

function contextualQuery(term: string, context: string): string {
  const value = clean(term);
  const window = clean(context);
  if (!window) return value;
  if (window.length <= 90) return window;
  const index = window.toLowerCase().indexOf(value.toLowerCase());
  if (index < 0) return `${value} ${window.slice(0, 80)}`.slice(0, 100);
  return window.slice(Math.max(0, index - 30), Math.min(window.length, index + value.length + 45)).trim();
}

const CJK_STOP = new Set([
  '视频', '内容', '我们', '他们', '你们', '这个', '那个', '什么', '怎么', '为什',
  '可以', '应该', '如果', '因为', '所以', '但是', '而且', '然后', '现在', '今天',
  '一个', '一些', '非常', '特别', '其实', '就是', '这样', '那样', '大家', '自己',
  '问题', '时候', '地方', '东西', '事情', '情况', '方面', '方式', '方法', '结果',
  '第一', '第二', '第三', '最后', '开始', '结束', '发布', '正式', '目前', '今年',
  '去年', '明年', '最新', '最近', '以及', '还有', '不过', '或者', '因此', '只要',
  '已经', '正在', '表示', '认为', '觉得', '知道', '看到', '进行', '出现', '发生',
  '成为', '作为', '通过', '根据', '关于', '对于', '由于', '同时', '此外', '例如',
  '比如', '包括', '主要', '重要', '可能', '需要', '提供', '支持', '使用', '实现'
]);

function normalizeMatch(value: string): string {
  return String(value || '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryTokens(query: string): { strong: string[]; cjk: string[] } {
  const text = normalizeMatch(query);
  const strong: string[] = [];
  const cjk: string[] = [];
  for (const match of text.matchAll(/[a-z0-9]+|[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g)) {
    const segment = match[0];
    if (/^[a-z0-9]/.test(segment)) {
      if (segment.length >= 2 && !STOPWORDS.has(segment) && !strong.includes(segment)) {
        strong.push(segment);
      }
      continue;
    }
    for (let index = 0; index + 1 < segment.length; index += 1) {
      const bigram = segment.slice(index, index + 2);
      if (!CJK_STOP.has(bigram) && !cjk.includes(bigram)) cjk.push(bigram);
    }
  }
  return { strong, cjk };
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
  const hay = normalizeMatch(`${reference.title} ${reference.snippet}`);
  if (!hay) return false;
  const { strong, cjk } = queryTokens(query);
  if (!strong.length && !cjk.length) return false;
  if (strong.length) {
    const hits = strong.filter((term) => hay.includes(term)).length;
    if (hits === 0) return false;
  }
  if (cjk.length) {
    const hits = cjk.filter((term) => hay.includes(term)).length;
    if (hits === 0) return false;
    if (cjk.length >= 4 && hits / cjk.length < 0.25) return false;
  }
  return true;
}

function evidenceText(reference: WebReference): string {
  return clean(`${reference.title} ${reference.snippet}`);
}

function trimQuote(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

interface EvidenceRow {
  id: string;
  itemIndex: number;
  refIndex: number;
  item: VerifyItem;
  reference: WebReference;
}

async function judgeEvidence(
  settings: AppSettings,
  info: PageInfo,
  items: VerifyItem[],
  signal: AbortSignal | undefined,
  onProgress: Progress
): Promise<{ items: VerifyItem[]; supplements: string[]; dropped: number } | null> {
  const platform = activePlatform(settings);
  if (!platform || !platform.baseUrl.trim() || !platform.apiKey.trim() || !platform.model.trim()) {
    return null;
  }

  const evidence: EvidenceRow[] = [];
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    for (let refIndex = 0; refIndex < items[itemIndex].references.length; refIndex += 1) {
      evidence.push({
        id: `E${evidence.length + 1}`,
        itemIndex,
        refIndex,
        item: items[itemIndex],
        reference: items[itemIndex].references[refIndex]
      });
    }
  }
  if (!evidence.length) return null;

  const prompt = [
    `视频标题：${info.title || '未知'}`,
    '',
    '请逐条判断下面的检索证据是否真的能支持或反驳字幕里的待核实项。',
    '只输出一个 JSON 对象，不要 Markdown，不要解释：',
    '{"judgments":[{"id":"E1","verdict":"support|refute|irrelevant","quote":"证据原文中的连续片段"}],"supplements":["基于证据的简短补充"]}',
    '',
    '规则：',
    '- quote 必须逐字摘自对应证据的标题或摘要，4~60 字；找不到就判 irrelevant。',
    '- support：证据明确支持字幕说法；refute：证据明确矛盾；irrelevant：只是同名/同领域，没谈字幕里的那件事。',
    '- 不要因为出现同一个产品名就判 support。',
    '- supplements 最多 3 条，每条不超过 120 字，只能写证据确实补充/纠正的内容；没有就返回空数组。',
    '',
    ...evidence.map(
      (row) =>
        `${row.id} | 待核实项：${row.item.label || row.item.query} | 字幕：${row.item.line.slice(0, 70)} | ` +
        `标题：${row.reference.title} | 摘要：${row.reference.snippet.slice(0, 320)}`
    )
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('证据判定超时')), 90000);
  const forward = () => controller.abort();
  signal?.addEventListener('abort', forward, { once: true });
  try {
    const base = platform.baseUrl.replace(/\/+$/, '');
    const response = await session.defaultSession.fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${platform.apiKey}`
      },
      body: JSON.stringify({
        model: platform.model,
        temperature: 0,
        stream: false,
        max_tokens: 1400,
        messages: [
          {
            role: 'system',
            content: '你是严格的事实核查员，只依据给定证据判断，不补脑、不猜。'
          },
          { role: 'user', content: prompt }
        ]
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`判定请求失败 HTTP ${response.status}`);
    const data: any = await response.json();
    const content = String(data?.choices?.[0]?.message?.content || '');
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('判定结果不是 JSON');
    const parsed = JSON.parse(content.slice(start, end + 1));

    const evidenceById = new Map(evidence.map((row) => [row.id, row]));
    const drop = new Set<string>();
    const verdicts = new Map<string, VerifyVerdict>();
    for (const judgment of Array.isArray(parsed.judgments) ? parsed.judgments : []) {
      const row = evidenceById.get(String(judgment?.id || ''));
      if (!row) continue;
      const verdict = String(judgment?.verdict || '').toLowerCase();
      const quote = trimQuote(judgment?.quote);
      const source = evidenceText(row.reference);
      if (!quote || quote.length < 4 || !source.toLowerCase().includes(quote.toLowerCase())) {
        drop.add(row.id);
        continue;
      }
      if (verdict === 'irrelevant') {
        drop.add(row.id);
      } else if (verdict === 'support' || verdict === 'refute') {
        verdicts.set(row.id, verdict);
      }
    }

    const kept = items.map((item, itemIndex) => ({
      ...item,
      references: item.references.flatMap((reference, refIndex) => {
        const row = evidence.find(
          (candidate) => candidate.itemIndex === itemIndex && candidate.refIndex === refIndex
        );
        if (row && drop.has(row.id)) return [];
        const verdict = row ? verdicts.get(row.id) : undefined;
        return [verdict ? { ...reference, verdict } : reference];
      })
    }));

    const supplements = (Array.isArray(parsed.supplements) ? parsed.supplements : [])
      .map((value: unknown) => clean(String(value || '')))
      .filter((value: string) => value.length >= 8 && value.length <= 180)
      .slice(0, 3);
    return { items: kept, supplements, dropped: drop.size };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

export async function verifySummary(
  settings: AppSettings,
  info: PageInfo,
  lines: SubtitleLine[],
  signal: AbortSignal | undefined,
  onProgress: Progress
): Promise<VerifyResult> {
  const limit = Math.max(1, Math.min(20, Number(settings.search.verifyItemCount) || 12));
  const items = extractItems(lines, limit).map((item) => {
    const context = contextWindowFor(lines, item.line);
    return {
      label: item.term,
      query: contextualQuery(item.term, context),
      line: item.line,
      context
    };
  });

  if (!items.length) {
    return {
      items: [],
      references: [],
      supplements: [],
      attempted: 0,
      failed: 0,
      judged: false,
      dropped: 0
    };
  }

  let done = 0;
  let failed = 0;
  const results = await mapLimit(items, 2, async (item) => {
    if (signal?.aborted) throw new Error('已终止');
    const line = clean(item.line);
    const index = line.toLowerCase().indexOf(item.query.toLowerCase());
    const context =
      index >= 0
        ? line.slice(Math.max(0, index - 8), Math.min(line.length, index + item.query.length + 8))
        : '';
    const searchQuery = /^[0-9]|年|次|%|％/.test(item.query) && context
      ? `${item.query} ${context}`.slice(0, 48)
      : item.query;
    try {
      const raw = await searchWeb(settings, searchQuery);
      const label = item.label || item.query;
      const ranked = rankReferences(label, raw)
        .filter((reference) => relevant(label, reference))
        .slice(0, 2);
      done += 1;
      onProgress(done, items.length, label);
      return { ...item, references: ranked };
    } catch {
      failed += 1;
      done += 1;
      onProgress(done, items.length, item.label || item.query);
      return { ...item, references: [] as WebReference[] };
    }
  });

  let finalItems: VerifyItem[] = results;
  let supplements: string[] = [];
  let judged = false;
  let dropped = 0;
  try {
    onProgress(items.length, items.length, '语义判定证据…');
    const verdict = await judgeEvidence(settings, info, results, signal, onProgress);
    if (verdict) {
      finalItems = verdict.items;
      supplements = verdict.supplements;
      dropped = verdict.dropped;
      judged = true;
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    // 判定失败时保留已搜到的证据，不让总结直接失去联网结果。
  }

  const byUrl = new Map<string, WebReference>();
  for (const item of finalItems) {
    for (const reference of item.references) {
      if (!byUrl.has(reference.url)) byUrl.set(reference.url, reference);
    }
  }

  return {
    items: finalItems,
    references: [...byUrl.values()].slice(0, 10),
    supplements,
    attempted: items.length,
    failed,
    judged,
    dropped
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

  if (!rows.length && !result.supplements.length) return '';
  return [
    '',
    '【联网核对（只列字幕里可核实的具体项；证据仅用于纠正/补充，不要照抄）】',
    ...rows,
    '',
    ...(result.supplements.length
      ? ['【外部补充（仅证据支持的内容）】', ...result.supplements.map((item) => `- ${item}`), '']
      : []),
    '【证据】',
    ...refs,
    '',
    '写作要求：',
    '- 字幕与证据冲突时，以证据纠正具体数字/时间/术语；无法确认的不要改。',
    '- 只在确实补充或纠正了视频内容时引用，使用 [n]，不要罗列来源。',
    '- 证据与视频无关时忽略，不要为了“用上检索”而硬加内容。'
  ].join('\n');
}
