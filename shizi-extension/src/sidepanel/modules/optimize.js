// 字幕优化与替换（第五章）：
//  - AI 优化：修正错别字 / 同音字 / 专有名词
//  - 一键「自动全部进行」：不逐条确认，直接应用
//  - 可保存 / 导出 / 导入 / 切换的替换规则组
//  - 术语表
//  - 优化时可联网核对（把检索结果作为 AI 判断依据）
//  - 转录完成后自动优化 / 自动替换（默认关闭）

import { call } from './bridge.js';
import { linesToTranscript } from './subtitles.js';

// ---------------------------------------------------------------------------
// 规则组
// ---------------------------------------------------------------------------

export function applyRulesToText(text, rules) {
  let out = String(text || '');
  const hits = [];
  for (const r of rules || []) {
    const from = String(r.from || '');
    const to = String(r.to || '');
    if (!from || from === to) continue;
    if (!out.includes(from)) continue;
    const before = out;
    out = out.split(from).join(to);
    if (out !== before) hits.push({ from, to });
  }
  return { text: out, hits };
}

// 一键自动全部进行：直接把整组规则应用到所有行
export function applyRulesToLines(lines, rules) {
  let changed = 0;
  const detail = [];
  const next = lines.map((l) => {
    const { text, hits } = applyRulesToText(l.text, rules);
    if (text !== l.text) {
      changed += 1;
      detail.push({ index: l.i, from: l.text, to: text, hits });
      return { ...l, text, edited: true, original: l.original || l.text };
    }
    return l;
  });
  return { lines: next, changed, detail };
}

export function exportRuleGroups(groups) {
  return JSON.stringify({ kind: 'bsub-rules', version: 1, exportedAt: new Date().toISOString(), groups }, null, 2);
}

export function parseRuleGroups(text) {
  const data = JSON.parse(String(text || ''));
  const groups = Array.isArray(data) ? data : data.groups;
  if (!Array.isArray(groups)) throw new Error('文件里没有找到规则组');
  const out = [];
  for (const g of groups) {
    const rules = Array.isArray(g.rules) ? g.rules : [];
    out.push({
      id: g.id || `imported_${Math.random().toString(36).slice(2, 8)}`,
      name: g.name || '导入的规则组',
      builtin: false,
      rules: rules
        .filter((r) => r && (r.from || r.错误写法) && (r.to || r.正确写法))
        .map((r) => ({ from: String(r.from || r.错误写法), to: String(r.to || r.正确写法) }))
    });
  }
  if (!out.length) throw new Error('没有解析到有效规则');
  return out;
}

// ---------------------------------------------------------------------------
// AI 优化
// ---------------------------------------------------------------------------

