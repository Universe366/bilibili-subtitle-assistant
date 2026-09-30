// 联网检索（第六章）：区分「服务商检索」（消耗额度、进入 AI 依据）与
// 「直接搜索引擎」（只开结果页、不消耗额度、不进入上下文）。

import { call } from './bridge.js';
import { SEARCH_ENGINES } from '../../shared/constants.js';
import { wrapUntrusted, UNTRUSTED_NOTICE } from '../../shared/untrusted.js';

export function engineUrl(engineId, query) {
  const e = SEARCH_ENGINES.find((x) => x.id === engineId) || SEARCH_ENGINES[0];
  return e.url.replace('%s', encodeURIComponent(String(query || '')));
}

export function engineLabel(engineId) {
  const e = SEARCH_ENGINES.find((x) => x.id === engineId);
  return e ? e.label : engineId;
}

// 服务商检索：结果作为 AI 的依据（消耗额度）
//
// 注意：**这里不再因为「没配 Key」就直接失败**。
// 后台会先试配置的平台，失败（或没配）时自动改用免费无 Key 引擎兜底，
// 所以「装了扩展但没配检索 Key」也能真的联网。
export async function runProviderSearch(settings, query, hooks = {}) {
  const plat = (settings.search.platforms || []).find((p) => p.id === settings.search.activeId) || null;
  const out = await call(
    'search.provider',
    {
      id: plat ? plat.id : undefined,
      query,
      maxResults: settings.search.maxResults,
      fetchPageContent: settings.search.fetchPageContent
    },
    { timeoutMs: 90000 }
  );
  const results = out.results || [];
  const who = out.provider || (plat && plat.name) || '检索';
  if (hooks.onLog) {
    hooks.onLog(
      out.cached
        ? `命中缓存：${who}（${results.length} 条来源）`
        : `${who} 返回 ${results.length} 条来源${out.note ? `（${out.note}）` : ''}`
    );
  }
  if (out.note && hooks.onNote) hooks.onNote(out.note);

  if (settings.search.fetchPageContent && results.length) {
    for (const r of results.slice(0, 4)) {
      try {
        const page = await call('search.fetch-page', { url: r.url }, { timeoutMs: 45000 });
        if (page && page.text) r.content = page.text;
      } catch (err) {
        /* 抓正文失败不影响主流程 */
      }
    }
  }
  return {
    results,
    query,
    provider: who,
    at: Date.now(),
    keyless: out.keyless || null,
    note: out.note || '',
    cached: !!out.cached
  };
}

// 直接搜索引擎：只打开结果页，不消耗额度，不进上下文
export async function openEngineSearch(settings, query) {
  const engine = settings.search.engine || 'bing';
  const url = engineUrl(engine, query);
  await call('search.open-engine', { engine, query }, { timeoutMs: 15000 });
  return { url, engine };
}

// 引用统计：每条来源被引用了几次（按域名 + URL 计数）
export function countCitations(text, results) {
  const body = String(text || '');
  const counts = {};
  let total = 0;
  for (const r of results || []) {
    let n = 0;
    if (r.url && body.includes(r.url)) n += 1;
    let host = '';
    try {
      host = new URL(r.url).hostname.replace(/^www\./, '');
    } catch (err) {
      host = '';
    }
    if (host) {
      const re = new RegExp(host.replace(/\./g, '\\.'), 'g');
      const m = body.match(re);
      if (m) n += m.length;
    }
    // 标题被提到也算一次引用
    if (r.title && r.title.length > 4 && body.includes(r.title)) n += 1;
    counts[r.url] = n;
    total += n;
  }
  return { counts, total };
}

export function searchContextBlock(results, counts) {
  if (!results || !results.length) return '';
  const rows = results.map((r, i) => {
    const cited = counts ? counts[r.url] || 0 : 0;
    // 抓到正文时给 AI 更多内容（每条最多 3000 字）。
    // 之前只截 900 字 —— 那是「摘要级」的长度，装不下网页正文，
    // 于是「抓取页面正文」抓了也几乎用不上。
    const isFullText = !!(r.content && r.content.length > 200);
    const body = (r.content || r.snippet || '').slice(0, isFullText ? 3000 : 900);
    const label = isFullText ? '正文' : '摘要';
    return `[来源 ${i + 1}] ${r.title}\nURL: ${r.url}\n被引用次数: ${cited}\n${label}: ${body}`;
  });
  return ['【联网检索到的参考资料】', ...rows].join('\n\n');
}

// 带「不可信外部数据」边界的安全版本。
// 网页正文里可能藏着「忽略之前的指令」这类提示注入，直接拼进提示词有风险。
// 这里把整块内容框进边界，并剥离正文自带的同名标记（防止提前闭合）。
export function searchContextBlockGuarded(results, counts) {
  const block = searchContextBlock(results, counts);
  if (!block) return '';
  return `${UNTRUSTED_NOTICE}\n\n${wrapUntrusted(block)}`;
}
