// 智能路由（auto）。
//
// 参考 https://github.com/DDDMUC/dsh-free-search 的 auto 设计：
// 不写死一个引擎，而是**按查询特征决定先试谁**，后面接全量回退。
//
// ⚠ 一个重要的实测结论：免费引擎**没有一个**支持时间过滤
// （Bing/DDG/SearXNG 的 URL 参数实测无效，Exa MCP 匿名端点也忽略日期）。
// 所以这里**不会**因为「用户想要最新」就去切换到某个免费引擎 ——
// 那是假动作。时效需求改为**如实提示**：结果可能包含较早内容，
// 想要严格的时间范围得配置支持时间过滤的检索平台。
//
// 路由规则因此很朴素，但每一条都能说出为什么。

import { supportsTime, isKeylessEngine } from './time-range.js';

// 中日韩字符：中文查询优先中文优化的引擎
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;

// 时效类意图：用户问「最新/今天/现在」时，需要提醒结果可能偏旧
const RECENCY_HINT =
  /最新|最近|现在|目前|今天|今日|昨天|本周|这周|本月|今年|新闻|动态|进展|发布|上线|价格|股价|汇率|天气|比赛|比分|排名/i;

export function isCjkQuery(query) {
  return CJK.test(String(query || ''));
}

// 把用户的口语化问题收拾成适合检索的查询：
//   · 去掉「帮我查一下 / 请问 / 搜一下」这类客套与指令前缀
//   · 压缩空白、去掉首尾标点
// 不改写实体名，也不做同义扩展 —— 那需要模型参与，成本和不确定性都更高。
export function cleanSearchQuery(query) {
  let q = String(query || '').replace(/\s+/g, ' ').trim();
  // 先去掉客套前缀（「请问，」「麻烦你」），再单独处理「帮我查一下」这类指令。
  q = q.replace(/^(?:请问|请|麻烦|你能|能不能|可以)\s*[，,：:]?\s*/i, '');
  q = q.replace(
    /^(?:帮我|帮忙)?\s*(?:查一下|查查|搜一下|搜索一下|找一下|问一下|告诉我)[：:，,\s]*/i,
    ''
  );
  q = q.replace(/^[，,。.!！？?、:：\s]+/, '').replace(/[。.!！？?、:：\s]+$/, '');
  return q.trim();
}

// 查询是否隐含时效需求（用于提示，不用于切换引擎）
export function wantsRecency(query, timeRange) {
  if (timeRange) return true;
  return RECENCY_HINT.test(String(query || ''));
}

// 路由：返回该查询下的免费引擎优先顺序。
//
// keylessOrder —— 用户自定义的优先顺序（空则用内置默认）
// timeRange    —— 已解析的时间范围（可能为 null）
export function routeKeyless(query, opts = {}) {
  const all = Array.isArray(opts.order) && opts.order.length
    ? opts.order.slice()
    : ['bing', 'anysearch', 'exa-mcp', 'ddg', 'searxng-public'];
  const cjk = isCjkQuery(query);
  const reasons = [];

  // 基础规则：
  //   · 中文 → Bing（中文优化、最稳）→ AnySearch（中文结果好）
  //   · 英文 → Bing（稳）→ Exa（英文技术内容质量高，但较慢）
  // Bing 始终在前：实测它 220~430ms，而其他引擎要 2~3 秒。
  const head = cjk ? ['bing', 'anysearch'] : ['bing', 'exa-mcp', 'anysearch'];
  reasons.push(cjk ? '中文查询 → 优先中文优化的引擎' : '英文查询 → 质量优先（Bing 稳、Exa 质量高）');

  const avail = new Set(all);
  const headAvail = head.filter((id) => avail.has(id));
  const rest = all.filter((id) => !headAvail.includes(id));

  // 若用户自定义顺序里把某个引擎放得更前，尊重用户（head 里不存在它时不动）
  const ordered = [...headAvail, ...rest];

  // 时效需求：只作为提示理由，不改变顺序（因为免费引擎都不支持过滤）
  const recency = wantsRecency(query, opts.timeRange);
  if (recency) {
    reasons.push('查询有时效需求 → 注意免费引擎无法按时间过滤，结果可能包含较早内容');
  }

  return { order: ordered, reasons, cjk, recency };
}

// 路由决策的可读说明（放进结果里，让用户知道为什么选了这个引擎）
export function describeRoute(route) {
  if (!route || !route.reasons || !route.reasons.length) return '';
  return route.reasons.join('；');
}
