// 事实核实：从字幕里挑出**具体待核实项**，逐条查，而不是整篇搜。
//
// 为什么重做（用户反馈：「联网后的内容和字幕内容相差好大，还污染了输出」）：
// 早先的做法是「用视频标题搜一次 → 把 6 条来源、每条最多 3000 字正文
// 整块塞进总结上下文」——
//   · 检索词是整段标题，搜回来的东西跟字幕里的具体术语往往无关
//   · 正文动辄上万字，直接把字幕挤成少数派
//   · 模型于是开始讲网页内容，而不是修正字幕
//
// 现在的做法：
//   · 只从字幕里抽出**具体的待核实项**（数字、年份、版本号、专有名词、专有说法）
//   · 每个待核实项单独检索，取回**简短证据**（摘要级，不抓正文）
//   · 做**相关性过滤**：结果与待核实项毫无词重叠的直接丢弃
//   · 只把「待核实项 → 证据摘录」这种紧凑结构交给模型
//
// 结果是上下文里多了几百字而不是几万字，且都对着字幕里的具体点。

// 不要拿来当检索词的「大词」——它们在任何网页里都出现，搜了也是噪声
const STOPWORDS = new Set([
  '视频', '内容', '我们', '他们', '你们', '这个', '那个', '什么', '怎么', '为什么',
  '可以', '应该', '如果', '因为', '所以', '但是', '而且', '然后', '现在', '今天',
  '一个', '一些', '非常', '特别', '其实', '就是', '这样', '那样', '大家', '自己',
  '问题', '时候', '地方', '东西', '事情', '情况', '方面', '方式', '方法', '结果',
  '第一', '第二', '第三', '最后', '开始', '结束', 'the', 'and', 'for', 'with', 'this',
  'that', 'from', 'have', 'will', 'your', 'about', 'into', 'than', 'then', 'they'
]);

function normTerm(t) {
  return String(t || '')
    .replace(/[，。、；：！？""''（）【】《》〈〉·…—～\s]+/g, ' ')
    .trim();
}

