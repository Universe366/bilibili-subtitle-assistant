// 免费无 Key 搜索引擎。
//
// 为什么需要：原来的「联网检索」必须先配一个检索平台的 API Key，
// 否则点搜就报「检索服务商还没配好」—— 用户装完扩展，联网功能其实是不可用的。
//
// 参考 https://github.com/DDDMUC/dsh-free-search 的思路：
// 把「无需 Key、开箱即用」的引擎作为兜底，任何引擎失败都自动轮到下一个，
// **搜索永不因为缺 Key 而直接失败**。
//
// 本机实测（2026-02）：
//   ✅ bing      HTML 抓取，10 条结果，中文优化，无需 Key（最稳）
//   ✅ anysearch POST JSON，匿名额度，返回 { code, message, data: { results } }
//   ✅ exa-mcp   MCP 匿名端点，返回带正文的高质量结果
//   ❌ ddg / searxng 公开实例 —— 当前网络环境不可达（代码保留，能通则用）
//
// 注意：这些是**第三方公开服务**，不保证长期稳定，也不保证额度。
// 因此它们只作为「兜底」，用户配置了自己的付费/正式 Key 时优先用配置的。

import { timeParamsFor, supportsTime } from '../shared/time-range.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// SearXNG 公开实例（实测多不可达，仅作候选；用户也可填自建实例）
export const SEARXNG_INSTANCES = [
  'https://opnxng.com',
  'https://priv.au',
  'https://searx.be',
  'https://searx.tiekoetter.com',
  'https://search.inetol.net',
  'https://paulgo.io'
];

export const KEYLESS_ENGINES = [
  {
    id: 'bing',
    label: 'Bing 网页',
    note: '无需 Key，中文优化，最稳定',
    needsKey: false,
    supportsTime: false
  },
  {
    id: 'anysearch',
    label: 'AnySearch',
    note: '无需 Key（匿名额度），返回结构化结果',
    needsKey: false,
    supportsTime: false
  },
  {
    id: 'exa-mcp',
    label: 'Exa（MCP 匿名端点）',
    note: '无需 Key，结果质量高、带正文摘要',
    needsKey: false,
    supportsTime: false
  },
  {
    id: 'ddg',
    label: 'DuckDuckGo',
    note: '无需 Key，但常被反爬限流',
    needsKey: false,
    supportsTime: false
  },
  {
    id: 'searxng-public',
    label: 'SearXNG（公开实例）',
    note: '无需 Key，多实例轮询；公开实例稳定性差',
    needsKey: false,
    supportsTime: false
  }
];

// 默认兜底顺序：先最稳的，再质量高的，最后的作为补充
export const DEFAULT_KEYLESS_ORDER = ['bing', 'anysearch', 'exa-mcp', 'ddg', 'searxng-public'];

export function keylessLabel(id) {
  const e = KEYLESS_ENGINES.find((x) => x.id === id);
  return e ? e.label : id;
}

// ---------------------------------------------------------------------------
// 工具：HTML 实体与标签清理
// ---------------------------------------------------------------------------

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ensp;|&emsp;|&thinsp;|&nbsp;/g, ' ')
    .replace(/&middot;|&bull;/g, '·')
    .replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// Bing 会把关键词用 <strong> 包起来以高亮，直接去标签会在中文之间留下多余空格
// （「人工智能（智能科学…）」会变成「人工智能 （ 智能 科学」）。
// 这里先把高亮标签替换成「零宽标记」，去标签后再统一清理。
const HL_OPEN = '\u0000';
const HL_CLOSE = '\u0001';

