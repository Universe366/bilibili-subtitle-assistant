// 字幕：解析、时长校验（防串分 P）、候选轨逐个尝试、缓存复用。

import { call } from './bridge.js';
import { minCoverageRatio, OVERRUN_RATIO, OVERRUN_MIN_SECONDS, BILIBILI_LANGUAGES } from '../../shared/constants.js';

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

function parseClock(str) {
  const s = String(str || '').trim().replace(',', '.');
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!m) return NaN;
  const hh = Number(m[1] || 0);
  const mm = Number(m[2] || 0);
  const ss = Number(m[3] || 0);
  const frac = m[4] ? Number(`0.${m[4]}`) : 0;
  return hh * 3600 + mm * 60 + ss + frac;
}

// 文本是不是「二进制被当字符串读」的产物。
//
// 为什么需要：B 站的 `/x/v2/subtitle/web/view` 返回的是
// **protobuf（content-type: application/octet-stream）**，不是 JSON。
// 一旦这种响应被当成文本走到 SRT/VTT 解析，控制字符与随机字节会被
// 拼成一大堆毫无意义的「字幕行」，看起来就像
// 「出现了一些别的视频的字幕，而且每次还不一样」。
//
// 判据：控制字符占比高，或替换字符（U+FFFD）很多 → 判定为二进制垃圾。
export function looksLikeBinaryGarbage(text) {
  const s = String(text || '');
  if (!s) return false;
  const sample = s.slice(0, 4000);
  let ctrl = 0;
  let repl = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const c = sample.charCodeAt(i);
    if (c === 0xfffd) repl += 1;
    else if (c < 32 && c !== 9 && c !== 10 && c !== 13) ctrl += 1;
  }
  const n = sample.length || 1;
  // 替换字符 / 控制字符占比超过 1% 就不正常（正常字幕几乎为 0）
  return repl / n > 0.01 || ctrl / n > 0.01;
}

