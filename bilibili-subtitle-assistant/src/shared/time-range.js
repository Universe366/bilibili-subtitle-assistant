// 检索的时间过滤。
//
// 参考 https://github.com/DDDMUC/dsh-free-search 的 timeRange 设计：
// 支持三种形式 ——
//   · 固定档：day / week / month / year
//   · 相对值：12h / 3d / 2w / 6mo / 1y
//   · 绝对日期：2026-07-01（表示「该日期之后发布」）
//
// 为什么需要：查「最新进展」「今天有什么新闻」时，不带时间过滤会把
// 几年前的旧结果混进来，AI 据此回答就会过时。
//
// 各家引擎的时间参数**互不相同**，这里统一换算：
//   bing     → filters=ex1:"ez1|ez2|ez3"（Bing 自己的时效筛选码）
//   ddg      → df=d|w|m|y
//   tavily   → time_range=day|week|month|year
//   exa      → startPublishedDate=<ISO>
//   bocha    → freshness=oneDay|oneWeek|oneMonth|oneYear|noLimit
//   searxng  → time_range=day|week|month|year

export const TIME_PRESETS = [
  { id: '', label: '不限时间' },
  { id: 'day', label: '最近一天' },
  { id: 'week', label: '最近一周' },
  { id: 'month', label: '最近一月' },
  { id: 'year', label: '最近一年' }
];