function stripTags(s) {
  const t = String(s || '')
    .replace(/<\/?strong[^>]*>/gi, (m) => (m.startsWith('</') ? HL_CLOSE : HL_OPEN))
    .replace(/<\/?b[^>]*>/gi, (m) => (m.startsWith('</') ? HL_CLOSE : HL_OPEN))
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(t)
    .replace(new RegExp(`\\s*${HL_OPEN}\\s*`, 'g'), HL_OPEN)
    .replace(new RegExp(`\\s*${HL_CLOSE}\\s*`, 'g'), HL_CLOSE)
    // 高亮标记两侧不留空格，但保留相邻的普通空格
    .replace(new RegExp(`${HL_OPEN}`, 'g'), '')
    .replace(new RegExp(`${HL_CLOSE}`, 'g'), '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([，。、；：？！）】》」』])/g, '$1')
    .replace(/([（【《「『])\s+/g, '$1')
    .trim();
}

// 统一结果形状
function mkResult(title, url, snippet, content) {
  return {
    title: stripTags(title).slice(0, 200) || String(url || ''),
    url: String(url || '').trim(),
    snippet: stripTags(snippet).slice(0, 800),
    content: content ? String(content).slice(0, 4000) : ''
  };
}

// ---------------------------------------------------------------------------
// 1. Bing 网页（HTML 抓取）
// ---------------------------------------------------------------------------

export function parseBingHtml(html) {
  const out = [];
  const blocks = String(html || '').match(/<li class="b_algo"[\s\S]*?<\/li>/g) || [];
  for (const block of blocks) {
    // 标题链接：优先 h2 里的 <a href>
    const h2 = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!h2) continue;
    const url = decodeEntities(h2[1]);
    const title = stripTags(h2[2]);
    // 摘要：b_caption 里的 <p>
    let snippet = '';
    const cap = /<div class="b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    if (cap) {
      const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(cap[1]);
      snippet = stripTags(p ? p[1] : cap[1]);
    }
    if (!snippet) {
      // 退化：取 cite 之外的第一段可见文本
      const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
      if (p) snippet = stripTags(p[1]);
    }
    if (!url || !/^https?:/i.test(url)) continue;
    out.push(mkResult(title, url, snippet, ''));
  }
  return out;
}

async function searchBing(query, max, opts) {
  // 时间过滤：Bing 用 filters=ex1:"ez1|ez2|ez3"
  const tp = timeParamsFor('bing', opts.timeRange);
  const parts = [`q=${encodeURIComponent(query)}`, 'setlang=zh-CN', `count=${Math.min(20, max)}`];
  if (tp.filters) parts.push(`filters=${encodeURIComponent(tp.filters)}`);
  const url = `https://www.bing.com/search?${parts.join('&')}`;
  const res = await timedFetch(url, {
    method: 'GET',
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
    }
  }, opts);
  if (!res.ok) throw new Error(`Bing HTTP ${res.status}`);
  const html = await res.text();
  const rows = parseBingHtml(html);
  if (!rows.length) throw new Error('Bing 未解析出结果（可能被反爬拦截）');
  return rows.slice(0, max);
}

// ---------------------------------------------------------------------------
// 2. AnySearch（匿名额度）
// ---------------------------------------------------------------------------

export function parseAnySearch(json) {
  const arr = (json && json.data && Array.isArray(json.data.results) && json.data.results) ||
    (json && Array.isArray(json.results) && json.results) || [];
  return arr
    .map((r) => mkResult(r.title, r.url || r.link, r.snippet || r.content, r.content))
    .filter((r) => r.url && /^https?:/i.test(r.url));
}

async function searchAnySearch(query, max, opts) {
  const res = await timedFetch(
    'https://api.anysearch.com/v1/search',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ query, max_results: Math.min(20, max) })
    },
    opts
  );
  if (!res.ok) throw new Error(`AnySearch HTTP ${res.status}`);
  const json = await res.json();
  const rows = parseAnySearch(json);
  if (!rows.length) throw new Error('AnySearch 返回空结果');
  return rows.slice(0, max);
}
// ---------------------------------------------------------------------------
// 3. Exa MCP（匿名端点）
// ---------------------------------------------------------------------------

// Exa MCP 返回的是一段结构化纯文本，形如：
//   Title: xxx
//   URL: https://...
//   Published: N/A
//   Author: N/A
//   Highlights:
//   ...
export function parseExaMcpText(text) {
  const rows = [];
  const chunks = String(text || '').split(/\n(?=Title:)/);
  for (const chunk of chunks) {
    const title = /^Title:\s*(.*)$/m.exec(chunk);
    const url = /^URL:\s*(\S+)/m.exec(chunk);
    if (!title || !url) continue;
    // 正文取 Highlights 之后（或 Author 之后）的内容
    let body = chunk;
    const hi = chunk.indexOf('Highlights:');
    if (hi >= 0) body = chunk.slice(hi + 'Highlights:'.length);
    else {
      const au = /^Author:.*$/m.exec(chunk);
      if (au) body = chunk.slice(au.index + au[0].length);
    }
    const clean = stripTags(body).slice(0, 4000);
    rows.push(mkResult(title[1], url[1], clean, clean));
  }
  return rows;
}