export function parseSubtitleText(text, format = 'text') {
  const body = String(text || '').replace(/\r\n?/g, '\n');
  if (!body.trim()) return [];
  // 二进制垃圾直接判空，绝不进入后面的文本解析
  if (looksLikeBinaryGarbage(body)) return [];
  // JSON
  const first = body.trim()[0];
  if (first === '{' || first === '[') {
    try {
      const json = JSON.parse(body);
      const arr = Array.isArray(json) ? json : json.body || json.data || json.subtitles || [];
      if (Array.isArray(arr)) {
        return arr
          .map((l) => ({
            from: Number(l.from == null ? l.start : l.from) || 0,
            to: Number(l.to == null ? l.end : l.to) || 0,
            text: String(l.content == null ? l.text : l.content).replace(/\n/g, ' ').trim()
          }))
          .filter((l) => l.text)
          .sort((a, b) => a.from - b.from);
      }
    } catch (err) {
      /* 继续按文本解析 */
    }
  }
  // SRT / VTT
  const blocks = body.split(/\n{2,}/);
  const lines = [];
  for (const block of blocks) {
    const rows = block.split('\n').filter((r) => r.trim() !== '');
    if (!rows.length) continue;
    const idx = rows.findIndex((r) => r.includes('-->'));
    if (idx < 0) continue;
    const [a, b] = rows[idx].split('-->');
    const from = parseClock(a);
    const to = parseClock(String(b).trim().split(/\s+/)[0]);
    if (!Number.isFinite(from)) continue;
    const text = rows
      .slice(idx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (text) lines.push({ from, to: Number.isFinite(to) ? to : from + 3, text });
  }
  return lines.sort((a, b) => a.from - b.from);
}

// ---------------------------------------------------------------------------
// 时长校验（2.1）：防止抓到属于其它分 P 的字幕
// ---------------------------------------------------------------------------

// videoDuration：视频时长（秒）
// expect：{ bvid, cid, title, desc } —— 用于归属校验（可选，不给就只做时长校验）
export function validateLines(lines, videoDuration, expect) {
  const result = {
    ok: false,
    kind: '',
    title: '',
    detail: '',
    stats: {
      count: lines.length,
      first: lines.length ? lines[0].from : 0,
      last: lines.length ? Math.max(...lines.map((l) => l.to || l.from)) : 0,
      coverage: 0,
      coverageRatio: 0,
      duration: videoDuration || 0
    }
  };
  if (!lines.length) {
    result.kind = 'empty';
    result.title = '字幕内容为空';
    result.detail = '下载成功但没有任何字幕行。';
    return result;
  }
  const first = Math.min(...lines.map((l) => l.from));
  const last = Math.max(...lines.map((l) => (l.to && l.to > l.from ? l.to : l.from)));
  const coverage = Math.max(0, last - first);
  result.stats.first = first;
  result.stats.last = last;
  result.stats.coverage = coverage;

  const dur = Number(videoDuration) || 0;
  if (dur > 0) {
    const overrunRatio = last / dur;
    const overrunSeconds = last - dur;
    if (overrunSeconds > OVERRUN_MIN_SECONDS && overrunRatio > 1 + OVERRUN_RATIO) {
      result.kind = 'overrun';
      result.title = '字幕时长与视频不匹配（可能是其它分 P 的字幕）';
      result.detail = `字幕最后一句到 ${last.toFixed(1)}s，视频只有 ${dur.toFixed(1)}s，超出 ${overrunSeconds.toFixed(1)}s（${Math.round(
        overrunRatio * 100
      )}%）。`;
      return result;
    }
    const ratio = coverage / dur;
    result.stats.coverageRatio = ratio;
    const need = minCoverageRatio(dur);
    if (need > 0 && ratio < need) {
      result.kind = 'coverage';
      result.title = '字幕覆盖度过低（可能只截到片段）';
      result.detail = `字幕只覆盖 ${coverage.toFixed(1)}s / 视频 ${dur.toFixed(1)}s = ${(ratio * 100).toFixed(
        1
      )}%，低于该时长档要求的 ${(need * 100).toFixed(0)}%。`;
      return result;
    }
  }

  // ---- 归属校验：这份字幕真的是这个视频的吗 ----
  //
  // 用户报「没有字幕的视频点击抓取后，出现别的视频的字幕，每次还不一样」。
  // 时长/覆盖度校验挡不住这种情况：B 站的推荐位、合集列表
  // （`__INITIAL_STATE__.availableVideoList` 里就有整季 66 个视频）
  // 以及网络嗅探残留，都可能给出**时长相近**的别的视频的字幕。
  //
  // 判据用两个**弱证据**，只在明显不对时才拒绝，避免误杀：
  //   a) 字幕正文里出现了别的视频的 BV 号 / cid
  //   b) 字幕内容与「标题 + 简介」几乎没有任何词重合
  if (expect) {
    const joined = lines.map((l) => String(l.text || '')).join(' ');
    // a) 明确指向别的视频的标识符
    const foreignId = findForeignVideoId(joined, expect);
    if (foreignId) {
      result.kind = 'foreign';
      result.title = '字幕疑似来自其它视频';
      result.detail = `字幕正文里出现了 ${foreignId}，与当前视频（${expect.bvid || expect.cid || '未知'}）不符，已拒绝采用。`;
      return result;
    }
    // b) 与标题/简介有没有**连续**的共同用词
    //
    // ⚠ 这一项**只记录，不拒绝** —— 试过当门槛用，会误杀真实视频。
    //
    // 原因：真实视频的标题用词，往往**不会**原样出现在字幕正文里。
    // 实测一个真实例子：标题「【测试】用于验证流程的视频」，
    // 它的真实字幕里最长只和标题重合 2 个字（「视频」）——
    // 因为字幕讲的是内容，不是复述标题。
    // 而无字幕视频的无关内容，最长公共子串也是 1~2 字。
    // 两个分布**重叠**，没有可用的分界，硬设门槛必然误杀。
    //
    // 所以归属判断只保留 bvid/cid 这种**确定性**证据（见上面 a)），
    // 这一项写进诊断信息，方便排查时人工判断。
    result.stats.overlapLcs = longestCommonSubstring(
      joined,
      [expect.title, expect.desc].filter(Boolean).join(' ')
    );
  }

  result.ok = true;
  result.title = '字幕校验通过';
  return result;
}

// 字幕正文里是否出现了**别的**视频的 BV 号 / cid。
// 返回那个标识符；没发现返回 ''。
export function findForeignVideoId(text, expect = {}) {
  const s = String(text || '');
  if (!s) return '';
  const mineBvid = String((expect && expect.bvid) || '');
  const ids = s.match(/BV[0-9A-Za-z]{10}/g) || [];
  for (const id of ids) {
    if (mineBvid && id === mineBvid) continue;
    return id; // 只要出现一个不是自己的 BV 号就可疑
  }
  const mineCid = String((expect && expect.cid) || '');
  if (mineCid) {
    // 正文里出现 "cid": 别的数字这种明确引用
    const m = s.match(/cid["'\s:=]{1,4}(\d{6,})/gi) || [];
    for (const raw of m) {
      const num = (raw.match(/(\d{6,})/) || [])[1];
      if (num && num !== mineCid) return `cid=${num}`;
    }
  }
  return '';
}

// 归一化：去掉空白、标点、符号，转小写。中英混排也能用。
function normalizeForCompare(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

// 最长公共子串长度（字符数）。
//
// 用它判断「字幕和标题/简介是不是同一话题」，比重合比例可靠得多：
// 比例会被中文常用词抬高，而**连续**匹配到 5 个字以上基本不可能是巧合。
// 实测：无关内容 1~2 字，同话题 10 字以上。
export function longestCommonSubstring(a, b) {
  const sa = normalizeForCompare(a);
  const sb = normalizeForCompare(b);
  if (!sa || !sb) return 0;
  let best = 0;
  // 滚动数组做 O(n*m) 的经典 DP，避免二维数组占内存
  let prev = new Uint32Array(sb.length + 1);
  let cur = new Uint32Array(sb.length + 1);
  for (let i = 1; i <= sa.length; i += 1) {
    for (let j = 1; j <= sb.length; j += 1) {
      if (sa[i - 1] === sb[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      } else {
        cur[j] = 0;
      }
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
    cur.fill(0);
  }
  return best;
}

// 保留二元组重合度：MCP / 其它地方可能拿它做「相关性」粗筛，
// 但**不建议用它判断字幕归属**（短标题上会被常用词带偏）。
export function contentOverlap(a, b) {
  const sa = normalizeForCompare(a);
  const sb = normalizeForCompare(b);
  if (sa.length < 40 || sb.length < 8) return null; // 样本太小，不判断
  const grams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
    return set;
  };
  const ga = grams(sa);
  const gb = grams(sb);
  if (!gb.size) return null;
  let hits = 0;
  for (const g of gb) if (ga.has(g)) hits += 1;
  return { ratio: hits / gb.size, hits, total: gb.size };
}

// ---------------------------------------------------------------------------
// 候选轨排序（中文优先）
// ---------------------------------------------------------------------------

const LANG_PRIORITY = {
  'zh-CN': 0,
  'zh-Hans': 1,
  'ai-zh': 2,
  'zh-Hant': 3,
  'zh-TW': 4,
  'ai-zh-Hant': 5,
  'zh-HK': 6,
  'en-US': 20,
  'ai-en': 21,
  en: 22,
  ja: 30,
  'ai-ja': 31
};

export function langLabel(code) {
  const hit = BILIBILI_LANGUAGES.find((l) => l.code === code);
  return hit ? hit.label : code || '未知语言';
}

export function sortCandidates(list) {
  return [...(list || [])].sort((a, b) => {
    const pa = LANG_PRIORITY[a.lan] == null ? (String(a.lan).toLowerCase().startsWith('zh') ? 8 : 50) : LANG_PRIORITY[a.lan];
    const pb = LANG_PRIORITY[b.lan] == null ? (String(b.lan).toLowerCase().startsWith('zh') ? 8 : 50) : LANG_PRIORITY[b.lan];
    if (pa !== pb) return pa - pb;
    // 人工字幕优先于 AI 字幕
    if (a.isAi !== b.isAi) return a.isAi ? 1 : -1;
    return String(a.lan).localeCompare(String(b.lan));
  });
}

// ---------------------------------------------------------------------------
// 抓取流程
// ---------------------------------------------------------------------------

function pageUrlOf(video) {
  return (video && video.url) || 'https://www.bilibili.com/';
}

function secondsToLines(lines) {
  return lines.map((l, i) => ({
    i,
    from: l.from,
    to: l.to && l.to > l.from ? l.to : l.from + 2.5,
    text: l.text,
    edited: false,
    original: l.text
  }));
}

// 归属校验需要的一组「这个视频是什么」标识
function expectFor(video) {
  return {
    bvid: video && video.bvid,
    cid: video && video.cid,
    title: (video && video.title) || '',
    desc: (video && video.desc) || ''
  };
}

// 返回 { ok, lines, meta, attempts, diagnostic }
export async function harvestSubtitles(video, settings, hooks = {}) {
  const { onProgress, signal } = hooks;
  const attempts = [];
  const diagnostic = {
    pageTracks: [],
    apiTracks: [],
    apiError: null,
    apiCode: null,
    apiMessage: '',
    apiIsLogin: null,
    apiNeedLogin: null,
    apiSources: [],
    apiErrors: [],
    pageBundle: null,
    pageDetail: null,
    sniffedCount: 0,
    triggerResult: null,
    used: 'page',
    at: Date.now()
  };

  // ------------------------------------------------------------------
  // 1) 页面主环境多来源汇总（网络嗅探 + 播放器实例 + player/v2 + wbi/v2 + initialState）
  // ------------------------------------------------------------------
  // RPC 返回可能是「信封 {data}」或「已解包的载荷」两种形状，两种都兼容
  const unwrap = (res) => {
    if (!res) return {};
    if (res.data && (Array.isArray(res.data.tracks) || Array.isArray(res.data.sources))) return res.data;
    if (res.data && res.data.data && Array.isArray(res.data.data.tracks)) return res.data.data;
    if (Array.isArray(res.tracks) || Array.isArray(res.sources)) return res;
    return res.data || res;
  };

  // 上一次采集是否因为「采集期间视频被切换」而作废
  let lastSignatureChanged = false;
  // 上一次采集是否因为「页面当前视频 ≠ 面板展示的视频」而作废
  let lastIdentityMismatch = false;
  // 上一次采集是否因为「页面身份自相矛盾」而作废
  let lastIdentityUnstable = false;

  const collectFromPage = async () => {
    try {
      // 带上「面板当前展示的那个视频」的签名。
      // 页面侧据此确定性判断采到的内容是不是这个视频的 ——
      // 这是「标题对、内容错」的根治办法（见 page-bridge.js 的 pageIdentity）。
      const expected = video && video.signature;
      const res = await call(
        'page.call',
        { name: 'getSubtitleBundle', params: expected ? { expectSignature: expected } : {} },
        { timeoutMs: 45000 }
      );
      const bundle = unwrap(res);
      // 页面当前视频与面板展示的视频不是同一个 → 这批内容根本不能要
      if (bundle && bundle.identityMismatch) {
        lastIdentityMismatch = true;
        lastIdentityUnstable = false;
        diagnostic.identityMismatch = { reason: bundle.reason || '', identity: bundle.identity || null };
        return [];
      }
      // 页面身份自相矛盾（URL / __INITIAL_STATE__ / pages[] 对不上）→ 同样不能用
      if (bundle && bundle.identityUnstable) {
        lastIdentityUnstable = true;
        lastIdentityMismatch = false;
        diagnostic.identityUnstable = { reason: bundle.reason || '', identity: bundle.identity || null };
        return [];
      }
      lastIdentityMismatch = false;
      lastIdentityUnstable = false;
      lastSignatureChanged = !!bundle.signatureChanged;
      diagnostic.pageBundle = {
        sources: bundle.sources || [],
        errors: bundle.errors || [],
        needLogin: !!bundle.needLogin,
        sniffCount: bundle.sniffCount || 0,
        staleSniffCount: bundle.staleSniffCount || 0,
        foreignTracks: bundle.foreignTracks || [],
        signatureChanged: lastSignatureChanged,
        groups: bundle.groups || [],
        trackCount: (bundle.tracks || []).length
      };
      diagnostic.sniffedCount = bundle.sniffCount || 0;
      diagnostic.staleSniffCount = bundle.staleSniffCount || 0;
      return (bundle.tracks || []).map((t) => ({ ...t, from: 'page', body: t.body || null }));
    } catch (err) {
      diagnostic.pageDetail = err.payload || { title: '页面读取失败', detail: String(err && err.message) };
      diagnostic.pageErrors = (diagnostic.pageErrors || []).concat([
        { stage: 'getSubtitleBundle', title: diagnostic.pageDetail.title, detail: diagnostic.pageDetail.detail }
      ]);
      return [];
    }
  };

  let pageTracks = await collectFromPage();

  // 采集失败（页面已切走 / 采集期间被切换）→ 等页面稳一下再采一次。
  // 这样用户不用手动「再点一次重新读取」。
  if (!pageTracks.length && (lastSignatureChanged || lastIdentityMismatch || lastIdentityUnstable) && !(signal && signal.aborted)) {
    if (onProgress) {
      onProgress({
        name: '字幕抓取',
        percent: 8,
        detail: lastIdentityMismatch
          ? '页面当前视频与面板不一致，正在重新读取当前视频的字幕…'
          : lastIdentityUnstable
            ? '页面状态还没稳定，正在重新读取当前视频的字幕…'
            : '采集期间视频已切换，正在重新读取当前视频的字幕…'
      });
    }
    await new Promise((r) => setTimeout(r, 900));
    pageTracks = await collectFromPage();
    diagnostic.retriedAfterSwitch = true;
  }

  diagnostic.pageTracks = pageTracks.map((s) => ({
    lan: s.lan,
    label: langLabel(s.lan),
    url: !!s.url,
    isAi: !!s.isAi,
    source: s.source || ''
  }));

  // 页面完全读不到 → 让播放器主动去拉一次字幕（点开字幕菜单），再读一遍
  if (!pageTracks.length) {
    try {
      diagnostic.triggerResult = await call('subtitle.trigger', {}, { timeoutMs: 30000 });
      if (diagnostic.triggerResult && diagnostic.triggerResult.ok) {
        pageTracks = await collectFromPage();
        diagnostic.pageTracks = pageTracks.map((s) => ({
          lan: s.lan,
          label: langLabel(s.lan),
          url: !!s.url,
          isAi: !!s.isAi,
          source: s.source || ''
        }));
        if (pageTracks.length && onProgress) {
          onProgress({ name: '字幕抓取', percent: 8, detail: '已通过播放器捕获到字幕' });
        }
      }
    } catch (err) {
      diagnostic.triggerResult = { ok: false, error: String(err && err.message) };
    }
  }

  // ------------------------------------------------------------------
  // 2) 官方接口兜底（后台直连：wbi 签名 + player/v2 + view）
  // ------------------------------------------------------------------
  let apiTracks = [];
  if (!pageTracks.length) {
    if (onProgress) onProgress({ name: '字幕抓取', percent: 12, detail: '页面未读到字幕轨，正在直连 B 站官方接口…' });
    try {
      const out = await call(
        'subtitle.api',
        { aid: video.aid, bvid: video.bvid, cid: video.cid, epId: video.epId, pageUrl: video.url },
        { timeoutMs: 40000 }
      );
      apiTracks = (out.tracks || []).map((s) => ({ ...s, from: 'api', body: null }));
      diagnostic.apiTracks = apiTracks.map((s) => ({ lan: s.lan, label: langLabel(s.lan), isAi: !!s.isAi }));
      diagnostic.apiCode = out.code;
      diagnostic.apiMessage = out.message || '';
      diagnostic.apiNeedLogin = !!out.needLogin;
      diagnostic.apiIsLogin = !out.needLogin;
      diagnostic.apiSources = out.sources || [];
      diagnostic.apiErrors = out.errors || [];
      if (apiTracks.length) diagnostic.used = 'api';
      if (out.video && !video.duration && out.video.duration) video.duration = out.video.duration;
    } catch (err) {
      diagnostic.apiError = err.payload || { title: '接口查询失败', detail: String(err && err.message) };
    }
  }

  // 3) 合并候选（按语言去重，页面侧优先）
  const byLang = new Map();
  for (const t of [...pageTracks, ...apiTracks]) {
    const key = t.lan || t.id || t.url;
    if (!byLang.has(key)) byLang.set(key, t);
  }
  const cands = sortCandidates(Array.from(byLang.values()));
  if (!cands.length) {
    return {
      ok: false,
      attempts,
      diagnostic,
      reason: buildNoSubtitleReason(video, diagnostic)
    };
  }

  const canRetry = typeof call === 'function';

  // 尝试一组候选，返回命中的结果或 null
  const tryCandidates = async (list) => {
    for (let idx = 0; idx < list.length; idx += 1) {
      const cand = list[idx];
      if (signal && signal.aborted) break;
      if (onProgress) {
        onProgress({
          name: '字幕抓取',
          percent: Math.round((idx / list.length) * 100),
          detail: `第 ${idx + 1}/${list.length} 条候选轨：${langLabel(cand.lan)}${cand.from === 'api' ? '（接口）' : ''}`
        });
      }
      const attempt = {
        lan: cand.lan,
        label: langLabel(cand.lan),
        isAi: !!cand.isAi,
        url: cand.url,
        from: cand.from,
        stage: 'pending',
        validation: null,
        error: null,
        cached: false,
        wrongPart: false
      };
      attempts.push(attempt);
      diagnostic.candidateOrder = (diagnostic.candidateOrder || []).concat([
        `${cand.lan || '(无语言)'}@${cand.from || 'unknown'}`
      ]);

      // 1) 缓存（key 去掉查询串，稳定性：签名 URL 每次都变）
      let lines = null;
      const cacheParams = {
        bvid: video.bvid,
        cid: video.cid,
        page: video.page,
        lang: cand.lan,
        url: cand.url
      };
      if (settings.behavior?.useLocalCache !== false) {
        try {
          const cache = await call('subtitle.cache.get', cacheParams);
          const cacheSig = cache.row && cache.row.meta && cache.row.meta.signature;
          // 旧缓存没有签名（或签名不是当前视频）一律不用：
          // 否则一次错误写入会“稳定地”反复返回别的视频字幕。
          if (cache.hit && cacheSig === video.signature && cache.row && Array.isArray(cache.row.payload?.lines) && cache.row.payload.lines.length) {
            const cached = cache.row.payload.lines.map((l) => ({ from: l.from, to: l.to, text: l.text }));
            // 缓存也要校验：否则一旦某次把错误内容写进缓存，
            // 之后每次都会「稳定地」返回错内容（用户报的
            // 「出现别的视频的字幕」，而且因为缓存而反复出现）。
            const cachedValidation = validateLines(cached, video.duration, expectFor(video));
            if (cachedValidation.ok) {
              lines = cached;
              attempt.cached = true;
              attempt.stage = 'cache';
            } else {
              attempt.cacheRejected = cachedValidation;
            }
          }
        } catch (err) {
          /* 缓存失败不影响主流程 */
        }
      }

      // 2) 页面已经抓到的正文优先（网络嗅探拿到的，不用再下载一次）
      if (!lines && Array.isArray(cand.body) && cand.body.length) {
        lines = cand.body
          .map((l) => ({
            from: Number(l.from == null ? l.start : l.from) || 0,
            to: Number(l.to == null ? l.end : l.to) || 0,
            text: String(l.content == null ? l.text : l.content).replace(/\r?\n/g, ' ').trim()
          }))
          .filter((l) => l.text.length);
        attempt.stage = 'sniffed';
        attempt.from = 'network-sniff';
      }

      // 3) 下载正文
      if (!lines && cand.url) {
        try {
          const data = await call(
            'subtitle.fetch',
            { url: cand.url, pageUrl: pageUrlOf(video) },
            { timeoutMs: 45000 }
          );
          attempt.stage = 'downloaded';
          if (data.format === 'json-array') {
            lines = (data.lines || []).map((l) => ({ from: l.from, to: l.to, text: l.text }));
          } else {
            lines = parseSubtitleText(data.body, data.format);
          }
        } catch (err) {
          attempt.stage = 'download-failed';
          attempt.error = err.payload || { title: '下载失败', detail: String(err && err.message) };
          continue;
        }
      }

      if (!lines || !lines.length) {
        attempt.stage = 'empty';
        attempt.error = { title: '字幕内容为空', detail: '拿到了字幕地址，但正文里没有任何字幕行。' };
        continue;
      }

      // 4) 校验（防串分 P / 覆盖度过低）。stage 保留「来源」语义，校验另记 validation。
      const validation = validateLines(lines, video.duration, expectFor(video));
      attempt.validation = validation;
      attempt.lineCount = lines.length;
      if (!attempt.stage || attempt.stage === 'pending') attempt.stage = 'downloaded';
      if (!validation.ok) {
        attempt.stage = 'rejected';
        // 标记「跑到了别的分 P」——这是可恢复的，值得换个来源再试
        if (validation.kind === 'overrun' || validation.kind === 'coverage') attempt.wrongPart = true;
        continue;
      }

      // 5) 写缓存
      if (!attempt.cached) {
        try {
          await call('subtitle.cache.put', {
            ...cacheParams,
            payload: { lines },
            meta: {
              langLabel: langLabel(cand.lan),
              count: lines.length,
              duration: video.duration,
              signature: video.signature
            }
          });
        } catch (err) {
          /* ignore */
        }
      }

      if (onProgress) onProgress({ name: '字幕抓取', percent: 100, detail: `已采用：${langLabel(cand.lan)}` });
      return {
        ok: true,
        lines: secondsToLines(lines),
        attempts,
        diagnostic,
        meta: {
          lang: cand.lan,
          langLabel: langLabel(cand.lan),
          isAi: !!cand.isAi,
          cached: attempt.cached,
          count: lines.length,
          from: attempt.from || cand.from,
          // 摊平一个「归属参考」字段，方便诊断面板直接显示
          // （validateLines 把最长连续重合写在 stats 里，只有参考价值）
          overlapLcs: validation && validation.stats ? validation.stats.overlapLcs : null,
          validation
        }
      };
    }
    return null;
  };

  if (!cands.length) {
    return {
      ok: false,
      attempts,
      diagnostic,
      reason: buildNoSubtitleReason(video, diagnostic)
    };
  }

  let hit = await tryCandidates(cands);
  if (hit) return hit;

  // ------------------------------------------------------------------
  // 4) 恢复：接口给的字幕「跑到了别的分 P」
  //
  // 多分 P 视频上，官方接口有时返回的是整段视频（或其它分 P）的字幕轨，
  // 时长远超当前分 P，被时长校验拒用。这时页面侧往往本来是对的（它带 cid），
  // 只是还没抓到。所以再让播放器拉一次字幕，然后把新候选补上重试一遍。
  // ------------------------------------------------------------------
  const rejectedWrongPart = attempts.filter((a) => a.wrongPart).length > 0;
  const hasMultipleParts = Array.isArray(video.parts) ? video.parts.length > 1 : false;
  if (canRetry && rejectedWrongPart && !(signal && signal.aborted)) {
    if (onProgress) {
      onProgress({
        name: '字幕抓取',
        percent: 60,
        detail: hasMultipleParts
          ? '接口字幕疑似来自其它分 P，正在让播放器重新拉取当前分 P 的字幕…'
          : '正在让播放器重新拉取字幕…'
      });
    }
    let extra = [];
    try {
      const trig = await call('subtitle.trigger', {}, { timeoutMs: 30000 });
      diagnostic.triggerRetry = trig;
      if (trig && trig.ok) {
        extra = await collectFromPage();
      }
    } catch (err) {
      diagnostic.triggerRetry = { ok: false, error: String((err && err.message) || err) };
    }
    if (extra.length) {
      const known = new Set(attempts.map((a) => a.lan));
      const fresh = extra.filter((t) => !known.has(t.lan) && (!t.url || t.body || true));
      // 已经把页面侧候选试过的语言记下来：同语言但带正文的也要再试一次（正文可能比接口的更对）
      const retryList = sortCandidates(extra);
      if (retryList.length) {
        diagnostic.pageTracks = extra.map((s) => ({
          lan: s.lan,
          label: langLabel(s.lan),
          url: !!s.url,
          isAi: !!s.isAi,
          source: s.source || ''
        }));
        hit = await tryCandidates(retryList);
        if (hit) return hit;
      }
      void fresh;
    }
  }

  if (onProgress) onProgress({ name: '字幕抓取', percent: 100, detail: '全部候选轨都不可用' });
  const wrongPart = rejectedWrongPart;
  return {
    ok: false,
    attempts,
    diagnostic,
    reason: {
      kind: 'allcandidates',
      title: '候选字幕轨都没通过校验',
      detail: wrongPart
        ? `已逐个尝试 ${attempts.length} 条候选轨，其中有字幕轨的时间范围和当前分 P 对不上（多半是整段视频或其它分 P 的字幕），已让播放器重新拉取但没拿到当前分 P 的字幕。`
        : `已逐个尝试 ${attempts.length} 条候选轨，全部未通过（明细见「候选轨明细」）。`,
      action: wrongPart
        ? '请先让视频**播放几秒**（让播放器自己加载字幕），再点「抓取字幕」；或者切到目标分 P 后重试；也可以直接用「语音转录」。'
        : '可以点「语音转录」把音轨转成文字；或刷新页面后重试。'
    }
  };
}

// 没有候选轨时，给出「到底为什么」的可操作说明
function buildNoSubtitleReason(video, diagnostic) {
  const lines = [];
  const bundle = diagnostic.pageBundle || {};
  const sniffed = diagnostic.sniffedCount || 0;
  lines.push(
    `页面侧读到 ${diagnostic.pageTracks.length} 条字幕轨（来源：${(bundle.sources || []).join('、') || '无'}${
      sniffed ? `；网络嗅探捕获 ${sniffed} 份正文` : ''
    }）。`
  );
  if (diagnostic.triggerResult) {
    lines.push(
      diagnostic.triggerResult.ok
        ? '已让播放器重新加载字幕：成功。'
        : `已尝试打开播放器字幕菜单：未捕获到（${diagnostic.triggerResult.reason || diagnostic.triggerResult.error || '未知'}）。`
    );
  }
  if (diagnostic.apiError) {
    lines.push(`官方接口查询失败：${diagnostic.apiError.title}${diagnostic.apiError.detail ? `（${diagnostic.apiError.detail}）` : ''}`);
  } else if (diagnostic.apiCode != null) {
    lines.push(
      `官方接口返回 code=${diagnostic.apiCode}${diagnostic.apiMessage ? `（${diagnostic.apiMessage}）` : ''}${
        diagnostic.apiSources && diagnostic.apiSources.length ? `；有效来源：${diagnostic.apiSources.join('、')}` : ''
      }`
    );
  }
  if (diagnostic.apiNeedLogin || bundle.needLogin) {
    lines.push('接口标记 need_login_subtitle=true：该视频的字幕需要登录 B 站后才可见（AI 字幕尤其如此）。');
  }
  if (bundle.errors && bundle.errors.length) {
    lines.push(
      `页面侧来源报错：${bundle.errors
        .map((e) => `${e.source}(${e.code == null ? e.message || '失败' : `code ${e.code}`})`)
        .join('、')}`
    );
  }
  lines.push('常见原因：① UP 没上传字幕；② 只有 AI 字幕且未登录 B 站；③ 页面播放器还没加载完。');

  const needsLogin = diagnostic.apiNeedLogin || bundle.needLogin;
  return {
    kind: 'notracks',
    title: '该视频没有可用字幕',
    detail: lines.join('\n'),
    action: needsLogin
      ? '先在这个浏览器里登录 B 站，刷新视频页后重试；或者直接点「语音转录」把音轨转成文字。'
      : '可以直接点「语音转录」把音轨转成文字；也可以播放几秒后再点一次「抓取字幕」。'
  };
}

// ---------------------------------------------------------------------------
// 统计（单行统计 / 整体统计）
// ---------------------------------------------------------------------------

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/;

export function lineStats(line, avgSecondsPerChar = 0.22) {
  const text = String(line.text || '');
  const chars = text.replace(/\s/g, '').length;
  const cjk = Array.from(text).filter((c) => CJK_RE.test(c)).length;
  const latinWords = (text.match(/[A-Za-z0-9']+/g) || []).length;
  // 中文按字、西文按词估算朗读时长
  const speak = cjk * 0.24 + latinWords * 0.34;
  const dur = Math.max(0.2, (line.to || 0) - (line.from || 0));
  const sentences = (text.match(/[。！？!?；;]/g) || []).length || (text.trim() ? 1 : 0);
  return {
    chars,
    cjk,
    latinWords,
    sentences,
    speakSeconds: speak || chars * avgSecondsPerChar,
    durationSeconds: dur,
    cps: dur > 0 ? chars / dur : 0
  };
}

export function overallStats(lines) {
  const total = { lines: lines.length, chars: 0, sentences: 0, speakSeconds: 0, coverage: 0, duration: 0 };
  if (!lines.length) return total;
  const first = lines[0].from;
  const last = Math.max(...lines.map((l) => l.to || l.from));
  for (const l of lines) {
    const s = lineStats(l);
    total.chars += s.chars;
    total.sentences += s.sentences;
    total.speakSeconds += s.speakSeconds;
  }
  total.coverage = last - first;
  total.duration = last;
  return total;
}

// 把字幕行转成纯文本（供 AI 使用）
export function linesToTranscript(lines, opts = {}) {
  const withTime = opts.withTime !== false;
  const parts = [];
  for (const l of lines) {
    const text = String(l.text || '').trim();
    if (!text) continue;
    if (withTime) parts.push(`[${fmtClock(l.from)}] ${text}`);
    else parts.push(text);
  }
  return parts.join(withTime ? '\n' : ' ');
}

// 导出给其它模块用（panel-ai 的分段总结需要构造同样的 [mm:ss] 前缀）。
// 以前它只是本文件内的 `function`，外部引用会直接 ReferenceError。
export function fmtClock(s) {
  const v = Math.max(0, Math.floor(Number(s) || 0));
  const mm = String(Math.floor(v / 60)).padStart(2, '0');
  const ss = String(v % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// 关键词检索原文（供对话时按需提供上下文）
export function selectContext(lines, question, maxChars = 24000) {
  const full = linesToTranscript(lines, { withTime: true });
  if (full.length <= maxChars) return { text: full, truncated: false };
  const q = String(question || '')
    .toLowerCase()
    .split(/[\s，。？！,?!/]+/)
    .filter((w) => w.length >= 2);
  if (!q.length) return { text: full.slice(0, maxChars), truncated: true };
  const scored = lines.map((l) => {
    const t = String(l.text || '').toLowerCase();
    let score = 0;
    for (const w of q) if (t.includes(w)) score += 1 + w.length / 4;
    return { l, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  let size = 0;
  for (const s of scored) {
    const row = `[${fmtClock(s.l.from)}] ${s.l.text}`;
    if (size + row.length > maxChars) break;
    picked.push({ from: s.l.from, row });
    size += row.length;
    if (picked.length > 800) break;
  }
  picked.sort((a, b) => a.from - b.from);
  return {
    text: picked.map((p) => p.row).join('\n') + '\n\n（以上按与问题的相关性截取了部分字幕）',
    truncated: true
  };
}