// 构建「AI 优化」的提示词。
//
// 升级点（用户要求）：不再只纠错别字，还要核对**术语 / 事实 / 时间 / 数据 / 逻辑**。
//
// 联网证据的用法也改了：不再整篇搜索后把网页正文灌进来
// （那会让模型开始改写成网页内容），而是**逐条核对**后只给紧凑证据，
// 并明确要求「只用于判断该条是否正确」。
export function buildOptimizeMessages({ lines, glossary, verify, searchResults, useSearch, platformName, videoTitle }) {
  const glossaryText = (glossary || [])
    .filter((g) => g && g.term)
    .map((g) => `- ${g.term}${g.note ? `（${g.note}）` : ''}`)
    .join('\n');

  // 优先用逐条核对的结果；没有时退回旧的整篇搜索结果（兼容旧调用）
  let evidenceText = '';
  if (verify && verify.length) {
    evidenceText = verify
      .map((v, i) => {
        const ev = v.evidence.map((e) => `    · ${e.title}｜${e.text}`).join('\n');
        // 把「这句话」放在前面，而不是只给一个孤立术语：
        // 模型需要知道这个数字/术语在字幕里到底是什么说法，才能判断证据是否对得上。
        const claim = String(v.context || v.item || '').slice(0, 180);
        // 证据强度标签：模型据此决定能不能改数字/时间/事实
        const tag = v.judged
          ? v.agreement === 'multi'
            ? '多来源一致'
            : v.agreement === 'conflict'
              ? '来源冲突'
              : v.agreement === 'single'
                ? '单一来源'
                : '未判定'
          : v.agreement === 'multi'
            ? '多来源（未语义核对）'
            : '未语义核对';
        return `[待核实 ${i + 1}]（${tag}）${claim}\n${ev}`;
      })
      .join('\n\n');
  } else if (useSearch && searchResults && searchResults.length) {
    evidenceText = searchResults
      .map((r, i) => `[${i + 1}] ${r.title}\n${(r.snippet || r.content || '').slice(0, 400)}`)
      .join('\n\n');
  }

  const system = [
    '你是中文视频字幕校对助手。请找出字幕里需要修正的地方，覆盖这五类：',
    '① **错别字 / 同音字**（语音识别最常见的问题）',
    '② **专有名词与术语**（人名、公司名、产品名、技术名词的写法）',
    '③ **时间**（年份、月份、日期与字幕上下文是否自洽）',
    '④ **数据**（数字、金额、比例、参数量、版本号是否准确）',
    '⑤ **逻辑**（前后矛盾、因果颠倒、同一数字前后不一致、明显违背常识）',
    '',
    '严格要求：',
    '1. 只做「错误写法 → 正确写法」的替换建议，不要润色、不要删减、不要改变原意。',
    '2. **不要把参考资料里的内容写进字幕**。资料只用来判断某条是否正确。',
    '3. 拿不准的不要提。宁可漏，不要错改 —— 错误的修正比不修正更糟。',
    '4. 只输出 JSON，不要任何解释、不要用 Markdown 代码块包裹。',
    '5. 格式：{"corrections":[{"wrong":"原始错误文本","right":"修正文本","reason":"原因","kind":"错别字|术语|时间|数据|逻辑","line":行号}]}',
    '6. wrong 必须是字幕里出现过的原文片段（尽量短，只含错误部分）。',
    '7. 证据开头的标签表示来源强度：只有「多来源一致」可以较有把握地修改具体数字 / 时间 / 事实；',
    '   「单一来源」「来源冲突」「未语义核对」只能参考，不要据此改动，除非是明显的错别字 / 术语或字幕前后自相矛盾。',
    '8. 没有发现问题就返回 {"corrections":[]}。'
  ].join('\n');

  const user = [
    videoTitle ? `【视频标题】${videoTitle}` : '',
    glossaryText ? `【术语表（这些词的正确写法以此为准）】\n${glossaryText}` : '',
    evidenceText
      ? `【字幕条目核对证据】\n这些是针对字幕中具体条目检索到的证据。**只用来判断对应条目对不对，不要转述它们。**\n\n${evidenceText}`
      : '',
    '【字幕全文（每行前缀是行号）】',
    lines.map((l) => `${l.i}: ${l.text}`).join('\n')
  ]
    .filter(Boolean)
    .join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

export function parseOptimizeResult(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const candidates = [];
  const stripped = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  candidates.push(stripped);
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(stripped.slice(first, last + 1));
  const KINDS = ['错别字', '术语', '时间', '数据', '逻辑'];
  for (const c of candidates) {
    try {
      const json = JSON.parse(c);
      const arr = json.corrections || json.items || json.data || (Array.isArray(json) ? json : []);
      if (Array.isArray(arr)) {
        return arr
          .map((r) => {
            const kind = String(r.kind || r.type || r.类型 || '').trim();
            return {
              wrong: String(r.wrong || r.from || r.错误写法 || '').trim(),
              right: String(r.right || r.to || r.正确写法 || '').trim(),
              reason: String(r.reason || r.说明 || '').trim(),
              // 归一到设置的五个类别，未知则留空（界面不显示徽章）
              kind: KINDS.includes(kind) ? kind : '',
              line: Number.isFinite(Number(r.line)) ? Number(r.line) : null
            };
          })
          .filter((r) => r.wrong && r.right && r.wrong !== r.right);
      }
    } catch (err) {
      /* 试下一个候选 */
    }
  }
  return [];
}

// 把 AI 返回的 corrections 应用到字幕行
export function applyCorrections(lines, corrections, opts = {}) {
  const detail = [];
  let next = lines.map((l) => ({ ...l }));
  for (const c of corrections) {
    let applied = 0;
    next = next.map((l) => {
      if (opts.onlyLine != null && l.i !== opts.onlyLine) return l;
      if (opts.onlyLine == null && c.line != null && l.i !== c.line) return l;
      if (!l.text.includes(c.wrong)) return l;
      applied += 1;
      return { ...l, text: l.text.split(c.wrong).join(c.right), edited: true, original: l.original || l.text };
    });
    detail.push({ ...c, applied });
  }
  const changed = detail.reduce((n, d) => n + d.applied, 0);
  return { lines: next, changed, detail };
}

// 搜索依据（优化时联网核对）
export async function gatherSearchEvidence(settings, query, hooks = {}) {
  if (!settings.search.platforms?.length) return { results: [], error: null };
  try {
    const out = await call(
      'search.provider',
      {
        id: settings.search.activeId,
        query,
        maxResults: settings.optimize.searchMaxResults || 3,
        fetchPageContent: settings.search.fetchPageContent
      },
      { timeoutMs: 60000 }
    );
    if (hooks.onLog) hooks.onLog(`联网核对：命中 ${out.results.length} 条来源`);
    return { results: out.results || [], error: null };
  } catch (err) {
    return { results: [], error: err.payload || { title: '检索失败', detail: String(err && err.message) } };
  }
}

// ---------------------------------------------------------------------------
// 质量自检（第九章）
// ---------------------------------------------------------------------------

export function qualityCheck(lines, video) {
  const issues = [];
  if (!lines.length) {
    return { ok: false, issues: [{ level: 'error', code: 'empty', text: '没有任何字幕行。' }] };
  }
  const sorted = [...lines].sort((a, b) => a.from - b.from);
  let gapCount = 0;
  let overlapCount = 0;
  let longGap = null;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const gap = cur.from - (prev.to || prev.from);
    if (gap > 20) {
      gapCount += 1;
      if (!longGap || gap > longGap.gap) longGap = { gap, at: prev.to || prev.from, prev: prev.text, next: cur.text };
    }
    if (gap < -0.6) overlapCount += 1;
  }
  if (gapCount) {
    issues.push({
      level: 'warn',
      code: 'gaps',
      text: `有 ${gapCount} 处超过 20 秒的空档${longGap ? `（最长 ${longGap.gap.toFixed(1)}s，约 ${Math.floor(longGap.at / 60)}:${String(Math.floor(longGap.at % 60)).padStart(2, '0')} 处）` : ''}，可能有漏段。`
    });
  }
  if (overlapCount) {
    issues.push({ level: 'warn', code: 'overlap', text: `有 ${overlapCount} 处字幕时间重叠，可能有重复段。` });
  }
  const emptyLines = sorted.filter((l) => !String(l.text || '').trim()).length;
  if (emptyLines) issues.push({ level: 'warn', code: 'empty-line', text: `有 ${emptyLines} 行是空文本。` });
  const last = Math.max(...sorted.map((l) => l.to || l.from));
  const duration = Number(video?.duration) || 0;
  if (duration > 0) {
    if (last > duration * 1.15 + 12) {
      issues.push({
        level: 'error',
        code: 'overrun',
        text: `最后一行到 ${last.toFixed(0)}s，视频只有 ${duration.toFixed(0)}s，时间戳可能属于其它分 P。`
      });
    }
    const coverage = last - sorted[0].from;
    const ratio = coverage / duration;
    if (ratio < 0.2) {
      issues.push({ level: 'warn', code: 'coverage', text: `字幕只覆盖视频的 ${(ratio * 100).toFixed(0)}%，可能不完整。` });
    }
  }
  const weird = sorted.filter((l) => (l.to || 0) - (l.from || 0) > 60).length;
  if (weird) issues.push({ level: 'warn', code: 'long-line', text: `有 ${weird} 行持续时间超过 60 秒，时间戳可能异常。` });
  const cps = sorted
    .map((l) => {
      const chars = String(l.text || '').replace(/\s/g, '').length;
      const dur = Math.max(0.2, (l.to || 0) - (l.from || 0));
      return chars / dur;
    })
    .filter((v) => Number.isFinite(v));
  const fast = cps.filter((v) => v > 12).length;
  if (fast) issues.push({ level: 'info', code: 'fast', text: `有 ${fast} 行语速超过 12 字/秒，可能断句有误。` });

  return { ok: !issues.some((i) => i.level === 'error'), issues };
}
