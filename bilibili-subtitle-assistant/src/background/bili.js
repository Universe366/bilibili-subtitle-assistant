// B 站官方接口直连（后台执行，浏览器扩展上下文天然带 cookie）。
// 字幕列表来源（参考 haixiong1997/Bilibili-Obsidian-Clipper 的做法）：
//   ① /x/player/wbi/v2（带 wbi 签名，主来源）
//   ② /x/player/v2（无签名，回退）
//   ③ /x/web-interface/view（拿 aid / cid / 时长，以及个别情况下的副标题列表）

import { AppError } from './errors.js';
import { md5 } from '../shared/md5.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52
];

function getMixinKey(orig) {
  let out = '';
  for (const idx of MIXIN_KEY_ENC_TAB) {
    if (idx < orig.length) out += orig[idx];
  }
  return out.slice(0, 32);
}

export function normalizeSubtitleUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('/')) return `https://www.bilibili.com${s}`;
  return s;
}

function headerFor(pageUrl) {
  let referer = 'https://www.bilibili.com/';
  try {
    const u = new URL(pageUrl || referer);
    referer = `${u.protocol}//${u.host}/`;
  } catch (err) {
    /* ignore */
  }
  return { 'User-Agent': UA, Referer: referer, Accept: 'application/json, text/plain, */*' };
}

async function getJson(url, pageUrl, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: headerFor(pageUrl),
      credentials: 'include',
      signal: ctrl.signal,
      redirect: 'follow'
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new AppError('parse', 'B 站接口返回了非 JSON 内容', text.slice(0, 200), '请稍后重试。');
    }
    return { status: res.status, json };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err && err.name === 'AbortError') {
      throw new AppError('timeout', 'B 站接口请求超时', `超过 ${Math.round(timeoutMs / 1000)} 秒没有响应。`, '检查网络后重试。');
    }
    throw new AppError(
      'network',
      'B 站接口请求失败',
      `网络错误：${(err && err.message) || String(err)}`,
      '确认能正常打开 bilibili.com 后重试。'
    );
  } finally {
    clearTimeout(timer);
  }
}

let wbiCache = null;
async function getWbiKeys(pageUrl) {
  if (wbiCache && Date.now() - wbiCache.at < 6 * 3600 * 1000) return wbiCache;
  const { json } = await getJson('https://api.bilibili.com/x/web-interface/nav', pageUrl);
  const wbi = json && json.data && json.data.wbi_img;
  if (!wbi || !wbi.img_url || !wbi.sub_url) return null;
  const pick = (u) => String(u).split('/').pop().split('.')[0];
  const raw = `${pick(wbi.img_url)}${pick(wbi.sub_url)}`;
  wbiCache = { mixin: getMixinKey(raw), at: Date.now() };
  return wbiCache;
}

