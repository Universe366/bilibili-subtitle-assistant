import { session } from 'electron';
import type {
  AppSettings,
  SearchPlatform,
  SearchTimeRange,
  WebReference
} from '../shared/types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function cleanTitle(title: string): string {
  return String(title || '')
    .replace(/_哔哩哔哩.*$/i, '')
    .replace(/【.*?】/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSearchQuery(title: string, owner?: string): string {
  const clean = cleanTitle(title);
  if (clean.length >= 6) return clean;
  return [owner, clean].filter(Boolean).join(' ').trim() || clean || '视频';
}

function daysFor(range: SearchTimeRange): number | undefined {
  if (range === 'year') return 365;
  if (range === 'month') return 30;
  if (range === 'week') return 7;
  return undefined;
}

function freshnessFor(range: SearchTimeRange): string {
  if (range === 'year') return 'py';
  if (range === 'month') return 'pm';
  if (range === 'week') return 'pw';
  return '';
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

async function timeoutFetch(url: string, init: RequestInit, timeoutMs = 20000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('检索超时')), timeoutMs);
  try {
    return await session.defaultSession.fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalize(rows: WebReference[], max: number): WebReference[] {
  const out: WebReference[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const url = String(row.url || '').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({
      title: String(row.title || url).trim(),
      url,
      snippet: String(row.snippet || '').replace(/\s+/g, ' ').trim()
    });
    if (out.length >= max) break;
  }
  return out;
}

const searchCache = new Map<string, { at: number; refs: WebReference[] }>();

function activePlatform(settings: AppSettings): SearchPlatform {
  return (
    settings.search.platforms.find((item) => item.id === settings.search.activeId) ||
    settings.search.platforms[0]
  );
}

function keyOf(settings: AppSettings, platform: SearchPlatform): string {
  const direct = String(platform.apiKey || '').trim();
  if (direct) return direct;
  if (platform.reuseAiKey) {
    return (
      settings.ai.platforms.find((item) => item.id === platform.reuseAiKey)?.apiKey || ''
    ).trim();
  }
  return '';
}

function parseRows(
  data: any,
  pick: (item: any) => { title?: string; url?: string; snippet?: string }
): WebReference[] {
  const candidates: any[] = [];
  if (Array.isArray(data?.results)) candidates.push(...data.results);
  if (Array.isArray(data?.data?.results)) candidates.push(...data.data.results);
  if (Array.isArray(data?.data?.webPages?.value)) candidates.push(...data.data.webPages.value);
  if (Array.isArray(data?.webPages?.value)) candidates.push(...data.webPages.value);
  if (Array.isArray(data?.organic)) candidates.push(...data.organic);
  if (Array.isArray(data?.search_result)) candidates.push(...data.search_result);
  if (Array.isArray(data?.references)) candidates.push(...data.references);
  if (Array.isArray(data?.search_results)) candidates.push(...data.search_results);
  if (Array.isArray(data?.data?.webpages)) candidates.push(...data.data.webpages);
  if (Array.isArray(data?.webpages)) candidates.push(...data.webpages);
  if (Array.isArray(data?.web?.results)) candidates.push(...data.web.results);
  if (Array.isArray(data?.data) && data.data.some((item: any) => item?.url || item?.link)) {
    candidates.push(...data.data);
  }
  if (Array.isArray(data?.items)) candidates.push(...data.items);
  return candidates
    .map((item) => pick(item || {}))
    .filter((item): item is WebReference => Boolean(item && item.url)) as WebReference[];
}

async function jsonOf(res: Response, label: string): Promise<any> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${label} HTTP ${res.status}：${text.slice(0, 160)}`);
  }
  return res.json();
}

async function searchDeepSeek(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('DeepSeek 搜索需要 Key（可复用 AI 平台 DeepSeek Key）');
  const base = platform.baseUrl.replace(/\/+$/, '');
  const url = /\/tools\/search$/.test(base) ? base : `${base}/tools/search`;
  const days = daysFor(settings.search.timeRange);
  const suffix = days ? ` after:${isoDaysAgo(days)}` : '';
  const payload = {
    query: `${query}${suffix}`.slice(0, 128),
    count: Math.min(50, settings.search.maxResults),
    need_content: settings.search.includeContent
  };
  const res = await timeoutFetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify(payload)
  });
  const data = await jsonOf(res, 'DeepSeek 搜索');
  return parseRows(data, (item) => ({
    title: item.title || item.url,
    url: item.url,
    snippet: item.summary || item.snippet || item.content
  }));
}

async function searchTavily(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('Tavily 需要 API Key');
  const body: Record<string, unknown> = {
    api_key: key,
    query,
    max_results: settings.search.maxResults,
    include_answer: false,
    include_raw_content: settings.search.includeContent,
    search_depth: 'basic'
  };
  if (settings.search.timeRange !== 'any') body.time_range = settings.search.timeRange;
  const res = await timeoutFetch(platform.baseUrl || 'https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await jsonOf(res, 'Tavily');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url,
    snippet: item.content || item.raw_content || item.snippet
  }));
}

async function searchBocha(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('博查 Bocha 需要 API Key');
  const body: Record<string, unknown> = {
    query,
    count: settings.search.maxResults,
    summary: settings.search.includeContent
  };
  if (settings.search.timeRange !== 'any') {
    body.freshness =
      settings.search.timeRange === 'year'
        ? 'oneYear'
        : settings.search.timeRange === 'month'
          ? 'oneMonth'
          : 'oneWeek';
  }
  const res = await timeoutFetch(
    platform.baseUrl || 'https://api.bochaai.com/v1/web-search',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body)
    }
  );
  const data = await jsonOf(res, 'Bocha');
  return parseRows(data, (item) => ({
    title: item.name || item.title,
    url: item.url,
    snippet: item.summary || item.snippet
  }));
}

async function searchSerper(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('Serper 需要 API Key');
  const tbs =
    settings.search.timeRange === 'year'
      ? 'qdr:y'
      : settings.search.timeRange === 'month'
        ? 'qdr:m'
        : settings.search.timeRange === 'week'
          ? 'qdr:w'
          : '';
  const res = await timeoutFetch(platform.baseUrl || 'https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-API-KEY': key
    },
    body: JSON.stringify({
      q: query,
      num: settings.search.maxResults,
      ...(tbs ? { tbs } : {})
    })
  });
  const data = await jsonOf(res, 'Serper');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.link || item.url,
    snippet: item.snippet
  }));
}

async function searchZhipu(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('智谱 Web 搜索需要 API Key');
  const body: Record<string, unknown> = {
    search_engine: 'search_std',
    search_query: query,
    count: Math.min(50, settings.search.maxResults),
    content_size: settings.search.includeContent ? 'high' : 'medium'
  };
  if (settings.search.timeRange !== 'any') {
    body.search_recency_filter =
      settings.search.timeRange === 'year'
        ? 'oneYear'
        : settings.search.timeRange === 'month'
          ? 'oneMonth'
          : 'oneWeek';
  }
  const res = await timeoutFetch(
    platform.baseUrl || 'https://open.bigmodel.cn/api/paas/v4/web_search',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body)
    }
  );
  const data = await jsonOf(res, '智谱搜索');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.link || item.url,
    snippet: item.content || item.snippet
  }));
}

async function searchMetaso(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('秘塔搜索需要 API Key');
  const res = await timeoutFetch(platform.baseUrl || 'https://metaso.cn/api/v1/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      q: query,
      scope: 'webpage',
      includeSummary: settings.search.includeContent,
      size: String(Math.min(50, settings.search.maxResults)),
      ...(settings.search.timeRange !== 'any' ? { timeRange: settings.search.timeRange } : {})
    })
  });
  const data = await jsonOf(res, '秘塔搜索');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.link || item.url,
    snippet: item.snippet || item.summary
  }));
}

async function searchBaidu(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('百度千帆 AI 搜索需要 API Key');
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: query }],
    search_source: 'baidu_search_v2',
    resource_type_filter: [{ type: 'web', top_k: settings.search.maxResults }]
  };
  if (settings.search.timeRange !== 'any') {
    body.search_recency_filter = settings.search.timeRange;
  }
  const res = await timeoutFetch(
    platform.baseUrl || 'https://qianfan.baidubce.com/v2/ai_search/web_search',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body)
    }
  );
  const data = await jsonOf(res, '百度 AI 搜索');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url || item.link,
    snippet: item.content || item.snippet
  }));
}

async function searchBrave(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('Brave 需要 API Key');
  const url = new URL(platform.baseUrl || 'https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(20, settings.search.maxResults)));
  const freshness = freshnessFor(settings.search.timeRange);
  if (freshness) url.searchParams.set('freshness', freshness);
  const res = await timeoutFetch(url.toString(), {
    headers: {
      accept: 'application/json',
      'x-subscription-token': key,
      'user-agent': UA
    }
  });
  const data = await jsonOf(res, 'Brave');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url,
    snippet: item.description
  }));
}

function parseRpcPayload(raw: string): any {
  const text = String(raw || '').trim();
  if (text.startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch {
      // 继续按 SSE 解析
    }
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const json = JSON.parse(payload);
      if (json && (json.result || json.error)) return json;
    } catch {
      // ignore
    }
  }
  return null;
}

function parseExaText(text: string): WebReference[] {
  const rows: WebReference[] = [];
  for (const chunk of String(text || '').split(/\n(?=Title:)/)) {
    const title = /^Title:\s*(.*)$/m.exec(chunk);
    const url = /^URL:\s*(\S+)/m.exec(chunk);
    if (!title || !url) continue;
    let body = chunk;
    const highlights = chunk.indexOf('Highlights:');
    if (highlights >= 0) body = chunk.slice(highlights + 'Highlights:'.length);
    rows.push({
      title: title[1].trim(),
      url: url[1].trim(),
      snippet: body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000)
    });
  }
  return rows;
}

async function searchExa(query: string, settings: AppSettings): Promise<WebReference[]> {
  const endpoint = 'https://mcp.exa.ai/mcp';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream'
  };
  const init = await timeoutFetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'bsub-desktop', version: '1' }
      }
    })
  });
  if (!init.ok) throw new Error(`Exa 握手 HTTP ${init.status}`);
  const sessionId = init.headers.get('mcp-session-id');
  if (sessionId) headers['mcp-session-id'] = sessionId;
  await init.text().catch(() => '');
  await timeoutFetch(
    endpoint,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    },
    10000
  ).catch(() => undefined);

  const call = await timeoutFetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: {
          query,
          numResults: Math.min(10, settings.search.maxResults)
        }
      }
    })
  });
  if (!call.ok) throw new Error(`Exa 调用 HTTP ${call.status}`);
  const json = parseRpcPayload(await call.text());
  const content = json?.result?.content;
  const text = Array.isArray(content)
    ? content.map((item: any) => item?.text || '').filter(Boolean).join('\n')
    : '';
  const rows = parseExaText(text);
  if (!rows.length) throw new Error('Exa 未返回可解析结果');
  return rows;
}

async function searchAnySearch(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const res = await timeoutFetch(platform.baseUrl || 'https://api.anysearch.com/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ query, max_results: settings.search.maxResults })
  });
  const data = await jsonOf(res, 'AnySearch');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url || item.link,
    snippet: item.snippet || item.content
  }));
}

async function searchJina(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const base = (platform.baseUrl || 'https://s.jina.ai/').replace(/\/+$/, '');
  const key = keyOf(settings, platform);
  const res = await timeoutFetch(`${base}/${encodeURIComponent(query)}`, {
    headers: {
      accept: 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {})
    }
  });
  const data = await jsonOf(res, 'Jina');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url || item.link,
    snippet: item.description || item.content
  }));
}

async function searchSearxng(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const url = new URL(platform.baseUrl || 'https://searx.be/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  if (settings.search.timeRange !== 'any') {
    url.searchParams.set('time_range', settings.search.timeRange);
  }
  const key = keyOf(settings, platform);
  const res = await timeoutFetch(url.toString(), {
    headers: {
      accept: 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {})
    }
  });
  const data = await jsonOf(res, 'SearXNG');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url,
    snippet: item.content
  }));
}

async function searchCustom(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  if (!platform.baseUrl.trim()) throw new Error('自定义搜索接口地址为空');
  const url = new URL(platform.baseUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(settings.search.maxResults));
  const key = keyOf(settings, platform);
  const res = await timeoutFetch(url.toString(), {
    headers: {
      accept: 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {})
    }
  });
  const data = await jsonOf(res, '自定义搜索');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url || item.link,
    snippet: item.snippet || item.content
  }));
}

export async function searchWeb(settings: AppSettings, query: string): Promise<WebReference[]> {
  if (!settings.search.enabled) return [];
  const platform = activePlatform(settings);
  if (!platform) throw new Error('没有可用的检索平台');
  const max = settings.search.maxResults;
  const kind = platform.kind || 'custom';
  const cacheKey = `${platform.id}|${query}|${max}|${settings.search.timeRange}`;
  const ttl = Math.max(0, settings.search.cacheMinutes || 0) * 60000;
  if (ttl > 0) {
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.at < ttl) {
      return cached.refs.map((ref) => ({ ...ref }));
    }
  }

  try {
    let rows: WebReference[] = [];
    if (kind === 'deepseek-search') rows = await searchDeepSeek(settings, platform, query);
    else if (kind === 'tavily') rows = await searchTavily(settings, platform, query);
    else if (kind === 'bocha') rows = await searchBocha(settings, platform, query);
    else if (kind === 'serper') rows = await searchSerper(settings, platform, query);
    else if (kind === 'zhipu') rows = await searchZhipu(settings, platform, query);
    else if (kind === 'metaso') rows = await searchMetaso(settings, platform, query);
    else if (kind === 'baidu') rows = await searchBaidu(settings, platform, query);
    else if (kind === 'brave') rows = await searchBrave(settings, platform, query);
    else if (kind === 'exa') rows = await searchExa(query, settings);
    else if (kind === 'anysearch') rows = await searchAnySearch(settings, platform, query);
    else if (kind === 'jina') rows = await searchJina(settings, platform, query);
    else if (kind === 'searxng') rows = await searchSearxng(settings, platform, query);
    else rows = await searchCustom(settings, platform, query);

    const normalized = normalize(rows, max);
    if (normalized.length) {
      if (ttl > 0) searchCache.set(cacheKey, { at: Date.now(), refs: normalized });
      return normalized;
    }
    throw new Error('没有返回结果');
  } catch (error) {
    if (settings.search.keylessFallback !== false && kind !== 'exa') {
      try {
        const fallback = normalize(await searchExa(query, settings), max);
        if (fallback.length) {
          if (ttl > 0) searchCache.set(cacheKey, { at: Date.now(), refs: fallback });
          return fallback;
        }
      } catch {
        // 兜底失败时保留原错误
      }
    }
    throw new Error(`检索失败（${platform.name}）：${(error as Error).message}`);
  }
}

function queryTerms(query: string): string[] {
  const text = String(query || '').toLowerCase();
  const terms = new Set<string>();
  for (const word of text.match(/[a-z0-9][a-z0-9._-]{2,}/g) || []) terms.add(word);
  const cjk = text.match(/[㐀-鿿]+/g) || [];
  for (const run of cjk) {
    if (run.length === 1) terms.add(run);
    for (let index = 0; index < run.length - 1; index += 1) {
      terms.add(run.slice(index, index + 2));
    }
  }
  return [...terms];
}

export function rankReferences(query: string, references: WebReference[]): WebReference[] {
  const terms = queryTerms(query);
  if (!terms.length) return references;
  const scored = references.map((reference, index) => {
    const title = reference.title.toLowerCase();
    const snippet = reference.snippet.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += 3;
      if (snippet.includes(term)) score += 1;
    }
    if (title.includes(query.toLowerCase())) score += 5;
    return { reference, score, index };
  });
  const positive = scored.filter((item) => item.score > 0);
  if (!positive.length) return references;
  return positive
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.reference);
}

export async function testSearch(
  settings: AppSettings,
  query: string
): Promise<WebReference[]> {
  const enabled = { ...settings, search: { ...settings.search, enabled: true } };
  return searchWeb(enabled, query);
}
