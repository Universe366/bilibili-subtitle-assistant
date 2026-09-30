/* B站字幕助手 —— 页面主环境桥（MAIN world）
 *
 * 为什么必须存在：内容脚本运行在隔离环境，读不到页面的全局变量
 * （__INITIAL_STATE__ / player 实例）。所以由本脚本在主环境读取数据，
 * 再通过「两个环境共享的通道（DOM）」交给内容脚本（稳定性 #8）。
 *
 * 通道实现：在 <html> 下创建两个 display:none 的元素
 *  - __bsub_page_channel__    : 页面主环境写、隔离环境读
 *  - __bsub_content_channel__ : 隔离环境写、主环境读
 * 通过 data-seq 属性变化 + 自定义事件双保险通知对方。
 */
(function () {
  'use strict';
  if (window.__BSUB_PAGE_BRIDGE__) {
    window.__BSUB_PAGE_BRIDGE__.reconnect();
    return;
  }

  const PAGE_ID = '__bsub_page_channel__';
  const CONTENT_ID = '__bsub_content_channel__';
  const EVT = '__bsub_dom_event__';
  const LOG = (...args) => {
    if (window.__BSUB_DEBUG__) console.log('[字幕助手/页面]', ...args);
  };

  let pageEl = null;
  let contentEl = null;

  function ensureElements() {
    if (!document.documentElement) return false;
    if (!pageEl || !pageEl.isConnected) {
      pageEl = document.getElementById(PAGE_ID);
      if (!pageEl) {
        pageEl = document.createElement('script');
        pageEl.type = 'application/json';
        pageEl.id = PAGE_ID;
        pageEl.setAttribute('data-seq', '0');
        pageEl.style.display = 'none';
        document.documentElement.appendChild(pageEl);
      }
    }
    if (!contentEl || !contentEl.isConnected) {
      contentEl = document.getElementById(CONTENT_ID);
      if (!contentEl) {
        contentEl = document.createElement('script');
        contentEl.type = 'application/json';
        contentEl.id = CONTENT_ID;
        contentEl.setAttribute('data-seq', '0');
        contentEl.style.display = 'none';
        document.documentElement.appendChild(contentEl);
      }
    }
    return !!(pageEl && contentEl);
  }

  // ---- 主环境 -> 隔离环境 ----
  let outSeq = 0;
  function publish(payload) {
    if (!ensureElements()) return;
    outSeq += 1;
    pageEl.textContent = JSON.stringify(payload);
    pageEl.setAttribute('data-seq', String(outSeq));
    pageEl.setAttribute('data-ts', String(Date.now()));
    try {
      document.dispatchEvent(new CustomEvent(EVT, { detail: { side: 'page', seq: outSeq } }));
    } catch (err) {
      /* ignore */
    }
  }

  // ---- 隔离环境 -> 主环境 ----
  let lastInSeq = '0';
  function readInbox() {
    if (!ensureElements()) return;
    const seq = contentEl.getAttribute('data-seq') || '0';
    if (seq === lastInSeq) return;
    lastInSeq = seq;
    let msg = null;
    try {
      msg = JSON.parse(contentEl.textContent || 'null');
    } catch (err) {
      msg = null;
    }
    if (!msg || !msg.id) return;
    handleRequest(msg);
  }

  // 主环境每 120ms 轮询一次收件箱（隔离环境无法可靠触发主环境监听）
  setInterval(readInbox, 120);
  document.addEventListener(EVT, () => setTimeout(readInbox, 0), false);

  // ---------------------------------------------------------------------------
  // 播放器 / 页面状态访问
  // ---------------------------------------------------------------------------

  function initialState() {
    try {
      return window.__INITIAL_STATE__ || null;
    } catch (err) {
      return null;
    }
  }

  function initialVideoData() {
    const st = initialState();
    if (!st) return null;
    const v = st.videoData || (st.video && st.video.videoData) || null;
    if (v && (v.bvid || v.aid)) return v;
    return null;
  }

  function seasonData() {
    const st = initialState();
    if (!st) return null;
    return st.epInfo && st.mediaInfo
      ? { ep: st.epInfo, media: st.mediaInfo, section: st.sectionEpisodes || [] }
      : null;
  }

  function parseQuery() {
    const out = {};
    try {
      const sp = new URLSearchParams(location.search);
      for (const [k, v] of sp.entries()) out[k] = v;
    } catch (err) {
      /* ignore */
    }
    return out;
  }

  // 分 P：用 p 参数定位；用「视频 ID + 分 P」做签名（稳定性 #10）
  function currentPartIndex() {
    const n = Number(parseQuery().p);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function pageKind() {
    const p = location.pathname;
    if (/^\/video\//.test(p)) return 'video';
    if (/^\/bangumi\/play\//.test(p)) return 'bangumi';
    if (/^\/cheese\/play\//.test(p)) return 'cheese';
    if (/^\/list\//.test(p) || /^\/medialist\//.test(p)) return 'list';
    return 'other';
  }

  function getPlayer() {
    const holders = [
      window.player,
      window.bpxPlayer,
      window.__player__,
      window.playerInstance
    ];
    for (const h of holders) {
      if (!h) continue;
      if (typeof h.getVideoMessage === 'function' || typeof h.getSubtitle === 'function') return h;
      if (h.player && typeof h.player.getSubtitle === 'function') return h.player;
    }
    return null;
  }

  function getVideoEl() {
    return (
      document.querySelector('#bilibili-player video') ||
      document.querySelector('.bpx-player-video-wrap video') ||
      document.querySelector('video')
    );
  }

  function titleFromDom() {
    const el =
      document.querySelector('h1.video-title') ||
      document.querySelector('.video-title') ||
      document.querySelector('.mediainfo_mediaTitle__Zyiqh') ||
      document.querySelector('h1') ||
      null;
    return el ? String(el.textContent || '').trim() : '';
  }

  function ownerFromDom() {
    const el =
      document.querySelector('.up-name') ||
      document.querySelector('.up-info-name') ||
      document.querySelector('.username') ||
      null;
    return el ? String(el.textContent || '').trim() : '';
  }

  // 视频简介：用户希望总结时能结合它（往往包含补充说明、时间轴、参考链接）
  function descFromPage() {
    // ① __INITIAL_STATE__ 里最可靠
    try {
      const st = window.__INITIAL_STATE__;
      const vd = st && (st.videoData || (st.videoInfo && st.videoInfo.videoData));
      if (vd && typeof vd.desc === 'string' && vd.desc.trim()) return vd.desc.trim();
      // 番剧
      const ep = st && st.epInfo;
      if (ep && typeof ep.desc === 'string' && ep.desc.trim()) return ep.desc.trim();
    } catch (err) {
      /* ignore */
    }
    // ② DOM 兜底（简介展开后在 .desc-info-text 里）
    const el =
      document.querySelector('.desc-info-text') ||
      document.querySelector('.video-desc') ||
      document.querySelector('.basic-desc-info') ||
      document.querySelector('[class*="descInfo"] [class*="content"]') ||
      null;
    if (!el) return '';
    return String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
  }

  function pickBestVideoEl() {
    const list = Array.from(document.querySelectorAll('video'));
    let best = null;
    let bestArea = -1;
    for (const v of list) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = v;
      }
    }
    return best || getVideoEl();
  }

  function getDuration() {
    const player = getPlayer();
    try {
      if (player && typeof player.getDuration === 'function') {
        const d = Number(player.getDuration());
        if (Number.isFinite(d) && d > 0) return d;
      }
    } catch (err) {
      /* ignore */
    }
    const v = pickBestVideoEl();
    if (v && Number.isFinite(v.duration) && v.duration > 0) return v.duration;
    const vd = initialVideoData();
    if (vd) {
      const d = Number(vd.duration);
      if (Number.isFinite(d) && d > 1) return d;
    }
    return 0;
  }

  function getCurrentTime() {
    const player = getPlayer();
    try {
      if (player && typeof player.getCurrentTime === 'function') {
        const t = Number(player.getCurrentTime());
        if (Number.isFinite(t)) {
          if (window.__BSUB_DEBUG__) LOG('getCurrentTime 走播放器', t);
          return t;
        }
      }
    } catch (err) {
      /* ignore */
    }
    const v = pickBestVideoEl();
    const tv = v && Number.isFinite(v.currentTime) ? v.currentTime : 0;
    if (window.__BSUB_DEBUG__) LOG('getCurrentTime 走 video 元素', tv, 'hasPlayer=', !!player);
    return tv;
  }

  function seek(t) {
    const time = Math.max(0, Number(t) || 0);
    let ok = false;
    const player = getPlayer();
    try {
      if (player && typeof player.seek === 'function') {
        player.seek(time);
        ok = true;
      } else if (player && typeof player.seekTo === 'function') {
        player.seekTo(time);
        ok = true;
      }
    } catch (err) {
      /* ignore */
    }
    const v = pickBestVideoEl();
    if (v) {
      try {
        v.currentTime = time;
        ok = true;
      } catch (err) {
        /* ignore */
      }
    }
    if (ok) {
      try {
        v && v.play && v.paused && v.play();
      } catch (err) {
        /* ignore */
      }
    }
    return { ok, time };
  }

  // ---------------------------------------------------------------------------
  // 视频信息
  // ---------------------------------------------------------------------------

  function collectParts() {
    const vd = initialVideoData();
    const list = vd && Array.isArray(vd.pages) ? vd.pages : [];
    return list.map((p, i) => ({
      index: Number(p.page) || i + 1,
      cid: p.cid,
      title: p.part || `P${p.page || i + 1}`,
      duration: Number(p.duration) || 0
    }));
  }

  function currentCid() {
    const q = parseQuery();
    const vd = initialVideoData();
    const idx = currentPartIndex();
    if (vd && Array.isArray(vd.pages)) {
      const p = vd.pages.find((x) => Number(x.page) === idx) || vd.pages[0];
      if (p && p.cid) return p.cid;
    }
    const season = seasonData();
    if (season && season.ep && (season.ep.cid || season.ep.ep_id)) {
      return season.ep.cid || season.ep.ep_id;
    }
    if (q.cid) return q.cid;
    if (vd && vd.cid) return vd.cid;
    return null;
  }

  function getInfo() {
    const vd = initialVideoData();
    const season = seasonData();
    const idx = currentPartIndex();
    const parts = collectParts();
    const part = parts.find((p) => p.index === idx) || parts[0] || null;
    const kind = pageKind();

    let bvid = (vd && vd.bvid) || null;
    let aid = (vd && vd.aid) || null;
    let title = (vd && vd.title) || titleFromDom();
    let owner = (vd && vd.owner && vd.owner.name) || ownerFromDom();
    let duration = getDuration();
    let epId = null;
    let seasonId = null;

    if (kind === 'bangumi' && season) {
      epId = season.ep.ep_id || season.ep.id || null;
      seasonId = season.media.media_id || season.media.season_id || null;
      title = season.media.title || title;
      if (season.ep.title) title = `${season.media.title || ''} ${season.ep.title}`.trim();
      owner = (season.media.upInfo && season.media.upInfo.name) || owner;
      if (season.ep.duration) duration = Number(season.ep.duration) || duration;
      aid = season.ep.aid || aid;
      bvid = season.ep.bvid || bvid;
    }

    const pageParam = parseQuery().p;
    const cid = currentCid();
    // 用「视频 ID + 分 P + cid」做签名：B 站会给 URL 挂易变参数，用整串 URL 会反复误判（稳定性 #10）
    const signature = [bvid || aid || epId || location.pathname, `p${idx}`, `c${cid || '-'}`].join('@');

    return {
      ok: true,
      kind,
      bvid,
      aid,
      cid,
      epId,
      seasonId,
      page: idx,
      pageParam: pageParam || null,
      partTitle: part ? part.title : '',
      parts,
      title: title || document.title || '',
      owner,
      desc: descFromPage(),
      duration,
      url: location.href,
      signature,
      protocol: location.protocol,
      host: location.host,
      hasPlayer: !!getPlayer(),
      hasVideoEl: !!pickBestVideoEl()
    };
  }

  // ---------------------------------------------------------------------------
  // 字幕抓取：多来源汇总
  //   ① 网络嗅探：播放器自己会请求字幕 JSON，这里在主环境挂 fetch / XHR 钩子截下来
  //      （参考 Bilitato 的 inject.js 做法），成功率最高
  //   ② 播放器实例：player.getSubtitle()
  //   ③ 官方接口：/x/player/v2 与带 wbi 签名的 /x/player/wbi/v2（参考 Bilibili-Obsidian-Clipper）
  //   ④ __INITIAL_STATE__ 里的 subtitle
  //   ⑤ 兜底：主动点开播放器字幕菜单，逼播放器发一次字幕请求
  // ---------------------------------------------------------------------------

  const subtitleSniff = { items: new Map(), count: 0, lastAt: 0, installed: false };

  function subtitlePathKey(url) {
    try {
      const u = new URL(String(url), location.href);
      return `${u.host}${u.pathname}`;
    } catch (err) {
      return String(url || '').split('?')[0];
    }
  }

  function isSubtitleUrl(rawUrl) {
    const s = String(rawUrl || '');
    if (!s) return false;
    if (!/aisubtitle|subtitle|\/bfs\/(ai_)?subtitle/i.test(s)) return false;
    if (/\.(mp4|m4s|flv|ts|jpg|png|webp|css|js|woff2?)(\?|$)/i.test(s)) return false;
    if (/api\.bilibili\.com\/x\/player/i.test(s)) return false; // 这是列表接口，不是正文
    return true;
  }

  // 正文 JSON 的形状在不同版本/来源里不一样，全部试一遍
  function extractSubtitleBody(json) {
    if (!json) return null;
    if (Array.isArray(json)) return json;
    const cands = [
      json.body,
      json.data && json.data.body,
      json.result && json.result.body,
      json.content,
      json.subtitles,
      json.data && json.data && json.data.subtitles
    ];
    for (const c of cands) {
      if (Array.isArray(c) && c.length) return c;
    }
    return null;
  }

  function recordSniffedSubtitle(url, text, source) {
    try {
      const json = typeof text === 'string' ? JSON.parse(text) : text;
      const body = extractSubtitleBody(json);
      if (!Array.isArray(body) || !body.length) return;
      const key = subtitlePathKey(url);
      const prev = subtitleSniff.items.get(key);
      if (prev && prev.body.length >= body.length) return;
      subtitleSniff.items.set(key, { url: String(url), body, at: Date.now(), source: source || 'sniff' });
      subtitleSniff.count += 1;
      subtitleSniff.lastAt = Date.now();
      LOG('嗅探到字幕正文', key, body.length, '行');
    } catch (err) {
      /* 不是 JSON 或不是字幕正文，忽略 */
    }
  }

  // 只挂载一次；失败也不能影响页面本身
  function installSubtitleSniffer() {
    if (subtitleSniff.installed) return;
    subtitleSniff.installed = true;

    try {
      const origFetch = window.fetch;
      if (typeof origFetch === 'function' && !origFetch.__bsubPatched) {
        const patched = function (...args) {
          const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          const p = origFetch.apply(this, args);
          if (isSubtitleUrl(url)) {
            try {
              p.then((res) => {
                try {
                  res
                    .clone()
                    .text()
                    .then((t) => recordSniffedSubtitle(url, t, 'fetch'))
                    .catch(() => {});
                } catch (err) {
                  /* ignore */
                }
              }).catch(() => {});
            } catch (err) {
              /* ignore */
            }
          }
          return p;
        };
        patched.__bsubPatched = true;
        window.fetch = patched;
      }
    } catch (err) {
      LOG('fetch 钩子安装失败', err);
    }

    try {
      const XHR = window.XMLHttpRequest;
      if (XHR && XHR.prototype && !XHR.prototype.__bsubPatched) {
        const origOpen = XHR.prototype.open;
        const origSend = XHR.prototype.send;
        XHR.prototype.open = function (method, url, ...rest) {
          this.__bsubUrl = url;
          return origOpen.call(this, method, url, ...rest);
        };
        XHR.prototype.send = function (...args) {
          const url = this.__bsubUrl;
          if (isSubtitleUrl(url)) {
            this.addEventListener('load', () => {
              try {
                if (!this.responseType || this.responseType === 'text') {
                  recordSniffedSubtitle(url, this.responseText, 'xhr');
                } else if (this.responseType === 'json') {
                  recordSniffedSubtitle(url, this.response, 'xhr');
                }
              } catch (err) {
                /* ignore */
              }
            });
          }
          return origSend.apply(this, args);
        };
        XHR.prototype.__bsubPatched = true;
      }
    } catch (err) {
      LOG('XHR 钩子安装失败', err);
    }

    // 兜底：有些版本把字幕塞进 track[src] / video[src]
    try {
      setInterval(() => {
        const nodes = document.querySelectorAll('track[src], video[src]');
        for (const n of nodes) {
          const src = n.getAttribute('src') || '';
          if (!isSubtitleUrl(src)) continue;
          if (subtitleSniff.items.has(subtitlePathKey(src))) continue;
          fetch(src, { credentials: 'include' })
            .then((r) => r.text())
            .then((t) => recordSniffedSubtitle(src, t, 'dom-src'))
            .catch(() => {});
        }
      }, 3000);
    } catch (err) {
      /* ignore */
    }
  }

  // 让播放器主动去拉一次字幕：点开字幕菜单并选一条语言
  let subtitleMenuAttempts = 0;
  async function triggerSubtitleMenu() {
    if (subtitleSniff.items.size) return { ok: true, already: true, count: subtitleSniff.items.size };
    if (subtitleMenuAttempts > 6) return { ok: false, reason: 'too-many-attempts' };
    subtitleMenuAttempts += 1;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const trigger = document.querySelector(
      '.bpx-player-ctrl-subtitle, .bilibili-player-video-btn-subtitle, [aria-label*="字幕"], [title*="字幕"]'
    );
    if (!trigger) return { ok: false, reason: 'no-trigger' };
    try {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      trigger.click();
    } catch (err) {
      return { ok: false, reason: 'click-failed' };
    }
    await sleep(320);
    const labels = Array.from(document.querySelectorAll('.bpx-player-ctrl-subtitle-language-item-text'));
    if (!labels.length) return { ok: false, reason: 'no-languages' };
    const preferred = labels.find((el) => /中文|简体|chinese/i.test(el.textContent || '')) || labels[0];
    try {
      preferred.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      preferred.click();
    } catch (err) {
      return { ok: false, reason: 'label-click-failed' };
    }
    for (let i = 0; i < 12; i += 1) {
      await sleep(250);
      if (subtitleSniff.items.size) break;
    }
    return { ok: subtitleSniff.items.size > 0, count: subtitleSniff.items.size };
  }

  // wbi 签名（/x/player/wbi/v2 需要；缺签名时接口会返回 -403）
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

  // MD5（wbi 签名需要）：纯 JS 实现，不依赖 WebCrypto 是否支持 MD5
  // MD5（wbi 签名需要）：纯 JS 实现，逐位对齐 RFC 1321
  const MD5_SHIFTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  const MD5_K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
  ];
  const MD5_G = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    1, 6, 11, 0, 5, 10, 15, 4, 9, 14, 3, 8, 13, 2, 7, 12,
    5, 8, 11, 14, 1, 4, 7, 10, 13, 0, 3, 6, 9, 12, 15, 2,
    0, 7, 14, 5, 12, 3, 10, 1, 8, 15, 6, 13, 4, 11, 2, 9
  ];
  function md5Pure(input) {
    const str = String(input);
    const bytes = [];
    for (let i = 0; i < str.length; i += 1) {
      const c = str.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        const cp = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(i + 1) - 0xdc00);
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        i += 1;
      } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    const byteLen = bytes.length;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const bitLen = byteLen * 8;
    for (let i = 0; i < 8; i += 1) bytes.push((bitLen / 2 ** (8 * i)) & 0xff);

    const words = new Array(16);
    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    const rol = (n, c) => ((n << c) | (n >>> (32 - c))) >>> 0;
    const add = (x, y) => (x + y) >>> 0;

    for (let off = 0; off < bytes.length; off += 64) {
      for (let i = 0; i < 16; i += 1) {
        const p = off + i * 4;
        words[i] = (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0;
      }
      let A = a0; let B = b0; let C = c0; let D = d0;
      for (let i = 0; i < 64; i += 1) {
        let f;
        if (i < 16) f = (B & C) | (~B & D);
        else if (i < 32) f = (D & B) | (~D & C);
        else if (i < 48) f = B ^ C ^ D;
        else f = C ^ (B | ~D);
        const tmp = D;
        D = C; C = B;
        const sum = add(add(add(A, f >>> 0), MD5_K[i]), words[MD5_G[i]]);
        B = add(B, rol(sum, MD5_SHIFTS[i]));
        A = tmp;
      }
      a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
    }
    const hex = (v) => {
      let s = '';
      for (let i = 0; i < 4; i += 1) s += ('0' + ((v >>> (i * 8)) & 0xff).toString(16)).slice(-2);
      return s;
    };
    return hex(a0) + hex(b0) + hex(c0) + hex(d0);
  }

  async function md5Hex(str) {
    try {
      if (window.crypto && window.crypto.subtle && typeof window.crypto.subtle.digest === 'function') {
        const buf = await window.crypto.subtle.digest('MD5', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      }
    } catch (err) {
      /* 浏览器可能不支持 MD5，落到纯 JS */
    }
    try {
      return md5Pure(str);
    } catch (err) {
      return null;
    }
  }

  let wbiKeyCache = null;
  async function getWbiKeys() {
    if (wbiKeyCache) return wbiKeyCache;
    try {
      const res = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
      const json = await res.json();
      const wbi = json && json.data && json.data.wbi_img;
      if (!wbi || !wbi.img_url || !wbi.sub_url) return null;
      const pick = (u) => String(u).split('/').pop().split('.')[0];
      const raw = `${pick(wbi.img_url)}${pick(wbi.sub_url)}`;
      wbiKeyCache = { mixin: getMixinKey(raw) };
      return wbiKeyCache;
    } catch (err) {
      return null;
    }
  }

  async function signedPlayerApi(params) {
    const keys = await getWbiKeys();
    if (!keys) return null;
    const signed = { ...params, wts: Math.floor(Date.now() / 1000) };
    const sorted = Object.keys(signed).sort();
    const query = sorted
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(signed[k]).replace(/[!'()*]/g, ''))}`)
      .join('&');
    const wRid = await md5Hex(query + keys.mixin);
    if (!wRid) return null;
    const url = `https://api.bilibili.com/x/player/wbi/v2?${query}&w_rid=${wRid}`;
    const res = await fetch(url, { credentials: 'include' });
    const json = await res.json();
    return { json, url };
  }

  function tracksFromPlayerData(data) {
    const subtitles = (data && data.subtitle && data.subtitle.subtitles) || [];
    return normalizeSubtitleList(subtitles);
  }

  function mergeTracks(...groups) {
    const out = [];
    const seen = new Set();
    for (const g of groups) {
      for (const t of g || []) {
        const key = `${t.lan}|${subtitlePathKey(t.url)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
      }
    }
    return out;
  }

  async function collectSubtitleTracks(aid, bvid, cid) {
    const sources = [];
    const errors = [];
    const groups = {};

    // ① 播放器实例
    try {
      const player = getPlayer();
      if (player && typeof player.getSubtitle === 'function') {
        const list = normalizeSubtitleList(player.getSubtitle());
        if (list.length) {
          groups.player = list;
          sources.push('player.getSubtitle');
        }
      }
    } catch (err) {
      errors.push({ source: 'player.getSubtitle', message: String(err && err.message) });
    }

    // ② 官方接口 player/v2
    let needLogin = false;
    try {
      const q = [`cid=${encodeURIComponent(cid || '')}`];
      if (bvid) q.push(`bvid=${encodeURIComponent(bvid)}`);
      if (aid) q.push(`aid=${encodeURIComponent(aid)}`);
      const res = await fetch(`https://api.bilibili.com/x/player/v2?${q.join('&')}`, { credentials: 'include' });
      const json = await res.json();
      if (json && json.code === 0) {
        needLogin = !!(json.data && json.data.need_login_subtitle);
        const list = tracksFromPlayerData(json.data);
        if (list.length) {
          groups.playerV2 = list;
          sources.push('player/v2');
        }
      } else {
        errors.push({ source: 'player/v2', code: json && json.code, message: json && json.message });
      }
    } catch (err) {
      errors.push({ source: 'player/v2', message: String(err && err.message) });
    }

    // ③ 带 wbi 签名的接口
    try {
      const params = { cid };
      if (aid) params.aid = aid;
      if (bvid) params.bvid = bvid;
      const out = await signedPlayerApi(params);
      if (out && out.json && out.json.code === 0) {
        const list = tracksFromPlayerData(out.json.data);
        if (list.length) {
          groups.wbiV2 = list;
          sources.push('player/wbi/v2');
        }
      } else if (out) {
        errors.push({ source: 'player/wbi/v2', code: out.json && out.json.code, message: out.json && out.json.message });
      }
    } catch (err) {
      errors.push({ source: 'player/wbi/v2', message: String(err && err.message) });
    }

    // ④ __INITIAL_STATE__
    try {
      const st = initialState();
      const cand =
        (st && st.videoData && st.videoData.subtitle) ||
        (st && st.videoInfo && st.videoInfo.subtitle) ||
        (st && st.subtitle) ||
        null;
      const list = normalizeSubtitleList(cand);
      if (list.length) {
        groups.initialState = list;
        sources.push('__INITIAL_STATE__');
      }
    } catch (err) {
      /* ignore */
    }

    // ⑤ 网络嗅探到的正文（只有正文，没有轨信息，但可以先给用户用上）
    const sniffed = Array.from(subtitleSniff.items.values());
    if (sniffed.length) {
      groups.sniffed = sniffed.map((s, i) => ({
        id: `sniff-${i}`,
        lan: '',
        lanDoc: sniffed.length > 1 ? `已捕获字幕 ${i + 1}` : '已捕获字幕',
        url: s.url,
        isAi: /ai_?subtitle|aisubtitle/i.test(s.url),
        source: 'sniff',
        body: s.body
      }));
      sources.push('network-sniff');
    }

    const tracks = mergeTracks(groups.player, groups.playerV2, groups.wbiV2, groups.initialState, groups.sniffed);
    return {
      tracks,
      sources,
      errors,
      needLogin,
      sniffCount: sniffed.length,
      groups: Object.keys(groups),
      sniffed: groups.sniffed || []
    };
  }

  // ---------------------------------------------------------------------------
  // 字幕轨
  // ---------------------------------------------------------------------------

  function normalizeSubtitleList(raw) {
    const out = [];
    const push = (item) => {
      if (!item) return;
      const urlRaw = item.subtitle_url || item.url || item.subtitleUrl || '';
      const url = urlRaw
        ? String(urlRaw).startsWith('//')
          ? `${location.protocol}${urlRaw}`
          : String(urlRaw)
        : '';
      out.push({
        id: item.id == null ? item.id_str : item.id,
        lan: item.lan || item.lang || '',
        lanDoc: item.lan_doc || item.language || item.lan || '',
        url,
        isAi: !!(item.is_ai || /^ai-/.test(String(item.lan || ''))),
        aiStatus: item.ai_status == null ? null : item.ai_status,
        source: item.type || item.source || ''
      });
    };
    if (Array.isArray(raw)) raw.forEach(push);
    else if (raw && Array.isArray(raw.subtitles)) raw.subtitles.forEach(push);
    else if (raw && Array.isArray(raw.list)) raw.list.forEach(push);
    return out.filter((s) => s.url);
  }

  function getSubtitles() {
    const player = getPlayer();
    const sources = [];
    const tried = [];
    let raw = null;

    const consider = (label, value) => {
      tried.push(label);
      if (raw) return;
      if (!value) return;
      if (Array.isArray(value) && !value.length) return;
      if (typeof value === 'object' && Array.isArray(value.subtitles) && !value.subtitles.length) return;
      if (typeof value === 'object' && Array.isArray(value.list) && !value.list.length) return;
      raw = value;
      sources.push(label);
    };

    // 1) 播放器实例
    if (player) {
      try {
        if (typeof player.getSubtitle === 'function') consider('player.getSubtitle', player.getSubtitle());
      } catch (err) {
        LOG('getSubtitle 失败', err);
      }
      try {
        if (typeof player.getSubtitleTracks === 'function') consider('player.getSubtitleTracks', player.getSubtitleTracks());
      } catch (err) {
        /* ignore */
      }
    }

    // 2) 页面全局变量（多个已知位置）
    const st = initialState();
    if (st) {
      consider('__INITIAL_STATE__.videoData.subtitle', st.videoData && st.videoData.subtitle);
      consider('__INITIAL_STATE__.videoInfo.subtitle', st.videoInfo && st.videoInfo.subtitle);
      consider('__INITIAL_STATE__.subtitle', st.subtitle);
      consider('__INITIAL_STATE__.videoData.subtitleList', st.videoData && st.videoData.subtitleList);
      consider('__INITIAL_STATE__.videoData.subtitle_list', st.videoData && st.videoData.subtitle_list);
      consider('__INITIAL_STATE__.videoData.playerInfo.subtitle', st.videoData && st.videoData.playerInfo && st.videoData.playerInfo.subtitle);
      consider('__INITIAL_STATE__.playerInfo.subtitle', st.playerInfo && st.playerInfo.subtitle);
    }

    // 3) 播放器接口返回的原始 JSON（部分版本存在 window.__playinfo__ 里）
    try {
      const pi = window.__playinfo__;
      if (pi) {
        consider('__playinfo__.subtitle', pi.subtitle);
        consider('__playinfo__.data.subtitle', pi.data && pi.data.subtitle);
      }
    } catch (err) {
      /* ignore */
    }

    // 4) 兜底：在 __INITIAL_STATE__ 里做有限深度的结构扫描，找出「像字幕轨列表」的数组
    if (!raw && st) {
      const found = deepFindSubtitleList(st, 5);
      if (found) {
        raw = found.value;
        sources.push(`深度扫描 ${found.path}`);
      }
    }

    const list = normalizeSubtitleList(raw);
    return {
      ok: true,
      subtitles: list,
      sources,
      tried,
      pageProtocol: location.protocol,
      hasPlayer: !!player,
      hasInitialState: !!st,
      stateKeys: st ? Object.keys(st).slice(0, 30) : []
    };
  }

  // 在页面状态里有限深度地找字幕轨数组（只认带字幕地址的项，避免误抓）
  function deepFindSubtitleList(root, maxDepth) {
    const seen = new Set();
    const queue = [{ node: root, path: '__INITIAL_STATE__', depth: 0 }];
    while (queue.length) {
      const { node, path, depth } = queue.shift();
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      if (Array.isArray(node)) {
        if (node.some((it) => it && typeof it === 'object' && (it.subtitle_url || it.subtitleUrl))) {
          return { value: node, path };
        }
        if (depth < maxDepth) {
          for (let i = 0; i < Math.min(node.length, 20); i += 1) {
            queue.push({ node: node[i], path: `${path}[${i}]`, depth: depth + 1 });
          }
        }
        continue;
      }
      if (depth >= maxDepth) continue;
      for (const key of Object.keys(node).slice(0, 60)) {
        const v = node[key];
        if (Array.isArray(v) && v.length && v.some((it) => it && typeof it === 'object' && (it.subtitle_url || it.subtitleUrl))) {
          return { value: v, path: `${path}.${key}` };
        }
        if (v && typeof v === 'object') queue.push({ node: v, path: `${path}.${key}`, depth: depth + 1 });
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // 音轨（ASR 用）
  // ---------------------------------------------------------------------------

  function normalizeAudioList(raw) {
    const out = [];
    const push = (item) => {
      if (!item) return;
      const url = item.base_url || item.baseUrl || item.url || '';
      if (!url) return;
      const initRange = item.init_range || item.initRange || null;
      const indexRange = item.index_range || item.indexRange || null;
      out.push({
        id: item.id == null ? null : item.id,
        url,
        bandwidth: Number(item.bandwidth) || 0,
        mimeType: item.mime_type || item.mimeType || '',
        codecs: item.codecs || '',
        initRange,
        indexRange,
        segmentBase: item.segment_base || item.segmentBase || null
      });
    };
    if (Array.isArray(raw)) raw.forEach(push);
    else if (raw && Array.isArray(raw.audio)) raw.audio.forEach(push);
    else if (raw && Array.isArray(raw.dash && raw.dash.audio)) raw.dash.audio.forEach(push);
    return out;
  }

  function getAudio() {
    const player = getPlayer();
    let raw = null;
    const sources = [];
    try {
      if (player && typeof player.getAudioTracks === 'function') {
        raw = player.getAudioTracks();
        sources.push('player.getAudioTracks');
      }
    } catch (err) {
      LOG('getAudioTracks 失败', err);
    }
    if (!raw) {
      const st = initialState();
      const cand =
        (st && st.videoData && st.videoData.dash) ||
        (st && st.videoInfo && st.videoInfo.dash) ||
        (st && st.dash) ||
        null;
      if (cand) {
        raw = cand;
        sources.push('__INITIAL_STATE__.dash');
      }
    }
    if (!raw) {
      try {
        const pi = window.__playinfo__;
        const cand = (pi && pi.dash) || (pi && pi.data && pi.data.dash) || null;
        if (cand) {
          raw = cand;
          sources.push('__playinfo__.dash');
        }
      } catch (err) {
        /* ignore */
      }
    }
    const list = normalizeAudioList(raw);
    // 页面里直连的 media 元素兜底
    if (!list.length) {
      try {
        const els = Array.from(document.querySelectorAll('audio, video'));
        for (const el of els) {
          const src = el.currentSrc || el.src || '';
          if (!src || /^(blob:|data:|mediasource:)/i.test(src)) continue;
          if (!/bilivideo|akamaized|hdslb|\.m4s|\.mp3|\.m4a|audio/i.test(src)) continue;
          list.push({ url: src, bandwidth: 0, mimeType: '', codecs: '', initRange: null, backupUrl: null, source: 'media-element' });
          sources.push('media-element');
        }
      } catch (err) {
        /* ignore */
      }
    }
    // 选带宽最低的（体积最小、识别够用）
    list.sort((a, b) => (a.bandwidth || 1e12) - (b.bandwidth || 1e12));
    const best = list[0] || null;
    return {
      ok: !!best,
      url: best ? best.url : '',
      audio: list,
      sources,
      duration: getDuration(),
      mimeType: best ? best.mimeType : '',
      codecs: best ? best.codecs : '',
      initRange: best ? best.initRange : null,
      indexRange: best ? best.indexRange : null,
      segmentBase: best ? best.segmentBase : null
    };
  }

  // ---------------------------------------------------------------------------
  // 音轨抓取（关键：必须在页面主环境发请求）
  //
  // 为什么不能在扩展的 service worker 里 fetch 音轨：
  //   Referer / Origin / User-Agent 都是 Fetch 规范的 forbidden header，
  //   在后台设置会被浏览器静默丢弃。B 站音轨 CDN 校验 Referer，
  //   所以后台请求必然 403 —— 而且刷新页面也没用，因为发起方一直是扩展源。
  //   在页面主环境 fetch 时，浏览器会自动带上 Referer: https://www.bilibili.com/，
  //   这才是能拿到 206 的正确姿势。
  // ---------------------------------------------------------------------------

  const audioSniff = { items: new Map(), lastAt: 0 };

  function isPlayurlUrl(rawUrl) {
    return /api\.bilibili\.com\/x\/player\/(wbi\/)?playurl/i.test(String(rawUrl || ''));
  }

  function recordPlayurlResponse(url, text) {
    try {
      const json = typeof text === 'string' ? JSON.parse(text) : text;
      const data = (json && (json.data || json.result)) || null;
      const dash = data && data.dash;
      if (!dash || !Array.isArray(dash.audio) || !dash.audio.length) return;
      const cid = data && data.cid;
      const key = String(cid || 'current');
      audioSniff.items.set(key, { cid, audio: dash.audio, at: Date.now(), url: String(url) });
      audioSniff.lastAt = Date.now();
      LOG('嗅探到 DASH 音轨', key, dash.audio.length, '条');
    } catch (err) {
      /* 不是 playurl 响应 */
    }
  }

  function installPlayurlSniffer() {
    try {
      const origFetch = window.fetch;
      if (typeof origFetch === 'function' && !origFetch.__bsubPlayurlPatched) {
        const patched = function (...args) {
          const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          const p = origFetch.apply(this, args);
          if (isPlayurlUrl(url)) {
            try {
              p.then((res) => {
                try {
                  res.clone().text().then((t) => recordPlayurlResponse(url, t)).catch(() => {});
                } catch (err) {
                  /* ignore */
                }
              }).catch(() => {});
            } catch (err) {
              /* ignore */
            }
          }
          return p;
        };
        patched.__bsubPlayurlPatched = true;
        window.fetch = patched;
      }
    } catch (err) {
      /* ignore */
    }
    try {
      const XHR = window.XMLHttpRequest;
      if (XHR && XHR.prototype && !XHR.prototype.__bsubPlayurlPatched) {
        const origOpen = XHR.prototype.open;
        const origSend = XHR.prototype.send;
        XHR.prototype.open = function (method, url, ...rest) {
          this.__bsubPlayurlUrl = isPlayurlUrl(url) ? url : null;
          return origOpen.call(this, method, url, ...rest);
        };
        XHR.prototype.send = function (...args) {
          if (this.__bsubPlayurlUrl) {
            this.addEventListener('load', () => {
              try {
                if (!this.responseType || this.responseType === 'text') {
                  recordPlayurlResponse(this.__bsubPlayurlUrl, this.responseText);
                }
              } catch (err) {
                /* ignore */
              }
            });
          }
          return origSend.apply(this, args);
        };
        XHR.prototype.__bsubPlayurlPatched = true;
      }
    } catch (err) {
      /* ignore */
    }
  }

  // 从 __playinfo__ / initialState 兜底读音轨
  function readPlayinfoAudio() {
    try {
      const pi = window.__playinfo__;
      const dash = pi && pi.data && pi.data.dash;
      if (dash && Array.isArray(dash.audio) && dash.audio.length) {
        return { audio: dash.audio, cid: pi.data.cid || null, source: '__playinfo__' };
      }
    } catch (err) {
      /* ignore */
    }
    return null;
  }

  // 从 <audio>/<video> 元素直接读音轨地址。
  // 播放器用的是 MSE（src 是 blob:），那里拿不到可用地址；
  // 但如果页面里存在直连的 media 元素，它的 src/currentSrc 就是最直接的来源。
  function collectFromMediaElements(push) {
    let n = 0;
    try {
      const els = Array.from(document.querySelectorAll('audio, video'));
      for (const el of els) {
        const src = el.currentSrc || el.src || '';
        // blob:/data: 是 MSE 或内联数据，不是可下载的音轨地址
        if (!src || /^(blob:|data:|mediasource:)/i.test(src)) continue;
        if (!/bilivideo|akamaized|hdslb|\.m4s|\.mp3|\.m4a|audio/i.test(src)) continue;
        push([{ base_url: src, bandwidth: 0, mime_type: '' }], 'media-element', currentCid());
        n += 1;
      }
    } catch (err) {
      /* ignore */
    }
    return n;
  }

  function collectAudioCandidates() {
    const out = [];
    const seen = new Set();
    const push = (list, source, cid) => {
      for (const item of list || []) {
        const url = item.base_url || item.baseUrl || item.url || '';
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push({
          url,
          bandwidth: Number(item.bandwidth) || 0,
          mimeType: item.mime_type || item.mimeType || '',
          codecs: item.codecs || '',
          initRange: item.init_range || item.initRange || null,
          backupUrl: item.backup_url || item.backupUrl || null,
          source,
          cid: cid || null
        });
      }
    };
    // ① 嗅探到的最新 playurl 响应（最鲜）
    const sniffed = Array.from(audioSniff.items.values()).sort((a, b) => b.at - a.at);
    for (const s of sniffed) push(s.audio, `playurl-sniff(${s.url.includes('wbi') ? 'wbi' : 'plain'})`, s.cid);
    // ② __playinfo__
    const pi = readPlayinfoAudio();
    if (pi) push(pi.audio, pi.source, pi.cid);
    // ③ initialState / 播放器 API
    try {
      const st = initialState();
      const dash =
        (st && st.videoData && st.videoData.dash) ||
        (st && st.videoInfo && st.videoInfo.dash) ||
        (st && st.dash) ||
        null;
      if (dash) push(dash.audio, '__INITIAL_STATE__', currentCid());
    } catch (err) {
      /* ignore */
    }
    const player = getPlayer();
    try {
      if (player && typeof player.getAudioTracks === 'function') {
        push(player.getAudioTracks(), 'player.getAudioTracks', currentCid());
      }
    } catch (err) {
      /* ignore */
    }
    // ④ 页面里直连的 media 元素（非 MSE blob 时可用）
    collectFromMediaElements(push);
    return out;
  }

  // 收集音轨候选。若页面里现有的来源都为空（例如 __playinfo__ 被清掉、
  // 或者嗅探还没命中），就主动向 playurl 接口要一次——这样「语音转录」
  // 不会因为页面刚好没有缓存就失败。
  async function collectAudioCandidatesWithRefresh(hint = {}) {
    let list = collectAudioCandidates();
    const diag = {
      hint,
      pageInfo: null,
      sniffed: audioSniff.items.size,
      stages: [],
      refreshed: null
    };
    diag.stages.push({ stage: '页面现有来源', count: list.length });
    LOG('音轨候选（页面现有来源）', list.length);
    if (list.length) return { list, diag };
    try {
      const info = getInfo() || {};
      diag.pageInfo = { aid: info.aid || null, bvid: info.bvid || null, cid: info.cid || null, hasPlayer: !!getPlayer() };
      // 调用方（侧边栏）通常已经知道 aid/bvid/cid，优先用它，避免依赖页面状态
      const cid = hint.cid || info.cid || currentCid();
      const aid = hint.aid || info.aid;
      const bvid = hint.bvid || info.bvid;
      diag.stages.push({ stage: '用于刷新 playurl 的标识', cid: cid || null, aid: aid || null, bvid: bvid || null });
      LOG('音轨候选为空，主动刷新 playurl', { cid, aid, bvid });
      const fresh = await refreshAudioUrl(aid, bvid, cid);
      diag.refreshed = {
        ok: !!(fresh && fresh.ok),
        code: fresh ? fresh.code : null,
        message: fresh ? fresh.message : null,
        count: fresh && fresh.audio ? fresh.audio.length : 0
      };
      diag.stages.push({ stage: '主动刷新 playurl', ok: diag.refreshed.ok, code: diag.refreshed.code, message: diag.refreshed.message, count: diag.refreshed.count });
      LOG('刷新结果', fresh && fresh.ok, fresh && fresh.message, fresh && (fresh.audio || []).length);
      if (fresh && fresh.ok) list = collectAudioCandidates();
      diag.stages.push({ stage: '刷新后候选', count: list.length });
    } catch (err) {
      diag.stages.push({ stage: '刷新抛错', error: String((err && err.message) || err) });
      LOG('主动刷新音轨地址失败', String((err && err.message) || err));
    }
    return { list, diag };
  }
  async function refreshAudioUrl(aid, bvid, cid) {
    // 调用方没传全就自己从页面补齐，避免出现 cid=null 的无效请求
    let pageCid = cid;
    let pageAid = aid;
    let pageBvid = bvid;
    try {
      const info = getInfo() || {};
      if (!pageCid) pageCid = info.cid || currentCid();
      if (!pageAid) pageAid = info.aid;
      if (!pageBvid) pageBvid = info.bvid;
    } catch (err) {
      /* 用调用方传的 */
    }
    if (!pageCid) return { ok: false, code: null, message: '没有解析到 cid', audio: [] };
    const params = { cid: pageCid, fnval: 16, fnver: 0, fourk: 1 };
    if (pageAid) params.aid = pageAid;
    if (pageBvid) params.bvid = pageBvid;
    let url = null;
    try {
      const keys = await getWbiKeys();
      if (keys) {
        const signed = { ...params, wts: Math.floor(Date.now() / 1000) };
        const sorted = Object.keys(signed).sort();
        const query = sorted
          .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(signed[k]).replace(/[!'()*]/g, ''))}`)
          .join('&');
        const wRid = await md5Hex(query + keys.mixin);
        if (wRid) url = `https://api.bilibili.com/x/player/wbi/playurl?${query}&w_rid=${wRid}`;
      }
    } catch (err) {
      /* 落到无签名版本 */
    }
    if (!url) {
      const q = new URLSearchParams({ ...params, platform: 'pc', high_quality: '1' });
      url = `https://api.bilibili.com/x/player/playurl?${q.toString()}`;
    }
    const res = await fetch(url, { credentials: 'include' });
    const json = await res.json();
    const dash = json && json.data && json.data.dash;
    if (!dash || !Array.isArray(dash.audio) || !dash.audio.length) {
      return { ok: false, code: json && json.code, message: json && json.message, audio: [] };
    }
    audioSniff.items.set(String(pageCid || 'current'), { cid: pageCid, audio: dash.audio, at: Date.now(), url });
    return { ok: true, audio: dash.audio, url, code: json.code, message: json.message, cid: pageCid };
  }

  // 在页面上下文里取一段字节：只带 Range，不手动设 Referer/Origin/UA
  // （浏览器会自动带上正确的 Referer；credentials 用 omit，签名 URL 不需要 cookie）
  async function fetchAudioRange(target, start, end, opts = {}) {
    if (!target) return { ok: false, reason: 'no-url' };
    const headers = {};
    if (Number.isFinite(start) && Number.isFinite(end)) headers.Range = `bytes=${start}-${end}`;
    let res;
    try {
      res = await fetch(target, {
        method: 'GET',
        headers,
        credentials: opts.withCredentials ? 'include' : 'omit',
        cache: 'no-store',
        redirect: 'follow'
      });
    } catch (err) {
      return { ok: false, reason: 'network', message: String((err && err.message) || err) };
    }
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok && res.status !== 206) {
      return { ok: false, reason: 'http', status: res.status, contentType };
    }
    // 有些失败会以 200 + text/html 返回（防盗链页面），也要当失败
    if (/text\/html/i.test(contentType)) {
      return { ok: false, reason: 'html', status: res.status, contentType };
    }
    let buf;
    try {
      buf = await res.arrayBuffer();
    } catch (err) {
      return { ok: false, reason: 'body', message: String((err && err.message) || err) };
    }
    const bytes = new Uint8Array(buf);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return {
      ok: true,
      base64: btoa(binary),
      byteLength: bytes.length,
      status: res.status,
      contentRange: res.headers.get('content-range') || null,
      contentType,
      refererSent: 'browser-default'
    };
  }

  // ---------------------------------------------------------------------------
  // 页面内字幕覆盖层
  // ---------------------------------------------------------------------------

  const overlay = {
    el: null,
    visible: false,
    lines: [],
    style: { fontScale: 1, bottom: 8 },
    timer: null,
    lastIndex: -2,
    follow: true
  };

  function ensureOverlay() {
    if (overlay.el && overlay.el.isConnected) return overlay.el;
    const host =
      document.querySelector('.bpx-player-video-wrap') ||
      document.querySelector('#bilibili-player') ||
      document.querySelector('.bilibili-player') ||
      null;
    const el = document.createElement('div');
    el.id = '__bsub_overlay__';
    el.style.cssText = [
      'position:absolute',
      'left:0',
      'right:0',
      'display:none',
      'text-align:center',
      'pointer-events:none',
      'z-index:60',
      'font-family:inherit'
    ].join(';');
    const inner = document.createElement('span');
    inner.setAttribute('data-bsub-line', '1');
    inner.style.cssText = [
      'display:inline-block',
      'max-width:92%',
      'padding:2px 10px',
      'border-radius:4px',
      'background:rgba(0,0,0,0.62)',
      'color:#fff',
      'font-size:22px',
      'line-height:1.35',
      'text-shadow:0 1px 2px rgba(0,0,0,0.4)',
      'white-space:pre-wrap'
    ].join(';');
    el.appendChild(inner);
    (host || document.body).appendChild(el);
    overlay.el = el;
    return el;
  }

  function applyOverlayStyle() {
    if (!overlay.el) return;
    const inner = overlay.el.firstElementChild;
    if (!inner) return;
    inner.style.fontSize = `${Math.round(22 * (overlay.style.fontScale || 1))}px`;
    overlay.el.style.bottom = `${overlay.style.bottom || 8}%`;
  }

  function findLineAt(t) {
    const lines = overlay.lines;
    if (!lines.length) return -1;
    let lo = 0;
    let hi = lines.length - 1;
    if (t < lines[0].from || t > (lines[hi].to || lines[hi].from)) return -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const l = lines[mid];
      if (!l) break;
      if (t < l.from) hi = mid - 1;
      else if (t > (l.to || l.from)) lo = mid + 1;
      else return mid;
    }
    return -1;
  }

  function tickOverlay() {
    if (!overlay.visible || !overlay.el) return;
    const t = getCurrentTime();
    const idx = findLineAt(t);
    if (idx !== overlay.lastIndex) {
      overlay.lastIndex = idx;
      const inner = overlay.el.firstElementChild;
      if (!inner) return;
      if (idx >= 0) {
        inner.textContent = overlay.lines[idx].text;
        overlay.el.style.display = 'block';
      } else {
        inner.textContent = '';
        overlay.el.style.display = 'none';
      }
    }
  }

  function setOverlay(payload) {
    overlay.visible = !!payload.visible;
    if (Array.isArray(payload.lines)) overlay.lines = payload.lines;
    if (payload.style) overlay.style = { ...overlay.style, ...payload.style };
    if (overlay.visible) {
      ensureOverlay();
      applyOverlayStyle();
      if (!overlay.timer) overlay.timer = setInterval(tickOverlay, 200);
      tickOverlay();
    } else if (overlay.el) {
      overlay.el.style.display = 'none';
    }
    return { ok: true, visible: overlay.visible, lines: overlay.lines.length };
  }

  // ---------------------------------------------------------------------------
  // 请求分发
  // ---------------------------------------------------------------------------

  const handlers = {
    getInfo: () => getInfo(),
    getSubtitles: () => getSubtitles(),
    // 多来源汇总：网络嗅探 + 播放器实例 + player/v2 + wbi/v2 + initialState
    getSubtitleBundle: async () => {
      const info = getInfo();
      const out = await collectSubtitleTracks(info.aid, info.bvid, info.cid);
      return { ok: true, ...out };
    },
    // 兜底：主动点开播放器字幕菜单，逼播放器发一次字幕请求
    triggerSubtitleMenu: async () => triggerSubtitleMenu(),
    sniffStatus: () => ({ count: subtitleSniff.items.size, lastAt: subtitleSniff.lastAt }),
    getAudio: () => getAudio(),
    getInitAudio: () => {
      const st = initialState();
      const cand =
        (st && st.videoData && st.videoData.dash) ||
        (st && st.videoInfo && st.videoInfo.dash) ||
        (st && st.dash) ||
        null;
      const list = normalizeAudioList(cand);
      list.sort((a, b) => (a.bandwidth || 1e12) - (b.bandwidth || 1e12));
      const best = list[0] || null;
      return { ok: !!best, initRange: best ? best.initRange : null, indexRange: best ? best.indexRange : null };
    },
    getTime: () => ({ ok: true, currentTime: getCurrentTime(), duration: getDuration() }),
    seek: (p) => seek(p.time),
    setOverlay: (p) => setOverlay(p || {}),
    ping: () => ({ ok: true, href: location.href }),

    // ---- 音轨：全部在页面主环境完成，Referer 由浏览器自动带 ----
    // 音轨候选（按「鲜度」排序：嗅探到的最新 playurl 响应 > __playinfo__ > initialState > 播放器 API）
    getAudioCandidates: async (p) => {
      const { list, diag } = await collectAudioCandidatesWithRefresh(p || {});
      // 优先非 mirrorcos 节点（该节点最容易 403），其次带宽低的（体积小）
      const hostRank = (u) => {
        if (/mirrorcos/i.test(u)) return 2;
        if (/mirrorcosov|cosov/i.test(u)) return 2;
        if (/mirrorakam|akamaized/i.test(u)) return 0;
        if (/mirrorali|mirroraliov/i.test(u)) return 1;
        return 1;
      };
      list.sort((a, b) => hostRank(a.url) - hostRank(b.url) || (a.bandwidth || 1e12) - (b.bandwidth || 1e12));
      return { ok: list.length > 0, candidates: list, sniffed: audioSniff.items.size, diag };
    },
    // 重新解析一份新鲜音轨地址（403 时用）
    refreshAudio: async (p) => refreshAudioUrl(p && p.aid, p && p.bvid, p && p.cid),
    // 页面上下文取字节
    fetchAudioRange: async (p) => fetchAudioRange(p && p.url, p && p.start, p && p.end, { withCredentials: p && p.withCredentials }),
    audioSniffStatus: () => ({ count: audioSniff.items.size, lastAt: audioSniff.lastAt })
  };

  function handleRequest(msg) {
    const fn = handlers[msg.method];
    if (!fn) {
      const known = Object.keys(handlers);
      publish({
        id: msg.id,
        ok: false,
        error: {
          title: '主环境不支持该方法',
          detail: `${msg.method}（当前页面里的注入脚本是旧版本，只支持 ${known.length} 个方法）`,
          action: '请按 F5 刷新这个 B 站页面：扩展更新后，已经在页面上运行的注入脚本不会被自动替换。',
          kind: 'stale-bridge',
          bridgeVersion: (window.__BSUB_PAGE_BRIDGE__ && window.__BSUB_PAGE_BRIDGE__.version) || null,
          supported: known
        }
      });
      return;
    }
    const fail = (err) => {
      publish({
        id: msg.id,
        ok: false,
        error: { title: '读取页面数据失败', detail: (err && err.message) || String(err) }
      });
      LOG('handler 抛错', msg.method, err);
    };
    try {
      const out = fn(msg.params || {});
      if (out && typeof out.then === 'function') {
        out.then((data) => publish({ id: msg.id, ok: true, data })).catch(fail);
        return;
      }
      publish({ id: msg.id, ok: true, data: out });
    } catch (err) {
      fail(err);
    }
  }

  // ---------------------------------------------------------------------------
  // 上报：页面内按钮 / 分 P 变化由内容脚本处理，这里只暴露播放器事件
  // ---------------------------------------------------------------------------

  function reconnect() {
    ensureElements();
    publish({ id: '__hello__', ok: true, data: { ok: true, href: location.href } });
  }

  ensureElements();
  installSubtitleSniffer();
  installPlayurlSniffer();
  reconnect();

  window.__BSUB_PAGE_BRIDGE__ = {
    reconnect,
    handleRequest,
    publish,
    version: '1.39.0',
    // 自检用：当前桥支持哪些方法（用于判断页面里的注入脚本是不是旧版本。
    // 主环境脚本无法在扩展更新后热替换，旧页面只能靠刷新拿到新版本）
    supportedMethods() {
      return Object.keys(handlers);
    },
    // 自检用：按时间查当前字幕行（不改变任何状态）
    probeLineAt(t) {
      return findLineAt(t);
    },
    // 自检用：嗅探到的字幕数量
    sniffStatus() {
      return { count: subtitleSniff.items.size, audio: audioSniff.items.size };
    },
    // 自检用：验证 wbi 签名用的 MD5 实现
    md5Hex(input) {
      return md5Pure(input);
    }
  };
  LOG('页面桥已就绪');
})();