function signQuery(params, mixin) {
  const signed = { ...params, wts: Math.floor(Date.now() / 1000) };
  const sorted = Object.keys(signed).sort();
  const query = sorted
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(signed[k]).replace(/[!'()*]/g, ''))}`)
    .join('&');
  const wRid = md5(query + mixin);
  return `${query}&w_rid=${wRid}`;
}

function tracksFrom(data) {
  const list = (data && data.subtitle && data.subtitle.subtitles) || [];
  return list
    .map((item) => ({
      id: item.id == null ? '' : String(item.id),
      lan: item.lan || '',
      lanDoc: item.lan_doc || item.language || item.lan || '',
      url: normalizeSubtitleUrl(item.subtitle_url || ''),
      isAi: !!(item.is_ai || /^ai-/.test(String(item.lan || ''))),
      aiStatus: item.ai_status == null ? null : item.ai_status
    }))
    .filter((t) => t.url);
}

// 主入口：返回 { tracks, code, message, needLogin, sources, errors, video }
export async function fetchSubtitleTracks({ aid, bvid, cid, epId, pageUrl }, opts = {}) {
  const timeoutMs = opts.timeoutMs || 20000;
  const sources = [];
  const errors = [];
  const tracks = [];
  const seen = new Set();
  let needLogin = false;
  let code = null;
  let message = '';

  const pushAll = (list, source) => {
    let added = 0;
    for (const t of list) {
      const key = `${t.lan}|${t.url.split('?')[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push({ ...t, from: source });
      added += 1;
    }
    if (added) sources.push(source);
    return added;
  };

  // 番剧：用 ep_id 换 bvid/aid/cid
  let useAid = aid;
  let useBvid = bvid;
  let useCid = cid;
  if (!useBvid && !useAid && epId) {
    try {
      const { json } = await getJson(`https://api.bilibili.com/pgc/view/web/season?ep_id=${encodeURIComponent(epId)}`, pageUrl, timeoutMs);
      const ep = json && json.result && Array.isArray(json.result.episodes)
        ? json.result.episodes.find((e) => String(e.ep_id) === String(epId)) || json.result.episodes[0]
        : null;
      if (ep) {
        useAid = ep.aid;
        useBvid = ep.bvid;
        useCid = ep.cid;
      }
    } catch (err) {
      errors.push({ source: 'pgc/season', message: String(err && err.message) });
    }
  }

  // ① wbi 签名接口（主来源）
  if (useCid && (useAid || useBvid)) {
    try {
      const keys = await getWbiKeys(pageUrl);
      if (keys) {
        const params = { cid: useCid };
        if (useAid) params.aid = useAid;
        if (useBvid) params.bvid = useBvid;
        const url = `https://api.bilibili.com/x/player/wbi/v2?${signQuery(params, keys.mixin)}`;
        const { json } = await getJson(url, pageUrl, timeoutMs);
        code = json.code;
        message = json.message;
        if (json.code === 0) {
          needLogin = !!(json.data && json.data.need_login_subtitle);
          pushAll(tracksFrom(json.data), 'wbi/v2');
        } else {
          errors.push({ source: 'wbi/v2', code: json.code, message: json.message });
        }
      }
    } catch (err) {
      errors.push({ source: 'wbi/v2', message: String(err && err.message) });
    }
  }

  // ② 无签名接口（回退）
  if (!tracks.length && useCid) {
    try {
      const q = [`cid=${encodeURIComponent(useCid)}`];
      if (useBvid) q.push(`bvid=${encodeURIComponent(useBvid)}`);
      if (useAid) q.push(`aid=${encodeURIComponent(useAid)}`);
      const { json } = await getJson(`https://api.bilibili.com/x/player/v2?${q.join('&')}`, pageUrl, timeoutMs);
      if (code == null) {
        code = json.code;
        message = json.message;
      }
      if (json.code === 0) {
        needLogin = needLogin || !!(json.data && json.data.need_login_subtitle);
        pushAll(tracksFrom(json.data), 'player/v2');
      } else {
        errors.push({ source: 'player/v2', code: json.code, message: json.message });
      }
    } catch (err) {
      errors.push({ source: 'player/v2', message: String(err && err.message) });
    }
  }

  // ③ view 接口：拿视频信息 + 个别情况下的副标题
  let video = null;
  try {
    const key = useBvid ? `bvid=${encodeURIComponent(useBvid)}` : useAid ? `aid=${encodeURIComponent(useAid)}` : null;
    if (key) {
      const { json } = await getJson(`https://api.bilibili.com/x/web-interface/view?${key}`, pageUrl, timeoutMs);
      if (json.code === 0 && json.data) {
        video = {
          aid: json.data.aid,
          bvid: json.data.bvid,
          cid: json.data.cid,
          title: json.data.title,
          // 简介：总结时结合它（常含补充说明、时间轴、参考链接）
          desc: String(json.data.desc || '').trim(),
          owner: json.data.owner && json.data.owner.name,
          duration: json.data.duration,
          pages: (json.data.pages || []).map((p) => ({ index: p.page, cid: p.cid, title: p.part, duration: p.duration }))
        };
        const subList = (json.data.subtitle && json.data.subtitle.list) || [];
        if (subList.length) pushAll(tracksFrom({ subtitle: { subtitles: subList } }), 'view');
      } else {
        errors.push({ source: 'view', code: json.code, message: json.message });
      }
    }
  } catch (err) {
    errors.push({ source: 'view', message: String(err && err.message) });
  }

  // ④ 用 cid 再校验一次副标题（有些视频 view 里没有，player 里有）
  if (!tracks.length && useCid && useAid) {
    try {
      const keys = await getWbiKeys(pageUrl);
      if (keys) {
        const url = `https://api.bilibili.com/x/player/wbi/v2?${signQuery({ aid: useAid, cid: useCid }, keys.mixin)}`;
        const { json } = await getJson(url, pageUrl, timeoutMs);
        if (json.code === 0) pushAll(tracksFrom(json.data), 'wbi/v2-retry');
      }
    } catch (err) {
      /* ignore */
    }
  }

  // 全部来源都失败（不是「没字幕」，而是压根没问出来）→ 明确报错，避免误导用户
  if (!tracks.length && !video && errors.length) {
    const allFailed = errors.every((e) => e.code == null);
    const anyFailure = errors.some((e) => /Failed to fetch|NetworkError|请求失败|请求超时|ERR_/i.test(String(e.message || '')));
    if (allFailed && anyFailure) {
      throw new AppError(
        'network',
        'B 站接口全部请求失败',
        errors.map((e) => `${e.source}: ${e.message || '失败'}`).join('；'),
        '确认当前网络能打开 bilibili.com，然后重试；也可以直接用「语音转录」。'
      );
    }
  }

  return { tracks, code, message, needLogin, sources, errors, video };
}

// 字幕正文：兼容多种 JSON 形状（Bilitato / Clipper 都遇到过的坑）
export function extractLines(json) {
  if (!json) return [];
  // 只有「看起来像字幕行」的数组才算正文，避免把字幕轨列表误当正文
  const looksLikeLines = (v) => {
    if (!Array.isArray(v) || !v.length) return false;
    let hits = 0;
    for (const item of v.slice(0, 5)) {
      if (typeof item === 'string') hits += 1;
      else if (item && (('from' in item && 'content' in item) || ('start' in item && 'text' in item))) hits += 1;
    }
    return hits >= Math.min(2, v.length);
  };
  const pick = (v) => (looksLikeLines(v) ? v : null);
  const body =
    pick(json) ||
    pick(json.body) ||
    pick(json.data && json.data.body) ||
    pick(json.result && json.result.body) ||
    pick(json.content) ||
    pick(json.subtitles) ||
    null;
  if (!body) return [];
  return body
    .map((l) => {
      if (typeof l === 'string') return { from: 0, to: 0, text: l };
      const from = Number(l.from == null ? l.start : l.from);
      const to = Number(l.to == null ? l.end : l.to);
      const text = String(l.content == null ? (l.text == null ? l.body || '' : l.text) : l.content).replace(/\r?\n/g, ' ').trim();
      return {
        from: Number.isFinite(from) ? from : 0,
        to: Number.isFinite(to) ? to : 0,
        text
      };
    })
    .filter((l) => l.text.length);
}


// 抓取热门评论（用于总结时参考「观众关注什么」）。
//
// 走后台的好处：service worker 带扩展的 host 权限，能带 cookie 与 Referer，
// 而页面主环境反而要处理 CORS。
// 用非 wbi 的 /x/v2/reply（wbi 版需要签名，这里没必要）。
//
// 失败一律返回 ok:false —— 评论只是「锦上添花」，绝不能因为它让总结失败。
export async function fetchTopComments({ aid, bvid, pageUrl }, opts = {}) {
  const timeoutMs = opts.timeoutMs || 15000;
  const limit = Math.max(1, Math.min(20, opts.limit || 10));
  const oid = aid || bvid;
  if (!oid) return { ok: false, comments: [], reason: '缺少 aid/bvid' };
  try {
    const q = [`oid=${encodeURIComponent(oid)}`, 'type=1', `ps=${limit}`, 'pn=1', 'sort=1', 'nohot=0'];
    const { json } = await getJson(`https://api.bilibili.com/x/v2/reply?${q.join('&')}`, pageUrl, timeoutMs);
    if (json.code !== 0 || !json.data) {
      return { ok: false, comments: [], reason: `code=${json.code} ${json.message || ''}`.trim() };
    }
    const replies = json.data.replies || [];
    const comments = replies
      .map((r) => ({
        user: (r.member && r.member.uname) || '',
        like: Number(r.like) || 0,
        text: String((r.content && r.content.message) || '').replace(/\s+/g, ' ').trim()
      }))
      .filter((c) => c.text)
      .map((c) => ({ ...c, text: c.text.slice(0, 500) }));
    return { ok: true, comments, total: Number(json.data.page && json.data.page.count) || comments.length };
  } catch (err) {
    return { ok: false, comments: [], reason: (err && err.message) || String(err) };
  }
}

// ---------------------------------------------------------------------------
// B 站合集（列表）展开
// ---------------------------------------------------------------------------
//
// 用户需求：「添加支持对 b 站的合集进行批量的处理，同时也支持用户一个个处理」。
//
// 做法：把合集的 URL 展开成它包含的**每个视频的 URL**，
// 再喂进已有的批量队列（`context.js` 的 batchAdd）——
// 于是「批量」与「一个个」（手动从队列里移除/暂停）两种用法都成立，
// 不需要为合集单独写一套流程。
//
// 用的接口（已实测）：
//   GET /x/polymer/web-space/home/seasons_series?mid=&page_num=&page_size=
//     返回 data.items_lists.seasons_list[]，**每一项自带完整的 archives[]**
//     （即「一个合集 + 它的全部稿件」），以及 meta{season_id,title,total,mid}。
//     实测 total=26 的合集一次就回全 26 条，所以不需要按稿件分页。
//
// 注意：该接口**不支持**用 season_id 过滤（带上会返回 code=-400 请求错误），
// 所以按「拉 UP 主的合集列表 → 从中挑出目标合集」来取。
//
// 说明：需要 `mid`（UP 主 uid）。合集页 URL 里一般带 mid；
// 没带时如实报错，不要静默失败。

function pickSeasons(json) {
  const lists = json && json.data && json.data.items_lists;
  return (lists && lists.seasons_list) || [];
}

function seasonMeta(s) {
  // 字段藏在 meta 里（不是顶层）—— 一开始读错层，导致「找不到合集」。
  const m = (s && s.meta) || {};
  return {
    seasonId: m.season_id != null ? m.season_id : (s && s.season_id),
    title: m.title || m.name || (s && (s.title || s.name)) || '',
    total: Number(m.total) || 0,
    mid: Number(m.mid) || 0
  };
}

export async function expandCollection({ mid, seasonId, pageUrl }, opts = {}) {
  const timeoutMs = opts.timeoutMs || 20000;
  const maxItems = Math.max(1, Math.min(500, opts.maxItems || 400));
  const myMid = Number(mid) || 0;
  if (!myMid) return { ok: false, videos: [], reason: '缺少 UP 主 mid（合集链接里一般带 mid 参数）' };
  const sid = seasonId ? String(seasonId) : '';

  try {
    const out = [];
    let meta = null;
    // page_size 上限是 **20** —— 传 30 会被拒（code=-400 请求错误）。
    // 这是实测出来的，官方没有文档说明。
    const pageSize = 20;
    for (let pageNum = 1; pageNum <= 20; pageNum += 1) {
      const q = `mid=${encodeURIComponent(myMid)}&page_num=${pageNum}&page_size=${pageSize}`;
      const { json } = await getJson(`https://api.bilibili.com/x/polymer/web-space/home/seasons_series?${q}`, pageUrl, timeoutMs);
      if (json.code !== 0) {
        if (!out.length && !meta) return { ok: false, videos: [], reason: `code=${json.code} ${json.message || ''}`.trim() };
        break;
      }
      const seasons = pickSeasons(json);
      if (!seasons.length) break;

      // 指定了 season_id 就找那一个；否则把该 UP 的**所有**合集都展开
      const targets = sid
        ? seasons.filter((s) => String(seasonMeta(s).seasonId) === sid)
        : seasons;

      if (sid && !targets.length) {
        // 这一页没有目标合集，继续翻页找
        const page = (json.data.items_lists && json.data.items_lists.page) || {};
        const totalPages = Math.ceil((Number(page.total) || 0) / Math.max(1, Number(page.page_size) || pageSize));
        if (pageNum >= totalPages) break;
        continue;
      }

      for (const s of targets) {
        const sm = seasonMeta(s);
        if (!meta) meta = { ...sm, mid: myMid };
        for (const a of s.archives || []) {
          if (!a || !a.bvid) continue;
          if (out.some((v) => v.bvid === a.bvid)) continue; // 去重
          out.push({
            bvid: a.bvid,
            aid: a.aid,
            title: String(a.title || '').slice(0, 200),
            duration: Number(a.duration) || 0,
            seasonTitle: sm.title,
            url: `https://www.bilibili.com/video/${a.bvid}`
          });
          if (out.length >= maxItems) break;
        }
        if (out.length >= maxItems) break;
      }
      if (out.length >= maxItems) break;

      // 还有没有下一页合集
      const page = (json.data.items_lists && json.data.items_lists.page) || {};
      const totalPages = Math.ceil((Number(page.total) || 0) / Math.max(1, Number(page.page_size) || pageSize));
      if (!totalPages || pageNum >= totalPages) break;
    }

    if (!out.length) {
      return { ok: false, videos: [], reason: sid ? '这个合集里没有解析到视频' : '这个 UP 主名下没有可展开的合集' };
    }
    return { ok: true, videos: out, meta: { ...(meta || {}), count: out.length } };
  } catch (err) {
    return { ok: false, videos: [], reason: (err && err.message) || String(err) };
  }
}
