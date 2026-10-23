// 联网检索（第六章）：区分「服务商检索」（消耗额度、进入 AI 依据）与
// 「直接搜索引擎」（只开结果页、不消耗额度、不进入上下文）。

import { call } from './bridge.js';
import { SEARCH_ENGINES } from '../../shared/constants.js';
import { wrapUntrusted, UNTRUSTED_NOTICE } from '../../shared/untrusted.js';
import { isRelevantToQuery } from '../../shared/verify.js';

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
  // 逐条核对时只想要 3 条，不能再用设置里的全局条数（默认 6）。
  const maxResults = Number(hooks.maxResults) > 0 ? Number(hooks.maxResults) : settings.search.maxResults;
  // 核对流程明确要求「不抓正文」时，不能被设置里的开关覆盖。
  const fetchPageContent =
    hooks.fetchPageContent !== undefined ? !!hooks.fetchPageContent : !!settings.search.fetchPageContent;
  const out = await call(
    'search.provider',
    {
      id: plat ? plat.id : undefined,
      query,
      maxResults,
      fetchPageContent,
      timeRange: hooks.timeRange !== undefined ? hooks.timeRange : settings.search.timeRange,
      // 原问题用于「查询理解」（DeepSeek 官方搜索的 ori_question）
      oriQuestion: hooks.oriQuestion || query,
      rid: hooks.rid
    },
    { timeoutMs: 90000 }
  );
  const results = out.results || [];
  const who = out.provider || (plat && plat.name) || '检索';
  if (hooks.onLog) {
    const bits = [];
    if (out.cached) bits.push('命中缓存');
    if (out.timeRange) {
      bits.push(out.timeFiltered ? `时间范围：${out.timeRange}` : `时间范围：${out.timeRange}（该引擎未生效）`);
    }
    hooks.onLog(`${who} 返回 ${results.length} 条来源${bits.length ? `（${bits.join('，')}）` : ''}`);
  }
  if (out.note && hooks.onNote) hooks.onNote(out.note);

  if (fetchPageContent && results.length) {
    for (const r of results.slice(0, 4)) {
      // DeepSeek 官方搜索在 need_content=true 时已直接带回正文，不用再抓一次
      if (r.content && r.content.length > 200) continue;
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
    cached: !!out.cached,
    timeRange: out.timeRange || '',
    timeFiltered: out.timeFiltered !== false
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

export function searchContextBlock(results, counts, query) {
  let list = Array.isArray(results) ? results : [];
  if (query) {
    const hit = list.filter((r) => isRelevantToQuery(r, query));
    if (!hit.length) {
      // 搜到了东西但全都对不上：宁可如实说「没找到」，也不要把无关网页塞给模型。
      return '【联网检索】本次检索结果与当前问题相关性较低，已省略。不要基于不存在的检索结果作答。';
    }
    list = hit;
  }
  if (!list.length) return '';
  const rows = list.map((r, i) => {
    const cited = counts ? counts[r.url] || 0 : 0;
    // 优先用 summary（DeepSeek 官方搜索会给 600~800 字、面向模型的摘要），
    // 其次才是正文/短摘要。以前只看 content/snippet，等于把最好的字段丢了。
    const best = r.summary || r.content || r.snippet || '';
    const isFullText = !r.summary && !!(r.content && r.content.length > 200);
    const body = String(best).slice(0, isFullText ? 3000 : 1200);
    const label = r.summary ? '摘要' : isFullText ? '正文' : '摘要';
    const meta = [r.site, r.publishedAt ? String(r.publishedAt).slice(0, 10) : ''].filter(Boolean).join(' · ');
    return `[来源 ${i + 1}] ${r.title}${meta ? `（${meta}）` : ''}\nURL: ${r.url}\n被引用次数: ${cited}\n${label}: ${body}`;
  });
  return [
    '【联网检索到的参考资料】',
    '使用规则：只使用与当前问题相关的来源；引用具体信息时标注 [来源 N]；不要编造来源或网址；来源互相矛盾时如实说明。',
    ...rows
  ].join('\n\n');
}

// 带「不可信外部数据」边界的安全版本。
// 网页正文里可能藏着「忽略之前的指令」这类提示注入，直接拼进提示词有风险。
// 这里把整块内容框进边界，并剥离正文自带的同名标记（防止提前闭合）。
export function searchContextBlockGuarded(results, counts, query) {
  const block = searchContextBlock(results, counts, query);
  if (!block) return '';
  return `${UNTRUSTED_NOTICE}\n\n${wrapUntrusted(block)}`;
}