async function searchExaMcp(query, max, opts) {
  const url = 'https://mcp.exa.ai/mcp';
  const baseHeaders = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream'
  };
  // 握手
  const initRes = await timedFetch(
    url,
    {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'bilibili-subtitle-assistant', version: '1' }
        }
      })
    },
    opts
  );
  if (!initRes.ok) throw new Error(`Exa MCP 握手 HTTP ${initRes.status}`);
  const session = initRes.headers.get('mcp-session-id');
  const headers = session ? { ...baseHeaders, 'mcp-session-id': session } : baseHeaders;
  await initRes.text().catch(() => '');

  // 已初始化通知（失败不致命）
  try {
    await timedFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    }, { ...opts, timeoutMs: 10000 });
  } catch (err) {
    /* 忽略 */
  }

  const callRes = await timedFetch(
    url,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'web_search_exa',
          arguments: { query, numResults: Math.min(10, max), ...timeParamsFor('exa-mcp', opts.timeRange) }
        }
      })
    },
    opts
  );
  if (!callRes.ok) throw new Error(`Exa MCP 调用 HTTP ${callRes.status}`);
  const raw = await callRes.text();
  const json = parseRpcPayload(raw);
  const content = json && json.result && Array.isArray(json.result.content) ? json.result.content : [];
  const text = content.map((c) => c && c.text).filter(Boolean).join('\n');
  const rows = parseExaMcpText(text);
  if (!rows.length) throw new Error('Exa MCP 未返回可解析结果');
  return rows.slice(0, max);
}