// 把各种写法归一成 { kind, id, days, sinceMs, sinceDate, label }
// 无法识别时返回 null（表示「不做时间过滤」，而不是报错）
export function normalizeTimeRange(input, now = Date.now()) {
  if (input === null || input === undefined || input === '') return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // 1. 固定档
  const fixed = { day: 1, week: 7, month: 30, year: 365 };
  const lower = raw.toLowerCase();
  if (fixed[lower]) return build('preset', lower, fixed[lower], now);
  // 固定档的中文/别名
  const alias = {
    一天: 'day', '1天': 'day', 今日: 'day', 今天: 'day',
    一周: 'week', '1周': 'week', 本周: 'week',
    一月: 'month', '1月': 'month', 本月: 'month',
    一年: 'year', '1年': 'year', 今年: 'year'
  };
  if (alias[raw]) return build('preset', alias[raw], fixed[alias[raw]], now);

  // 2. 绝对日期：2026-07-01 / 2026/07/01
  const dateOnly = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const m = Number(dateOnly[2]);
    const d = Number(dateOnly[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const ms = Date.UTC(y, m - 1, d);
      if (!Number.isNaN(ms)) {
        return {
          kind: 'absolute',
          id: raw,
          sinceMs: ms,
          sinceDate: isoDate(ms),
          days: Math.max(1, Math.ceil((now - ms) / 86400000)),
          label: `${y}-${pad(m)}-${pad(d)} 之后`
        };
      }
    }
    return null;
  }

  // 3. 相对值：12h / 3d / 2w / 6mo / 1y
  const rel = /^(\d+)\s*(h|hr|hrs|hour|hours|小时|d|day|days|天|w|week|weeks|周|mo|mon|month|months|月|y|yr|year|years|年)$/i.exec(raw);
  if (rel) {
    const n = Number(rel[1]);
    if (!n) return null;
    const unit = rel[2].toLowerCase();
    let days;
    let id;
    if (/^h/.test(unit) || unit === '小时') {
      days = n / 24;
      id = `${n}h`;
    } else if (/^d/.test(unit) || unit === '天') {
      days = n;
      id = `${n}d`;
    } else if (/^w/.test(unit) || unit === '周') {
      days = n * 7;
      id = `${n}w`;
    } else if (/^mo/.test(unit) || /^mon/.test(unit) || unit === '月') {
      days = n * 30;
      id = `${n}mo`;
    } else {
      days = n * 365;
      id = `${n}y`;
    }
    return build('relative', id, days, now);
  }
  return null;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function isoDate(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function build(kind, id, days, now) {
  const sinceMs = now - days * 86400000;
  const presetLabel = (TIME_PRESETS.find((p) => p.id === id) || {}).label;
  return {
    kind,
    id,
    days,
    sinceMs,
    sinceDate: isoDate(sinceMs),
    label: presetLabel || `最近 ${id}`
  };
}

// 映射到具体引擎的参数。返回 {} 表示该引擎不支持时间过滤。
export function timeParamsFor(engineOrKind, tr) {
  if (!tr) return {};
  const days = tr.days;
  // 归到最接近的档（Bing/DDG/Tavily 这类只支持粗档）
  const bucket = days <= 1 ? 'day' : days <= 7 ? 'week' : days <= 31 ? 'month' : 'year';
  const k = String(engineOrKind || '').toLowerCase();

  if (k === 'bing') {
    // Bing 的时效码：ez1=过去24小时, ez2=过去一周, ez3=过去一月
    const code = bucket === 'day' ? 'ez1' : bucket === 'week' ? 'ez2' : 'ez3';
    // year 档 Bing 没有直接对应，退化为过去一月（宁可偏新，不要偏旧）
    return { filters: `ex1:"${code}"` };
  }
  if (k === 'ddg' || k === 'duckduckgo') {
    const df = bucket === 'day' ? 'd' : bucket === 'week' ? 'w' : bucket === 'month' ? 'm' : 'y';
    return { df };
  }
  if (k === 'searxng' || k === 'searxng-public') {
    return { time_range: bucket };
  }
  if (k === 'tavily') {
    return { time_range: bucket };
  }
  if (k === 'exa' || k === 'exa-mcp') {
    return { startPublishedDate: new Date(tr.sinceMs).toISOString() };
  }
  if (k === 'bocha') {
    const freshness =
      bucket === 'day' ? 'oneDay' : bucket === 'week' ? 'oneWeek' : bucket === 'month' ? 'oneMonth' : 'oneYear';
    return { freshness };
  }
  if (k === 'zhipu') {
    // 智谱 web_search 用 search_recency_filter：oneDay/oneWeek/oneMonth/oneYear/noLimit
    const map = { day: 'oneDay', week: 'oneWeek', month: 'oneMonth', year: 'oneYear' };
    return { search_recency_filter: map[bucket] };
  }
  if (k === 'metaso') {
    // 秘塔支持按时间范围筛选
    return { timeRange: bucket === 'day' ? 'day' : bucket === 'week' ? 'week' : bucket === 'month' ? 'month' : 'year' };
  }
  if (k === 'baidu') {
    // 百度千帆 AI 搜索：search_recency_filter
    const map = { day: 'day', week: 'week', month: 'month', year: 'year' };
    return { search_recency_filter: map[bucket] };
  }
  return {};
}

// 哪些引擎**真的**会按时间过滤。
//
// ⚠ 这份清单是实测定下来的，不是照抄文档：
//   · Bing 网页 / DuckDuckGo / SearXNG 公开实例 —— 实测 URL 参数
//     （filters=ex1:"ez1"、qft=+filterui:age-lt7、df=d）**全部无效**，
//     返回结果与不带过滤时完全一致。所以它们**不在此列**。
//   · Exa MCP 的匿名端点同样忽略 startPublishedDate（实测）。
//   · 剩下这些是按官方 API 文档会接受时间参数的**付费/正式**平台；
//     它们需要用户自己的 Key，因此**未在无 Key 状态下实测**，
//     标注为「按接口文档支持」，不是「已验证」。
//
// 这样做的原因：宁可少承诺，也不要让用户以为过滤生效了、实际拿到旧结果。
export const TIME_CAPABLE = new Set([
  'tavily',   // time_range（官方文档）
  'exa',      // startPublishedDate（官方文档）
  'bocha',    // freshness（官方文档）
  'zhipu',    // search_recency_filter（官方文档）
  'metaso',   // timeRange（官方文档）
  'baidu',    // search_recency_filter（官方文档）
  'brave'     // freshness（官方文档）
]);

// 免费无 Key 引擎中，实测**没有**任何一个支持时间过滤
export const KEYLESS_TIME_CAPABLE = new Set();

export function supportsTime(engineId) {
  return TIME_CAPABLE.has(String(engineId || '').toLowerCase());
}

// 该引擎是否属于「免费无 Key」档
export function isKeylessEngine(engineId) {
  const id = String(engineId || '').toLowerCase();
  return id === 'bing' || id === 'ddg' || id === 'searxng-public'
    || id === 'anysearch' || id === 'exa-mcp' || KEYLESS_TIME_CAPABLE.has(id);
}