// 从字幕里抽出候选「待核实项」。
//
// 优先抽这几类 —— 它们最容易出错，也最好核实：
//   ① 年份 / 日期        ② 数字+单位（金额、比例、参数量）
//   ③ 版本号（V3、4.5、x2） ④ 英文术语 / 产品名   ⑤ 中文专业名词（2~6 字，含连接符或大写）
//
// 注意：不是简单取全篇 top-N —— 那样反复出现的开头术语会占满名额，
// 视频后半段的具体数字/术语一个都抽不到。这里先按时间轴分成 1~4 段，
// 每段各取几个，再用全篇结果补齐，保证早/中/后段都有覆盖。
function scoreText(text) {
  const bag = new Map(); // 词 -> { kind, count, score }
  const bump = (word, kind, weight) => {
    const w = normTerm(word);
    if (!w || w.length < 2 || w.length > 30) return;
    if (STOPWORDS.has(w.toLowerCase())) return;
    // 纯数字（如 "2026"）不单独当检索词，太泛
    const prev = bag.get(w);
    if (prev) {
      prev.score += weight;
      prev.count += 1;
    } else {
      bag.set(w, { kind, score: weight, count: 1, word: w });
    }
  };

  // ① 年份 + ② 数字+单位
  for (const m of text.matchAll(/(19|20)\d{2}\s*年?/g)) bump(m[0].trim(), 'year', 3);
  for (const m of text.matchAll(/\d+(?:\.\d+)?\s*(?:亿|万|千万|百万|千|百|%|％|倍|TB|GB|MB|KB|人|元|美元|次|个)/g)) {
    bump(m[0].trim(), 'number', 3);
  }
  // ③ 版本号
  for (const m of text.matchAll(/\b[vV]?\d+(?:\.\d+){1,3}\b/g)) bump(m[0].trim(), 'version', 2.5);
  // ④ 英文术语 / 产品名（长度 >= 3，避免 a / of 之类）
  for (const m of text.matchAll(/\b[A-Za-z][A-Za-z0-9+#._-]{2,30}\b/g)) {
    const w = m[0];
    if (/^(the|and|for|with|this|that|from|have|will|not|are|was|were|you|can|但是)$/i.test(w)) continue;
    // 全小写的常见词降权，含大写或数字的更可能是专有名词
    const weight = /[A-Z]/.test(w) || /\d/.test(w) ? 2 : 1;
    bump(w, 'en', weight);
  }
  // ⑤ 中文专业名词：连续 2~6 个汉字，且不是常用口语词
  for (const m of text.matchAll(/[\u4e00-\u9fa5]{2,6}/g)) {
    const w = m[0];
    if (STOPWORDS.has(w)) continue;
    bump(w, 'cn', 0.8);
  }
  return bag;
}

function topTerms(bag, n) {
  return [...bag.values()]
    // 中文只出现一次的短词多半是「正式发布 / 非常便宜」这类泛词，搜出来也很怪；
    // 只保留在字幕里重复出现过的中文词（专名通常会在视频里被多次提到）。
    .filter((x) => x.kind !== 'cn' || x.count >= 2)
    .sort((a, b) => b.score - a.score || b.word.length - a.word.length)
    .slice(0, Math.max(0, n))
    .map((x) => x.word);
}

export function extractVerifyItems(lines, limit = 6) {
  const list = Array.isArray(lines) ? lines : [];
  const text = list.map((l) => String(l.text || '')).join('\n');
  if (!text.trim()) return [];
  const total = Math.max(1, Math.min(32, Number(limit) || 6));
  // 片段数：长字幕最多 4 段；短字幕按行数收敛，避免每段只有一行
  const segCount = Math.max(1, Math.min(4, list.length, total >= 8 ? 4 : total >= 4 ? 2 : 1));
  const perSeg = Math.max(1, Math.ceil(total / segCount));
  const size = Math.ceil(list.length / segCount) || 1;
  const picked = [];
  const seen = new Set();
  for (let s = 0; s < segCount; s += 1) {
    const from = s * size;
    const to = s === segCount - 1 ? list.length : Math.min(list.length, from + size);
    const bag = scoreText(list.slice(from, to).map((l) => String(l.text || '')).join('\n'));
    for (const w of topTerms(bag, perSeg)) {
      if (!seen.has(w)) {
        seen.add(w);
        picked.push(w);
      }
    }
  }
  if (picked.length < total) {
    for (const w of topTerms(scoreText(text), total * 2)) {
      if (picked.length >= total) break;
      if (!seen.has(w)) {
        seen.add(w);
        picked.push(w);
      }
    }
  }
  return picked.slice(0, total);
}

// ---------------------------------------------------------------------------
// 检索结果相关性
// ---------------------------------------------------------------------------
//
// 旧实现的两个硬伤（用户反馈「联网搜回来的东西好多都不符合」）：
//   ① 只按空格/标点切词 —— 中文查询根本没有空格，整句被当成一个词，
//      于是要么要求整句原文出现（几乎全被丢掉），要么单词命中就算相关（噪声全进来）；
//   ② 只看 title + snippet —— DeepSeek 官方搜索把给模型看的 600~800 字摘要放在
//      summary 字段，这里看不到，等于用一条 100 字摘要判断整篇。
//
// 现在的做法：
//   · 归一化（全角、大小写、连字符/下划线/标点）后再比对，`DeepSeek-V4` 能命中 `deepseek v4`；
//   · 英文/数字按 token 命中，中文按**相邻二字组**命中，且靠前的二字组权重更高
//     （「达摩院发布新模型」不会因为共享「发布/模型」就匹配到「阿里发布新模型」）；
//   · title + summary + snippet + 正文前 2000 字一起作为判断依据。

// 归一化：全角转半角、小写、标点与连接符折叠成空格。
function normalizeMatchText(input) {
  return String(input || '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 中文里到处都是的二字组。它们不携带实体信息，不能作为相关性的依据。
const CJK_BIGRAM_STOP = new Set([
  '视频', '内容', '我们', '他们', '你们', '这个', '那个', '什么', '怎么', '为什',
  '可以', '应该', '如果', '因为', '所以', '但是', '而且', '然后', '现在', '今天',
  '昨天', '明天', '一个', '一些', '非常', '特别', '其实', '就是', '这样', '那样',
  '大家', '自己', '问题', '时候', '地方', '东西', '事情', '情况', '方面', '方式',
  '方法', '结果', '第一', '第二', '第三', '最后', '开始', '结束', '发布', '正式',
  '目前', '今年', '去年', '明年', '最新', '最近', '以及', '还有', '不过', '或者',
  '因此', '只要', '已经', '正在', '曾经', '表示', '认为', '觉得', '知道', '看到',
  '听到', '进行', '出现', '发生', '成为', '作为', '通过', '根据', '关于', '对于',
  '由于', '接着', '同时', '此外', '例如', '比如', '包括', '主要', '重要', '可能',
  '需要', '提供', '支持', '使用', '实现', '增加', '减少', '提高', '降低', '真的',
  '还是', '也是', '不是', '没有', '一下', '这些', '那些', '上面', '下面', '那么',
  '咱们', '来看', '看看', '说到', '讲到', '关于', '对于', '这边', '那边'
]);

const QUERY_SEGMENT = /[a-z0-9]+|[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;

// 把查询拆成「强词」（英文/数字 token）与「中文二字组」（带位置权重）。
function tokenizeQuery(query) {
  const norm = normalizeMatchText(query);
  const strong = [];
  const cjk = [];
  if (!norm) return { strong, cjk };
  for (const m of norm.matchAll(QUERY_SEGMENT)) {
    const seg = m[0];
    if (/^[a-z0-9]/.test(seg)) {
      if (seg.length >= 2 && !STOPWORDS.has(seg) && !strong.includes(seg)) strong.push(seg);
      continue;
    }
    const len = seg.length;
    if (len < 2) continue;
    for (let i = 0; i + 1 < len; i += 1) {
      const bg = seg.slice(i, i + 2);
      if (CJK_BIGRAM_STOP.has(bg)) continue;
      if (cjk.some((x) => x.t === bg)) continue;
      cjk.push({ t: bg });
    }
  }
  // 权重按「所有中文词」的整体顺序分配，而不是每段各自从 0 开始：
  // 「达摩院 新模型」和「达摩院新模型」必须得到同样的判断，
  // 不能因为加了空格就让后半段的「新模型」权重变大、把阿里发布新模型也放进来。
  const total = cjk.length;
  cjk.forEach((x, i) => {
    x.w = total - i;
    x.head = i < 2;
  });
  return { strong, cjk };
}

function cjkCoverage(hay, cjk) {
  if (!cjk.length) return 0;
  let total = 0;
  let got = 0;
  let headHit = false;
  for (const x of cjk) {
    total += x.w;
    if (hay.includes(x.t)) {
      got += x.w;
      if (x.head) headHit = true;
    }
  }
  const coverage = total ? got / total : 0;
  if (coverage >= 0.5) return coverage;
  // 覆盖度不够时，允许「词头命中」救回来，但仍要求至少 35% 的覆盖，
  // 避免只共享「发布 / 模型」这类谓语词就被判为相关。
  if (headHit && coverage >= 0.35) return coverage;
  return 0;
}

// 中文查询的判定不能要求「命中一半的二字组」：
// 按语境生成的查询往往是一整句（十几个二字组），要求一半等于必然全灭。
// 这里只要求两件事：
//   ① 实体部分（查询最前面的两个字组）命中；
//   ② 至少命中一个后续的限定词（时间 / 数字 / 动作 / 对象）。
// 如果实体没命中，则必须整体覆盖度很高，避免只共享泛词的网页混进来。
function cjkGate(hay, cjk) {
  if (!cjk.length) return false;
  const head = cjk.filter((x) => x.head);
  const aspect = cjk.filter((x) => !x.head);
  const headHit = head.some((x) => hay.includes(x.t));
  const aspectHit = aspect.some((x) => hay.includes(x.t));
  if (headHit && (!aspect.length || aspectHit)) return true;
  if (!head.length && aspectHit) return true;
  return cjkCoverage(hay, cjk) >= 0.6;
}

function buildHay(result) {
  return normalizeMatchText(
    [
      result && result.title,
      result && result.summary,
      result && result.snippet,
      String((result && result.content) || '').slice(0, 2000)
    ]
      .filter(Boolean)
      .join(' ')
  );
}

function hasEntityMatch(hay, result, strong, cjk) {
  if (!strong.length) return cjkGate(hay, cjk);
  const matched = strong.filter((t) => hay.includes(t)).length;
  const need = strong.length === 1 ? 1 : Math.min(2, strong.length);
  if (matched < need) return false;
  // 单个英文/数字实体时，要求它出现在标题或摘要里。
  // 否则「AI 行业周报」这种正文顺带提一句的页面也会被当成证据。
  if (strong.length === 1 && !cjk.length) {
    const headHay = normalizeMatchText(`${result.title || ''} ${result.summary || ''} ${result.snippet || ''}`);
    if (!headHay.includes(strong[0])) return false;
  }
  return true;
}

// 什么时候需要「字幕上下文」来兜底：
// 查询只有一个实体、且没有数字/版本时（「DeepSeek」「达摩院」「AI」），
// 搜回来的页面很容易只是提到这个名字，却跟字幕里的具体说法无关。
// 反过来，「DeepSeek V4」「6710 亿」「达摩院发布新模型」本身已经够具体，不再加限制。
function needsContextAnchor(query) {
  const { strong, cjk } = tokenizeQuery(query);
  if (/\d/.test(String(query || ''))) return false;
  if (strong.length >= 2) return false;
  if (strong.length === 0 && cjk.length >= 4) return false;
  return true;
}

function contextAnchorOk(hay, query, context) {
  if (!context || !needsContextAnchor(query)) return true;
  const ctx = normalizeMatchText(context);
  if (!ctx) return true;
  const q = tokenizeQuery(query);
  const queryTerms = new Set([...q.strong, ...q.cjk.map((x) => x.t)]);
  const { strong, cjk } = tokenizeQuery(ctx);
  const extra = [
    ...strong.filter((t) => !queryTerms.has(t)),
    ...cjk.filter((x) => !queryTerms.has(x.t)).map((x) => x.t)
  ];
  // 上下文里没有更多实词（整行都是泛词）时不做限制，避免误杀
  if (!extra.length) return true;
  return extra.some((t) => hay.includes(t));
}

// 相关度分数：只用于同一条查询内部排序
// （实体命中占比 0.7 + 中文覆盖 0.3 + 字幕上下文命中最多 0.25）。
export function relevanceScore(result, query, context) {
  if (!result) return 0;
  const hay = buildHay(result);
  if (!hay) return 0;
  const { strong, cjk } = tokenizeQuery(query);
  if (!strong.length && !cjk.length) return 0;
  let score = 0;
  if (strong.length) {
    const ratio = strong.filter((t) => hay.includes(t)).length / strong.length;
    score = ratio * 0.7 + cjkCoverage(hay, cjk) * 0.3;
  } else {
    score = cjkCoverage(hay, cjk);
  }
  if (context) {
    const q = tokenizeQuery(query);
    const queryTerms = new Set([...q.strong, ...q.cjk.map((x) => x.t)]);
    const ctx = tokenizeQuery(context);
    const extra = [...new Set([...ctx.strong, ...ctx.cjk.map((x) => x.t)])].filter((t) => !queryTerms.has(t));
    if (extra.length) {
      const hit = extra.filter((t) => hay.includes(t)).length;
      score += Math.min(0.25, (hit / extra.length) * 0.25);
    }
  }
  return score;
}

// 判断某条搜索结果是否与待核实项相关。
// context 可选：字幕里该检索词所在的那一行，用于过滤「只提到名字、不谈这件事」的结果。
export function isRelevantToQuery(result, query, context) {
  if (!result) return false;
  const hay = buildHay(result);
  if (!hay) return false;
  const { strong, cjk } = tokenizeQuery(query);
  if (!strong.length && !cjk.length) return false;
  if (!hasEntityMatch(hay, result, strong, cjk)) return false;
  return contextAnchorOk(hay, query, context);
}

function findBestLineIndex(list, probes) {
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < list.length; i += 1) {
    const norm = normalizeMatchText(list[i] && list[i].text);
    if (!norm) continue;
    let hits = 0;
    for (const p of probes) if (norm.includes(p)) hits += 1;
    if (!hits) continue;
    // 命中数优先；同一命中数下，优先选带数字/更长的行 ——
    // 「DeepSeek」在字幕里出现很多次，应该落在讲具体事实的那一句，而不是第一次寒暄。
    const digits = (norm.match(/\d/g) || []).length;
    const score = hits * 10 + Math.min(digits, 6) + Math.min(norm.length, 80) / 100;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

// 在字幕里找到与检索词最相关的一行。
export function contextLineForQuery(lines, query, maxChars = 200) {
  const list = Array.isArray(lines) ? lines : [];
  if (!list.length) return '';
  const { strong, cjk } = tokenizeQuery(query);
  const probes = [...new Set([...strong, ...cjk.filter((x) => x.head).map((x) => x.t)])];
  if (!probes.length) return '';
  const idx = findBestLineIndex(list, probes);
  if (idx < 0) return '';
  return String((list[idx] && list[idx].text) || '').slice(0, maxChars);
}

// 字幕经常一行只有半句（「参数量达到 6710 亿」），单独拿这一行去搜仍然缺主语。
// 这里把命中行前后相邻的字幕拼成一段窗口，作为检索语境。
export function contextWindowForQuery(lines, query, maxChars = 140) {
  const list = Array.isArray(lines) ? lines : [];
  if (!list.length) return '';
  const { strong, cjk } = tokenizeQuery(query);
  const probes = [...new Set([...strong, ...cjk.filter((x) => x.head).map((x) => x.t)])];
  if (!probes.length) return '';
  const idx = findBestLineIndex(list, probes);
  if (idx < 0) return '';
  const picked = [];
  let total = 0;
  const take = (i) => {
    if (i < 0 || i >= list.length) return;
    const text = String((list[i] && list[i].text) || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (picked.some((x) => x.i === i)) return;
    if (total + text.length > maxChars) return;
    picked.push({ i, text });
    total += text.length + 1;
  };
  take(idx);
  for (let d = 1; d <= 3 && total < maxChars; d += 1) {
    take(idx - d);
    take(idx + d);
  }
  picked.sort((a, b) => a.i - b.i);
  return picked.map((x) => x.text).join(' ').slice(0, maxChars);
}

// 把「字幕里的原句」变成检索词。
//
// 这是对「只拿 6710 亿 / 2026 / DeepSeek 这种短词去搜」的修正：
// 字幕行通常就是一句完整的话，整句检索能带上主语、谓语和限定，
// 比孤立词更容易搜到「这件事」而不是「这个词」。
export function contextualQuery(term, context) {
  const t = String(term || '').replace(/\s+/g, ' ').trim();
  const text = String(context || '').replace(/\s+/g, ' ').trim();
  if (!text) return t;
  // 模型给的查询往往是改写过的（「DeepSeek V4 发布时间」），
  // 不一定逐字出现在字幕里；只要字幕窗口里有它的头实体，就直接用窗口。
  const { strong, cjk } = tokenizeQuery(t);
  const head = strong[0] || (cjk.find((x) => x.head) || {}).t || '';
  const lower = text.toLowerCase();
  const lowerT = t.toLowerCase();
  const inWindow = !!t && (lower.includes(lowerT) || (head && lower.includes(head)));
  // 常见字幕行 ≤ 90 字，整句作为查询（保留语境，又不会长到搜索引擎忽略）
  if (text.length <= 90) {
    if (!t || inWindow) return text;
    return `${t} ${text}`.slice(0, 90);
  }
  // 太长的行：截取包含该词的一段窗口，而不是整行硬塞
  const anchor = lower.includes(lowerT) ? t : head;
  const idx = anchor ? lower.indexOf(anchor.toLowerCase()) : -1;
  if (idx < 0) return `${t} ${text.slice(0, 80)}`.trim().slice(0, 100);
  const start = Math.max(0, idx - 35);
  const end = Math.min(text.length, idx + anchor.length + 45);
  return text.slice(start, end).trim();
}

// 从字幕生成「带语境」的待核实项：
//   label   —— 短的核对项（进度、界面标题用）
//   query   —— 真正发出去的检索词（字幕原句）
//   context —— 原句，用于相关性过滤与展示
// 同一句话只搜一次；多个数字/术语落在同一句时不会重复消耗额度。
export function buildVerifyClaims(lines, limit = 8) {
  const terms = extractVerifyItems(lines, limit);
  const out = [];
  const seen = new Set();
  for (const term of terms) {
    const context = contextWindowForQuery(lines, term);
    const query = contextualQuery(term, context);
    const key = normalizeMatchText(query) || term;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: term, query, context });
    if (out.length >= limit) break;
  }
  return out;
}

// 检索词是否「有据可依」：至少有一个实体/数字/中文词在视频标题或字幕里出现过。
// 用来丢掉模型凭空编出来的检索词（例如视频没提过 GPT-5，却去搜「GPT-5 发布时间」）。
export function isQueryGroundedIn(query, sourceText) {
  const src = normalizeMatchText(sourceText);
  if (!src) return false;
  const { strong, cjk } = tokenizeQuery(query);
  if (strong.some((t) => src.includes(t))) return true;
  return cjk.some((x) => x.head && src.includes(x.t));
}

// 批量核实：对待核实项逐条检索，返回紧凑的证据条目。
//
// searchFn(query, opts) 由调用方注入（这样本模块不依赖具体检索实现，便于测试）。
export async function verifyItems(items, searchFn, opts = {}) {
  const maxItems = Math.max(1, Math.min(16, opts.maxItems || 5));
  const perItem = Math.max(1, Math.min(5, opts.perItem || 3));
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const shouldAbort = typeof opts.shouldAbort === 'function' ? opts.shouldAbort : null;
  const contextOf = typeof opts.contextOf === 'function' ? opts.contextOf : null;
  // 单条检索失败默认重试一次：429 / 瞬时网络错误很常见，静默丢掉会让用户以为「没搜到」。
  const retries = Math.max(0, Math.min(2, Number(opts.retries != null ? opts.retries : 1)));
  const retryDelayMs = Math.max(0, Number(opts.retryDelayMs != null ? opts.retryDelayMs : 250));
  const failures = [];
  const abortError = () => Object.assign(new Error('已终止'), { name: 'AbortError' });
  const list = items.slice(0, maxItems);
  // 逐条核对是网络往返，串行会等到天荒地老。
  // 默认保持 1（旧行为），调用方可以显式传 2~4；上限 4，避免触发平台限流。
  const concurrency = Math.max(1, Math.min(4, Number(opts.concurrency) || 1));
  const results = new Array(list.length);
  let cursor = 0;
  let aborted = false;

  const processOne = async (i) => {
    const raw = list[i];
    // 兼容两种入参：
    //   · 字符串（旧调用 / 简单核实项）
    //   · { label, query, context }（带语境的核实项）
    const label =
      typeof raw === 'string'
        ? raw
        : String((raw && (raw.label || raw.item || raw.query)) || '');
    const searchQuery =
      typeof raw === 'string'
        ? raw
        : String((raw && (raw.query || raw.label || raw.item)) || label);
    const context =
      typeof raw === 'string'
        ? contextOf
          ? contextOf(raw)
          : ''
        : String((raw && raw.context) || (contextOf ? contextOf(label) : ''));
    // 报告进度，让界面能显示「正在核对 3/6」
    if (onProgress) onProgress(i, list.length, label);
    try {
      let res = null;
      let lastErr = null;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (shouldAbort && shouldAbort()) throw abortError();
        try {
          res = await searchFn(searchQuery, { maxResults: perItem, fetchPageContent: false });
          lastErr = null;
          break;
        } catch (err) {
          if (err && err.name === 'AbortError') throw err;
          lastErr = err;
          if (attempt < retries) {
            if (shouldAbort && shouldAbort()) throw abortError();
            if (retryDelayMs) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
          }
        }
      }
      if (lastErr || !res) {
        failures.push({
          item: label,
          message: String((lastErr && lastErr.message) || lastErr || '检索失败').slice(0, 160),
          attempts: retries + 1
        });
        return null;
      }
      if (shouldAbort && shouldAbort()) throw abortError();
      const found = (res && res.results) || [];
      // 相关性过滤 —— 这是防污染的关键一步
      const relevant = found.filter((r) => isRelevantToQuery(r, label, context));
      if (!relevant.length) return null;
      // 先按「与检索词的贴合度」排，再按平台的 rerank 分数排；
      // 只按平台分数排会把「提到实体但没谈这件事」的页面排在前面。
      relevant.sort(
        (a, b) =>
          relevanceScore(b, label, context) - relevanceScore(a, label, context) ||
          (Number(b && b.score) || 0) - (Number(a && a.score) || 0)
      );
      const evidence = [];
      for (const r of relevant) {
        // 优先用 summary：DeepSeek 官方搜索给模型看的 600~800 字摘要在这里，
        // snippet 只有 100~200 字，是给界面展示用的。
        const text = String((r && (r.summary || r.snippet || r.content)) || '').trim().slice(0, 400);
        if (text.length < 8) continue;
        evidence.push({
          title: String(r.title || '').slice(0, 120),
          url: String(r.url || ''),
          text,
          // 站点用于「多来源一致」判定：同一站点的两篇文章不能算两个独立来源
          site: String(r.site || '')
        });
        if (evidence.length >= perItem) break;
      }
      if (!evidence.length) return null;
      return { item: label, query: searchQuery, context, evidence };
    } catch (err) {
      // 终止信号必须向上抛：吞掉的话「停止」会被当成单条检索失败继续跑
      if (err && err.name === 'AbortError') throw err;
      failures.push({
        item: label,
        message: String((err && err.message) || err || '核对失败').slice(0, 160),
        attempts: 1
      });
      return null;
    }
  };

  const worker = async () => {
    while (!aborted) {
      const i = cursor;
      cursor += 1;
      if (i >= list.length) return;
      if (shouldAbort && shouldAbort()) {
        aborted = true;
        throw abortError();
      }
      try {
        results[i] = await processOne(i);
      } catch (err) {
        aborted = true;
        throw err;
      }
    }
  };

  const workers = [];
  for (let w = 0; w < Math.min(concurrency, list.length); w += 1) workers.push(worker());
  await Promise.all(workers);
  if (onProgress) onProgress(list.length, list.length, null);
  const out = results.filter(Boolean);
  // 用数组属性携带失败明细：调用方仍可像以前一样当数组用。
  out.failures = failures;
  return out;
}

// 可注册域（eTLD+1）归一。
// 只去掉 www 不够：finance.sina.com.cn 与 tech.sina.com.cn 是同一家，
// 不能因为它们子域不同就当成两个独立来源。
const MULTI_LABEL_SUFFIXES = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com.hk', 'com.tw', 'com.sg', 'com.au', 'net.au', 'org.au',
  'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'or.kr', 'co.in', 'co.nz', 'co.za',
  'com.br', 'com.mx',
  // 常见托管后缀：每个用户一个子域，但内容来源并不是独立站点
  'github.io', 'blogspot.com', 'wordpress.com', 'tumblr.com',
  'pages.dev', 'vercel.app', 'netlify.app', 'notion.site'
]);

export function registrableDomain(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost') return host;
  // IP / IPv6 原样返回
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) return host;
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

export function domainOfUrl(url) {
  try {
    return registrableDomain(new URL(String(url || '')).hostname);
  } catch (err) {
    return '';
  }
}

function shingleSet(text, n = 8) {
  const s = normalizeMatchText(text).replace(/\s+/g, '');
  if (!s) return new Set();
  if (s.length <= n) return new Set([s]);
  const set = new Set();
  for (let i = 0; i + n <= s.length; i += 1) set.add(s.slice(i, i + n));
  return set;
}

// 0~1：字符 8-gram 的 Jaccard 相似度。
// 用于识别「同一篇稿子被转载到不同站点」，避免把它算成两个独立来源。
export function textSimilarity(a, b) {
  const left = normalizeMatchText(a).replace(/\s+/g, '');
  const right = normalizeMatchText(b).replace(/\s+/g, '');
  if (!left || !right) return 0;
  if (left === right) return 1;
  // 太短的文本（标题、一句话摘要）不做近似合并，避免误杀
  if (left.length < 40 || right.length < 40) return 0;
  const A = shingleSet(left);
  const B = shingleSet(right);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit += 1;
  return hit / (A.size + B.size - hit);
}

// 同一 claim 内合并近似转载：保留判定更强、正文更长的一条。
export function dedupeNearDuplicates(evidence) {
  const rank = (v) => (v === 'support' || v === 'refute' ? 2 : v === 'unknown' ? 1 : 0);
  const kept = [];
  for (const e of evidence || []) {
    const text = `${e.title || ''} ${e.text || ''}`;
    const idx = kept.findIndex((k) => textSimilarity(`${k.title || ''} ${k.text || ''}`, text) >= 0.82);
    if (idx < 0) {
      kept.push(e);
      continue;
    }
    const old = kept[idx];
    if (rank(e.verdict) > rank(old.verdict) || (rank(e.verdict) === rank(old.verdict) && String(e.text || '').length > String(old.text || '').length)) {
      kept[idx] = e;
    }
  }
  return kept;
}

// 没有做语义判定时的退路：只按「独立域名数」标注来源强弱。
// 同一站点的两篇文章不能算两个独立来源。
export function annotateEvidenceAgreement(verify) {
  for (const v of verify || []) {
    // 没有语义判定时也合并近似转载，避免把同一篇稿子算成多个来源
    v.evidence = dedupeNearDuplicates(v.evidence || []);
    const domains = new Set();
    for (const e of (v && v.evidence) || []) {
      const d = domainOfUrl(e.url) || String(e.site || '');
      if (d) domains.add(d);
    }
    v.domains = [...domains];
    v.agreement = domains.size >= 2 ? 'multi' : v.evidence && v.evidence.length ? 'single' : 'none';
  }
  return verify;
}