// JSON-RPC 回包可能是纯 JSON，也可能是 SSE（data: 行）
export function parseRpcPayload(raw) {
  const text = String(raw || '').trim();
  if (text.startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch (err) {
      /* 落到 SSE 分支 */
    }
  }
  const lines = text.split(/\r?\n/).filter((l) => l.startsWith('data:'));
  for (const line of lines) {
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const j = JSON.parse(payload);
      if (j && (j.result || j.error)) return j;
    } catch (err) {
      /* 继续 */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4. DuckDuckGo（HTML / Lite）
// ---------------------------------------------------------------------------

export function parseDdgHtml(html) {
  const out = [];
  const src = String(html || '');
  // html.duckduckgo.com 用 result__a / result__snippet
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snipRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  const links = [];
  let m;
  while ((m = linkRe.exec(src))) links.push({ url: decodeEntities(m[1]), title: stripTags(m[2]) });
  const snips = [];
  while ((m = snipRe.exec(src))) snips.push(stripTags(m[1]));
  for (let i = 0; i < links.length; i += 1) {
    let u = links[i].url;
    // DDG 的跳转链接：/l/?uddg=<encoded>
    const uddg = /[?&]uddg=([^&]+)/.exec(u);
    if (uddg) {
      try {
        u = decodeURIComponent(uddg[1]);
      } catch (err) {
        /* 保持原样 */
      }
    }
    if (!/^https?:/i.test(u)) continue;
    out.push(mkResult(links[i].title, u, snips[i] || '', ''));
  }
  return out;
}

async function searchDdg(query, max, opts) {
  const tp = timeParamsFor('ddg', opts.timeRange);
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}${tp.df ? `&df=${tp.df}` : ''}`;
  const res = await timedFetch(
    url,
    { method: 'GET', headers: { 'user-agent': UA, accept: 'text/html', 'accept-language': 'zh-CN,zh;q=0.9' } },
    opts
  );
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();
  const rows = parseDdgHtml(html);
  if (!rows.length) throw new Error('DuckDuckGo 未解析出结果（常为反爬限流）');
  return rows.slice(0, max);
}

// ---------------------------------------------------------------------------
// 5. SearXNG（公开实例轮询，也支持用户自建实例）
// ---------------------------------------------------------------------------

export function parseSearxngJson(json) {
  const arr = (json && Array.isArray(json.results) && json.results) || [];
  return arr
    .map((r) => mkResult(r.title, r.url, r.content || r.snippet, r.content))
    .filter((r) => r.url && /^https?:/i.test(r.url));
}

async function searchSearxngPublic(query, max, opts) {
  const instances = (opts && opts.instances && opts.instances.length) ? opts.instances : SEARXNG_INSTANCES;
  const errors = [];
  for (const base of instances) {
    try {
      const tp = timeParamsFor('searxng', opts.timeRange);
      const url = `${base.replace(/\/+$/, '')}/search?q=${encodeURIComponent(query)}&format=json${tp.time_range ? `&time_range=${tp.time_range}` : ''}`;
      const res = await timedFetch(
        url,
        { method: 'GET', headers: { 'user-agent': UA, accept: 'application/json' } },
        { ...opts, timeoutMs: Math.min(opts.timeoutMs || 15000, 12000) }
      );
      if (!res.ok) {
        errors.push(`${base}: HTTP ${res.status}`);
        continue;
      }
      const rows = parseSearxngJson(await res.json());
      if (rows.length) return rows.slice(0, max);
      errors.push(`${base}: 空结果`);
    } catch (err) {
      errors.push(`${base}: ${(err && err.message) || '失败'}`);
    }
  }
  throw new Error(`SearXNG 实例均不可用（${errors.slice(0, 3).join('; ')}）`);
}

// ---------------------------------------------------------------------------
// 调度
// ---------------------------------------------------------------------------

const RUNNERS = {
  bing: searchBing,
  anysearch: searchAnySearch,
  'exa-mcp': searchExaMcp,
  ddg: searchDdg,
  'searxng-public': searchSearxngPublic
};

// 带超时的 fetch（本模块自包含，避免依赖 providers.js 的内部实现）
async function timedFetch(url, init, opts = {}) {
  const ctl = new AbortController();
  const timeoutMs = Math.max(3000, Number(opts.timeoutMs) || 15000);
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => ctl.abort();
  if (opts.signal) opts.signal.addEventListener('abort', onAbort);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}

// 按顺序尝试；返回第一个成功的结果集。
// 失败原因全部保留，便于界面显示「为什么都失败了」。
//
// 关于时间过滤（重要）：
//   免费无 Key 引擎**没有一个**支持时间过滤 ——
//   Bing/DDG/SearXNG 的 URL 参数实测无效，Exa MCP 匿名端点也忽略日期。
//   所以这里照常把参数发出去（万一服务端哪天支持了），
//   但**不会声称结果已按时间过滤**；是否过滤由调用方按引擎如实标注。
export async function searchKeyless(query, opts = {}) {
  const max = Math.max(1, Math.min(20, Number(opts.maxResults) || 6));
  const order = (Array.isArray(opts.order) && opts.order.length ? opts.order : DEFAULT_KEYLESS_ORDER)
    .filter((id) => RUNNERS[id]);
  const tr = opts.timeRange || null;

  const attempts = [];
  for (const id of order) {
    const started = Date.now();
    try {
      const results = await RUNNERS[id](query, max, opts);
      attempts.push({
        engine: id,
        ok: true,
        ms: Date.now() - started,
        count: results.length,
        timeFiltered: supportsTime(id)
      });
      return {
        results,
        query,
        engine: id,
        engineLabel: keylessLabel(id),
        attempts,
        provider: null,
        timeRange: tr,
        timeFiltered: supportsTime(id)
      };
    } catch (err) {
      attempts.push({
        engine: id,
        ok: false,
        ms: Date.now() - started,
        error: (err && err.message) || String(err),
        timeFiltered: supportsTime(id)
      });
    }
  }

  return { results: [], query, engine: null, attempts, timeRange: tr, timeFiltered: false };
}

// 把尝试链路转成一句人话（用于界面提示）
export function describeAttempts(attempts) {
  if (!attempts || !attempts.length) return '';
  return attempts.map((a) => `${keylessLabel(a.engine)} ${a.ok ? `✓${a.count}条/${a.ms}ms` : `✗${a.error}`}`).join(' → ');
}
