import { session } from 'electron';
import type { AppSettings, SearchTimeRange, WebReference } from '../shared/types';

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

async function timeoutFetch(url: string, init: RequestInit, timeoutMs = 15000): Promise<Response> {
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

async function searchTavily(query: string, settings: AppSettings): Promise<WebReference[]> {
  const key = settings.search.apiKey.trim();
  if (!key) throw new Error('Tavily 需要 API Key（设置 → 联网检索）');
  const body: Record<string, unknown> = {
    api_key: key,
    query,
    max_results: settings.search.maxResults,
    include_answer: false,
    include_raw_content: settings.search.includeContent,
    search_depth: 'basic'
  };
  const days = daysFor(settings.search.timeRange);
  if (days) body.days = days;

  const res = await timeoutFetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Tavily HTTP ${res.status}：${text.slice(0, 160)}`);
  }
  const json: any = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  return results.map((item: any) => ({
    title: item.title,
    url: item.url,
    snippet: item.content || item.raw_content || ''
  }));
}

async function searchBrave(query: string, settings: AppSettings): Promise<WebReference[]> {
  const key = settings.search.apiKey.trim();
  if (!key) throw new Error('Brave 需要 API Key（设置 → 联网检索）');
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
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
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Brave HTTP ${res.status}：${text.slice(0, 160)}`);
  }
  const json: any = await res.json();
  const results = Array.isArray(json?.web?.results) ? json.web.results : [];
  return results.map((item: any) => ({
    title: item.title,
    url: item.url,
    snippet: item.description || ''
  }));
}

async function searchAnySearch(query: string, settings: AppSettings): Promise<WebReference[]> {
  const res = await timeoutFetch('https://api.anysearch.com/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ query, max_results: settings.search.maxResults })
  });
  if (!res.ok) throw new Error(`AnySearch HTTP ${res.status}`);
  const json: any = await res.json();
  const results = Array.isArray(json?.data?.results)
    ? json.data.results
    : Array.isArray(json?.results)
      ? json.results
      : [];
  return results.map((item: any) => ({
    title: item.title,
    url: item.url || item.link,
    snippet: item.snippet || item.content || ''
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
      // 忽略非 JSON 行
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
    if (highlights >= 0) {
      body = chunk.slice(highlights + 'Highlights:'.length);
    } else {
      const author = /^Author:.*$/m.exec(chunk);
      if (author) body = chunk.slice(author.index + author[0].length);
    }
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

export async function searchWeb(settings: AppSettings, query: string): Promise<WebReference[]> {
  if (!settings.search.enabled) return [];
  const max = settings.search.maxResults;

  if (settings.search.provider === 'tavily') {
    return normalize(await searchTavily(query, settings), max);
  }
  if (settings.search.provider === 'brave') {
    return normalize(await searchBrave(query, settings), max);
  }

  // 免 Key 引擎互为兜底；任一成功即可。
  const order =
    settings.search.provider === 'exa' ? ['exa', 'anysearch'] : ['anysearch', 'exa'];
  let lastError: unknown = null;
  for (const engine of order) {
    try {
      const rows = engine === 'exa' ? await searchExa(query, settings) : await searchAnySearch(query, settings);
      const normalized = normalize(rows, max);
      if (normalized.length) return normalized;
      lastError = new Error(`${engine} 返回空结果`);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`检索失败：${(lastError as Error)?.message || '没有可用结果'}`);
}

export async function testSearch(
  settings: AppSettings,
  query: string
): Promise<WebReference[]> {
  const enabled = { ...settings, search: { ...settings.search, enabled: true } };
  return searchWeb(enabled, query);
}
