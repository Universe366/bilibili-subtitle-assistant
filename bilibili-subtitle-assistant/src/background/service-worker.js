// 后台 service worker：RPC 路由、流式转发、平台调用、标签页协调。
// 所有请求都有超时；所有错误都分类为可操作提示。

import { CHANNEL, RPC, METHOD_TIMEOUT, DEFAULT_RPC_TIMEOUT, CONTENT_VERSION, APP_NAME } from '../shared/constants.js';
import { AppError, toErrorPayload } from './errors.js';
import { broadcast, callOnBestTab, collectCandidateTabs, ensureContentScript, isBilibili, pageTypeOf, withTimeout } from './tabs.js';
import * as ST from '../shared/storage.js';
import * as CFG from '../shared/settings.js';
import * as P from './providers.js';
import * as BILI from './bili.js';
import * as M from './mcp.js';
import * as T from './tools.js';
import * as KS from './keyless-search.js';
import * as SC from './search-cache.js';
import { sanitizeResult } from '../shared/untrusted.js';
import { normalizeTimeRange, timeParamsFor, supportsTime, TIME_CAPABLE } from '../shared/time-range.js';
import { routeKeyless, describeRoute, wantsRecency, isCjkQuery } from '../shared/search-router.js';
import { stripQuery } from '../shared/storage.js';

// 检索结果缓存（默认 5 分钟 / 50 条）。
// 免费引擎有限流、付费引擎按次计费，缓存能同时缓解两者。
const searchCache = new SC.ResultCache({ max: 50, ttlMs: 5 * 60 * 1000 });

// 汇总所有「已启用」MCP 服务的工具，统一命名空间为「服务名__工具名」。
// 单个服务失败只记录、不中断其它服务。
async function collectMcpTools(mcpCfg, opts = {}) {
  const servers = (mcpCfg && Array.isArray(mcpCfg.servers) ? mcpCfg.servers : []).filter(
    (x) => x && x.enabled !== false && String(x.url || '').trim()
  );
  const out = [];
  const errors = [];
  for (const server of servers) {
    try {
      const tools = await M.listTools(server, { timeoutMs: 25000, signal: opts.signal });
      for (const t of tools) {
        out.push({
          ...t,
          server,
          serverId: server.id,
          serverName: server.name || server.url,
          qualifiedName: `${String(server.name || server.id).replace(/\s+/g, '_')}__${t.name}`
        });
      }
    } catch (err) {
      errors.push({ server: server.name || server.url, error: toErrorPayload(err) });
    }
  }
  if (!out.length && errors.length) {
    const e = new AppError(
      'mcp',
      'MCP 服务都不可用',
      errors.map((x) => `${x.server}：${x.error.title}`).join('\n'),
      '检查 设置 → MCP 服务 里的地址与鉴权。'
    );
    e.extra = { mcpErrors: errors };
    throw e;
  }
  return out;
}


const inflight = new Map(); // rid -> { controller, label }
// 构建指纹：版本号 + 模块数 + 构建时间（第十一章）。改代码后请同步 BUILD_TIME 与模块表。
const BUILD_MODULES = [
  '../shared/constants.js',
  '../shared/settings.js',
  '../shared/storage.js',
  './errors.js',
  './net.js',
  './providers.js',
  './tabs.js',
  './service-worker.js'
];

const BUILD_TIME = '2025-06-01T00:00:00Z';

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    /* 旧版本无此 API */
  }
  try {
    await chrome.sidePanel.setOptions({ path: 'src/sidepanel/panel.html', enabled: true });
  } catch (err) {
    /* ignore */
  }
  const s = await ST.loadSettings();
  await ST.cacheClearOld(s.cache.subtitleTtlDays);
});

chrome.runtime.onStartup?.addListener?.(() => {
  /* 保持 service worker 注册 */
});

async function initPanelBehavior() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    /* ignore */
  }
}
initPanelBehavior();

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

async function settingsForUi() {
  const s = await ST.loadSettings();
  const safe = CFG.stripSecrets(s);
  safe.__readiness = CFG.computeReadiness(s);
  return safe;
}

// ---------------------------------------------------------------------------
// 与内容脚本 / 页面通信（RPC 代理）
// ---------------------------------------------------------------------------

async function rpcPage(method, params, sender) {
  const opts = {
    tabId: params && params.tabId,
    senderTabId: sender && sender.tab ? sender.tab.id : null,
    timeoutMs: METHOD_TIMEOUT[`page.${method}`] || 15000
  };
  const out = await callOnBestTab(method, params || {}, opts);
  // 统一契约：把内容脚本的 {ok,data} 信封拆开，调用方直接拿载荷
  const payload = out && out.data;
  if (payload && typeof payload === 'object' && 'ok' in payload && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

// 字幕下载（2.1）：协议相对地址补全为页面当前协议；缓存标识去掉查询串。
function normalizeSubtitleUrl(rawUrl, pageUrl) {
  let u = String(rawUrl || '').trim();
  if (!u) throw new AppError('badurl', '字幕地址为空', '', '请重试，或换用语音转录。');
  let proto = 'https:';
  try {
    proto = new URL(pageUrl || 'https://www.bilibili.com').protocol || 'https:';
  } catch (err) {
    proto = 'https:';
  }
  if (u.startsWith('//')) u = `${proto}${u}`;
  if (u.startsWith('/')) u = `${proto}//${new URL(pageUrl || 'https://www.bilibili.com').host}${u}`;
  if (!/^https?:/i.test(u)) u = `${proto}${u}`;
  return u;
}

// 字幕轨解析已统一到 ./bili.js（wbi + player/v2 + view 三重来源），这里不再重复实现。

async function fetchSubtitleBody(url, pageUrl) {
  const target = normalizeSubtitleUrl(url, pageUrl);
  let referer = 'https://www.bilibili.com/';
  try {
    const u = new URL(pageUrl || referer);
    referer = `${u.protocol}//${u.host}/`;
  } catch (err) {
    /* ignore */
  }
  let res;
  try {
    res = await fetch(target, {
      method: 'GET',
      credentials: 'include',
      headers: { accept: 'application/json, text/plain, */*', referer, origin: referer.replace(/\/$/, '') },
      redirect: 'follow'
    });
  } catch (err) {
    throw new AppError(
      'download',
      '字幕下载失败（网络错误）',
      (err && err.message) || '',
      '确认已登录 B 站并刷新页面后重试；也可改用语音转录。'
    );
  }
  if (!res.ok) {
    throw new AppError(
      'download',
      '字幕下载失败',
      `HTTP ${res.status} ${target}`,
      res.status === 403
        ? '字幕地址可能已过期（签名短时效），请刷新 B 站页面重新抓取。'
        : '请刷新页面后重试，或改用语音转录。',
      { status: res.status, url: target }
    );
  }
  const text = await res.text();
  // 有些接口（例如 /x/v2/subtitle/web/view）返回的是 **protobuf**
  // （content-type: application/octet-stream），不是字幕正文。
  // 把它当文本解析会得到一堆控制字符拼成的「随机字幕」，
  // 看起来就像「出现了别的视频的字幕，而且每次还不一样」。
  const ctype = String(res.headers.get('content-type') || '').toLowerCase();
  const binaryish = /octet-stream|protobuf|grpc|video\/|audio\//.test(ctype);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (err) {
    if (binaryish) {
      return { format: 'text', body: '', url: target, rejected: `接口返回二进制（${ctype}），不是字幕正文` };
    }
    return { format: 'text', body: text, url: target };
  }
  // 字幕正文的 JSON 形状有很多版本（body / data.body / content / 纯数组…），统一解析
  const lines = BILI.extractLines(json);
  if (lines.length) {
    return { format: 'json-array', lines, url: target };
  }
  // 兼容：有些来源返回 { body: "纯文本" }
  const inner = json && (json.body || json.content);
  if (typeof inner === 'string' && inner.trim()) {
    return { format: 'text', body: inner, url: target };
  }
  return { format: 'json-array', lines: [], url: target, raw: text.slice(0, 400) };
}

// 音轨分块（Range 请求，带 cookie）
async function fetchAudioChunk(params) {
  const { url, start, end, pageUrl } = params;
  if (!url) throw new AppError('badurl', '音轨地址为空', '', '请刷新页面重新解析音轨地址。');
  let referer = 'https://www.bilibili.com/';
  try {
    const u = new URL(pageUrl || referer);
    referer = `${u.protocol}//${u.host}/`;
  } catch (err) {
    /* ignore */
  }
  const headers = {
    referer,
    origin: referer.replace(/\/$/, ''),
    range: `bytes=${start}-${end}`
  };
  let res;
  try {
    res = await fetch(url, { method: 'GET', credentials: 'include', headers, redirect: 'follow' });
  } catch (err) {
    throw new AppError('download', '音轨下载失败（网络错误）', (err && err.message) || '', '刷新页面后重试。');
  }
  if (!res.ok && res.status !== 206) {
    throw new AppError(
      'download',
      '音轨下载失败',
      `HTTP ${res.status}`,
      res.status === 403
        ? '音轨地址可能是短时效签名，请刷新 B 站页面重新获取后再转录。'
        : '请刷新页面后重试。',
      { status: res.status }
    );
  }
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let base64 = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    base64 += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return {
    base64: btoa(base64),
    byteLength: bytes.length,
    contentRange: res.headers.get('content-range') || null,
    contentType: res.headers.get('content-type') || null
  };
}

// 音轨 HEAD：拿总长度与类型，用于按平台上限自适应分块（2.2）
async function headAudio(params) {
  const { url, pageUrl } = params;
  if (!url) throw new AppError('badurl', '音轨地址为空', '', '请刷新页面重新解析音轨地址。');
  let referer = 'https://www.bilibili.com/';
  try {
    const u = new URL(pageUrl || referer);
    referer = `${u.protocol}//${u.host}/`;
  } catch (err) {
    /* ignore */
  }
  const headers = { referer, origin: referer.replace(/\/$/, '') };
  try {
    let res = await fetch(url, { method: 'HEAD', credentials: 'include', headers, redirect: 'follow' });
    if (!res.ok) {
      // 有些 CDN 不支持 HEAD，用 1 字节 Range 探测
      res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { ...headers, range: 'bytes=0-1' },
        redirect: 'follow'
      });
    }
    const contentRange = res.headers.get('content-range');
    let total = null;
    if (contentRange && /\/(\d+)$/.test(contentRange)) total = Number(RegExp.$1);
    else {
      const len = res.headers.get('content-length');
      if (len && res.status === 200) total = Number(len);
    }
    return {
      totalBytes: total,
      contentType: res.headers.get('content-type') || null,
      acceptRanges: res.headers.get('accept-ranges') || null,
      status: res.status
    };
  } catch (err) {
    throw new AppError('download', '音轨探测失败', (err && err.message) || '', '刷新页面后重试。');
  }
}

// ---------------------------------------------------------------------------
// RPC 方法表
// ---------------------------------------------------------------------------

const methods = {
  'settings.get': async () => settingsForUi(),

  'settings.set': async (params) => {
    const stored = await ST.loadSettings();
    const merged = CFG.mergeSecrets(params?.settings || {}, stored);
    const saved = await ST.saveSettings(merged);
    await broadcast({ type: 'bsub:settings-changed' });
    await pushPageOptions(saved);
    return settingsForUi();
  },

  'settings.patch': async (params) => {
    await ST.patchSettings(params.path || [], params.value);
    await broadcast({ type: 'bsub:settings-changed' });
    await pushPageOptions(await ST.loadSettings());
    return settingsForUi();
  },

  'settings.reset': async () => {
    await ST.saveSettings(CFG.defaultSettings());
    await broadcast({ type: 'bsub:settings-changed' });
    return settingsForUi();
  },

  'platform.test': async (params) => {
    const s = await ST.loadSettings();
    const kind = params.kind;
    if (kind === 'ai') {
      const plat = s.ai.platforms.find((p) => p.id === params.id);
      return P.testAiPlatform(plat);
    }
    if (kind === 'asr') {
      const plat = s.asr.platforms.find((p) => p.id === params.id);
      return P.testAsrPlatform(plat);
    }
    if (kind === 'search') {
      const plat = s.search.platforms.find((p) => p.id === params.id);
      return P.testSearchPlatform(plat);
    }
    throw new AppError('badargs', '未知的测试类型', String(kind), '请在设置页点击「测试连接」。');
  },

  'platform.models': async (params) => {
    const s = await ST.loadSettings();
    const kind = params.kind;
    if (kind === 'ai') {
      const plat = s.ai.platforms.find((p) => p.id === params.id);
      const out = await P.listModelsWithSource(plat);
      return { models: out.models, baseUrl: out.baseUrl, url: out.url, keyLength: out.keyLength, fallback: false };
    }
    // 语音识别 / 检索多数平台没有 /models；先尝试 OpenAI 兼容，失败则返回内置建议
    const list = kind === 'asr' ? s.asr.platforms : s.search.platforms;
    const plat = list.find((p) => p.id === params.id);
    try {
      const out = await P.listModelsWithSource({ ...plat, model: plat.model || 'x' }, { kind: kind === 'asr' ? '语音识别' : '检索' });
      return { models: out.models, baseUrl: out.baseUrl, url: out.url, keyLength: out.keyLength, fallback: false };
    } catch (err) {
      return {
        models: plat.models || [],
        fallback: true,
        baseUrl: plat.baseUrl,
        url: `${String(plat.baseUrl || '').replace(/\/+$/, '')}/models`,
        keyLength: String(plat.apiKey || '').trim().length,
        reason: toErrorPayload(err).title,
        detail: toErrorPayload(err).detail
      };
    }
  },

  'permission.request': async (params) => P.ensureOriginPermission(params.url),

  // 诊断：把「每个主机 × 每种传输方式」的实际返回列成表
  'platform.probe': async (params) => {
    const s = await ST.loadSettings();
    const kind = params.kind;
    const list = kind === 'ai' ? s.ai.platforms : kind === 'asr' ? s.asr.platforms : s.search.platforms;
    const plat = (list || []).find((p) => p.id === params.id);
    if (!plat) throw new AppError('nokey', '找不到该平台', String(params.id), '请在设置页重新选择平台。');
    return P.probePlatformMatrix(plat, { timeoutMs: 15000 });
  },

  'permission.list': async () => {
    const all = await chrome.permissions.getAll();
    return { origins: all.origins || [] };
  },

  // ---- 页面 ----
  'page.info': async (_p, sender) => rpcPage('getInfo', {}, sender),
  'page.subtitles': async (_p, sender) => rpcPage('getSubtitles', {}, sender),
  'page.time': async (_p, sender) => rpcPage('getTime', {}, sender),
  'page.seek': async (params, sender) => rpcPage('seek', { time: params.time }, sender),
  'page.audio': async (_p, sender) => rpcPage('getAudio', {}, sender),
  'page.call': async (params, sender) => rpcPage(params.name, params.params || {}, sender),

  'page.options': async (params) => {
    // 把界面选项推给页面（按钮开关 / 覆盖字幕 / 跟随播放）
    const s = await ST.loadSettings();
    return pushPageOptions(s, params && params.tabId);
  },

  'page.refresh': async (params, sender) => {
    const info = await collectCandidateTabs({ tabId: params?.tabId, senderTabId: sender?.tab?.id });
    const rows = [];
    for (const t of info) {
      let ping = null;
      try {
        ping = await withTimeout(chrome.tabs.sendMessage(t.id, { type: 'bsub:ping' }), 1200);
      } catch (err) {
        ping = null;
      }
      rows.push({
        tabId: t.id,
        url: t.url,
        title: t.title,
        pageType: pageTypeOf(t.url),
        scriptVersion: ping ? ping.version : null,
        stale: !!(ping && ping.version !== CONTENT_VERSION)
      });
    }
    return { tabs: rows, contentVersion: CONTENT_VERSION };
  },

  'page.reinject': async (params) => {
    await ensureContentScript(params.tabId, { pingTimeoutMs: 800 });
    return { ok: true };
  },

  // 批量队列：给一个 B 站链接，自动开一个后台标签页取出视频信息与字幕轨，
  // 用完即关（用户已打开同一地址则直接复用，不关闭）。
  'batch.resolve': async (params) => {
    const url = String(params.url || '').trim();
    if (!/^https?:\/\/([^/]*\.)?bilibili\.com\//i.test(url)) {
      throw new AppError(
        'badurl',
        '链接不是 B 站播放页',
        url,
        '请粘贴类似 https://www.bilibili.com/video/BVxxxx 的地址。'
      );
    }
    const target = normalizeBatchUrl(url);
    const existing = (await chrome.tabs.query({})).find((t) => stripQuery(t.url || '') === stripQuery(target));
    let tabId = existing ? existing.id : null;
    let created = null;
    if (tabId == null) {
      created = await chrome.tabs.create({ url: target, active: false });
      tabId = created.id;
      await waitTabComplete(tabId, 45000);
    }
    try {
      await ensureContentScript(tabId, { pingTimeoutMs: 2500 });
      const info = await withTimeout(
        chrome.tabs.sendMessage(tabId, { type: CHANNEL.TO_CONTENT, method: 'getInfo', params: {} }),
        20000,
        '批量读取视频信息超时'
      );
      const subs = await withTimeout(
        chrome.tabs.sendMessage(tabId, { type: CHANNEL.TO_CONTENT, method: 'getSubtitles', params: {} }),
        20000,
        '批量读取字幕轨超时'
      );
      const video = { ...(info && info.data ? info.data : {}) };
      video.subtitleTracks = (subs && subs.data && subs.data.subtitles) || [];
      video.url = target;
      registerTab(tabId);
      return { video, tabId, openedNew: !!created };
    } catch (err) {
      if (created) {
        try {
          await chrome.tabs.remove(tabId);
        } catch (e) {
          /* ignore */
        }
      }
      throw err;
    }
  },

  'batch.release': async (params) => {
    if (params && params.closeTab && params.tabId != null) {
      try {
        await chrome.tabs.remove(params.tabId);
      } catch (err) {
        /* ignore */
      }
    }
    return { ok: true };
  },

  // ---- 字幕 ----
  // 官方接口直连（wbi 签名 + player/v2 + view 三重来源）。页面侧读不到时的主要兜底。
  'subtitle.api': async (params) => {
    const out = await BILI.fetchSubtitleTracks(
      { aid: params.aid, bvid: params.bvid, cid: params.cid, epId: params.epId, pageUrl: params.pageUrl },
      { timeoutMs: params.timeoutMs || 20000 }
    );
    return {
      tracks: out.tracks,
      code: out.code,
      message: out.message,
      needLogin: out.needLogin,
      sources: out.sources,
      errors: out.errors,
      video: out.video
    };
  },

  // 兜底：让播放器主动发一次字幕请求（点开字幕菜单），看能否在网络里抓到
  'subtitle.trigger': async (_p, sender) => {
    const out = await callOnBestTab('triggerSubtitleMenu', {}, {
      tabId: null,
      senderTabId: sender && sender.tab ? sender.tab.id : null,
      timeoutMs: 25000
    });
    return out.data || { ok: false };
  },

  'subtitle.fetch': async (params) => {
    const data = await fetchSubtitleBody(params.url, params.pageUrl);
    return data;
  },

  'subtitle.cache.get': async (params) => {
    const key = ST.subtitleCacheKey(params);
    const row = await ST.cacheGetSubtitle(key);
    return row ? { hit: true, key, row } : { hit: false, key };
  },

  'subtitle.cache.put': async (params) => {
    const key = ST.subtitleCacheKey(params);
    await ST.cachePutSubtitle(key, params.payload, params.meta || {});
    return { key };
  },

  'subtitle.cache.clear-old': async () => {
    const s = await ST.loadSettings();
    return { removed: await ST.cacheClearOld(s.cache.subtitleTtlDays) };
  },

  // ---- 音轨 ----
  // 关键：音轨一律走「页面主环境」取（page.call fetchAudioRange）。
  // 原因：Referer / Origin / User-Agent 是 Fetch 的 forbidden header，在后台设置会被静默丢弃，
  // B 站 CDN 校验 Referer → 后台请求必然 403，且刷新页面也没用（发起方一直是扩展源）。
  // 页面主环境 fetch 时浏览器自动带 Referer: https://www.bilibili.com/，才能拿到 206。

  // 音轨候选列表（页面侧按鲜度与 host 排序，含 backupUrl）
  'audio.candidates': async (params, sender) => {
    try {
      const out = await rpcPage('getAudioCandidates', { aid: params.aid, bvid: params.bvid, cid: params.cid }, sender);
      return out || { ok: false, candidates: [] };
    } catch (err) {
      // 不要吞掉错误：主环境桥若是旧版本（扩展更新后页面没刷新），
      // 这里会得到「主环境不支持该方法」，这正是「拿不到音轨」的常见真因。
      const payload = toErrorPayload(err);
      return {
        ok: false,
        candidates: [],
        sniffed: 0,
        diag: { stages: [{ stage: '调用主环境桥失败', error: `${payload.title}：${payload.detail || ''}` }], bridgeError: payload }
      };
    }
  },

  // 403 时重新解析一份新鲜地址
  'audio.refresh': async (params, sender) => rpcPage('refreshAudio', { aid: params.aid, bvid: params.bvid, cid: params.cid }, sender),

  'audio.head': async (params, sender) => {
    // 优先用页面侧 1 字节 Range 探测（同时验证 Referer 是否被接受）
    if (params.url && !params.forceBackground) {
      try {
        const probe = await rpcPage('fetchAudioRange', { url: params.url, start: 0, end: 1 }, sender);
        if (probe && probe.ok) {
          let total = null;
          if (probe.contentRange && /\/(\d+)$/.test(probe.contentRange)) total = Number(RegExp.$1);
          return {
            totalBytes: total,
            contentType: probe.contentType || null,
            status: probe.status,
            viaPage: true,
            acceptRanges: total ? 'bytes' : null
          };
        }
        if (probe && probe.reason === 'http') {
          return { totalBytes: null, viaPage: true, failed: true, status: probe.status, reason: probe.reason };
        }
      } catch (err) {
        /* 页面不可用，落到后台探测 */
      }
    }
    const head = await headAudio(params);
    if ((head.totalBytes == null || !Number.isFinite(head.totalBytes)) && params.url) {
      try {
        const probe = await fetchAudioChunk({ url: params.url, pageUrl: params.pageUrl, start: 0, end: 1 });
        if (probe.contentRange && /\/(\d+)$/.test(probe.contentRange)) head.totalBytes = Number(RegExp.$1);
        head.probed = true;
      } catch (err) {
        /* 保留原结果 */
      }
    }
    return head;
  },

  // 取一段字节：页面优先，失败再退后台（后台可能因 Referer 缺失而 403）
  'audio.range': async (params, sender) => {
    const page = async () => rpcPage('fetchAudioRange', { url: params.url, start: params.start, end: params.end }, sender);
    try {
      const out = await page();
      if (out && out.ok) return out;
      if (out && (out.reason === 'http' || out.reason === 'html')) {
        const err = new AppError(
          'audio-forbidden',
          out.reason === 'html' ? '音轨请求被防盗链拦截' : `音轨下载失败（HTTP ${out.status}）`,
          `URL: ${String(params.url).slice(0, 120)}`,
          '正在尝试刷新音轨地址后重试；若持续失败请刷新 B 站页面。',
          { status: out.status, reason: out.reason }
        );
        throw err;
      }
      if (out && out.reason === 'network') {
        throw new AppError('network', '音轨下载失败（网络错误）', out.message || '', '确认网络后重试。');
      }
    } catch (err) {
      if (err instanceof AppError && err.kind !== 'alltabs' && err.kind !== 'notab' && err.kind !== 'nopage') throw err;
      // 页面不可用（没有 B 站标签页）→ 退回后台请求
    }
    return fetchAudioChunk(params);
  },

  'audio.chunk': async (params, sender) => {
    // 与 audio.range 同一实现，保留旧名字兼容
    const fn = methods['audio.range'];
    return fn(params, sender);
  },

  // 语音识别：侧边栏把 16kHz 单声道 WAV 片段发来，由后台代发请求（带超时与错误分类）
  'asr.transcribe': async (params) => {
    const s = await ST.loadSettings();
    const plat = s.asr.platforms.find((p) => p.id === params.platformId) || CFG.activeAsr(s);
    if (!params || !params.base64) {
      throw new AppError('badargs', '音频片段为空', '', '请重新发起语音转录。');
    }
    const bytes = P.base64ToBytes(params.base64);
    // HTTP 超时 = 用户配置值，但**至少要覆盖上传时间**。
    // 事故复盘：13MB WAV 的 base64 上传本身就约需 30 秒，
    // 若超时设得过小（旧默认 30s）会在上传阶段就被掐断。
    const configured = (Number(s.asr.timeoutSeconds) || 180) * 1000;
    const uploadAllowanceMs = Math.ceil(bytes.length / 1024 / 200) * 1000; // 按 200KB/s 保守估
    const timeoutMs = Math.max(configured, (params.timeoutMs || 0), uploadAllowanceMs + 60000);
    const out = await P.transcribeSlice(plat, bytes, {
      timeoutMs,
      // 把文件名（含扩展名）透传给平台：有些服务端会按扩展名判断音频格式
      filename: params.filename || null
    });
    return out;
  },

  // ---- 检索 ----
  'search.provider': async (params) => {
    const s = await ST.loadSettings();
    const plat = s.search.platforms.find((p) => p.id === params.id) || CFG.activeSearch(s);
    const hasKey = !!(plat && String(plat.apiKey || '').trim());
    const allowKeyless = s.search.keylessFallback !== false;

    // 时间过滤：参数优先，其次设置里的默认值
    const tr = normalizeTimeRange(params.timeRange !== undefined ? params.timeRange : s.search.timeRange);

    // 缓存时长由设置决定（分钟；0 = 关闭）
    searchCache.ttlMs = Math.max(0, Number(s.search.cacheMinutes ?? 5) || 0) * 60 * 1000;

    // 先查缓存：同一句话反复问时省额度也更快
    const cacheKey = searchCache.keyOf(params.query, {
      maxResults: params.maxResults || s.search.maxResults,
      providerId: hasKey ? plat.id : '',
      fetchPageContent: params.fetchPageContent,
      timeRange: tr ? tr.id : ''
    });
    const cached = searchCache.get(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    // 配置了 Key → 走用户的正式渠道；否则（或它失败了）→ 用免费无 Key 引擎兜底。
    // 这样「没配 Key」不再是「联网不可用」。
    let out = null;
    const keylessFallback = async (reason) => {
      if (!allowKeyless) {
        throw new AppError(
          'search',
          '检索失败',
          reason || '当前检索平台不可用，且已在设置里关闭了免费引擎兜底。',
          '可在 设置 → 联网检索 检查 Key，或开启「允许使用免费引擎兜底」。'
        );
      }
      // 智能路由：按查询语言与时效需求决定先试谁
      const customOrder = Array.isArray(s.search.keylessOrder) && s.search.keylessOrder.length ? s.search.keylessOrder : null;
      const route = routeKeyless(params.query, { order: customOrder, timeRange: tr });
      const kl = await KS.searchKeyless(params.query, {
        maxResults: params.maxResults || s.search.maxResults,
        timeoutMs: 20000,
        order: route.order,
        timeRange: tr
      });
      if (!kl.results.length) {
        throw new AppError(
          'search',
          '所有检索方式都失败了',
          `${reason ? reason + '；' : ''}免费引擎也全部失败：${KS.describeAttempts(kl.attempts)}`,
          '可在 设置 → 联网检索 填一个检索平台的 Key（更稳），或稍后重试（免费引擎偶发限流）。'
        );
      }
      const notes = [];
      if (reason) notes.push(`${reason}，已改用免费引擎 ${kl.engineLabel}`);
      // 如实说明：免费引擎实测都不支持时间过滤
      if (tr && !kl.timeFiltered) {
        notes.push(
          `免费引擎（${kl.engineLabel}）不支持按时间过滤，结果可能包含较早内容；` +
            '需要严格的时间范围请配置 Tavily / Exa / 博查 等支持时间过滤的检索平台'
        );
      }
      return {
        results: kl.results.map((r) => sanitizeResult(r)),
        query: params.query,
        provider: `免费引擎（${kl.engineLabel}）`,
        keyless: {
          engine: kl.engine,
          engineLabel: kl.engineLabel,
          attempts: kl.attempts,
          route: route.order,
          routeReason: describeRoute(route)
        },
        timeRange: tr ? tr.label : '',
        timeFiltered: !!kl.timeFiltered,
        note: notes.join('；')
      };
    };

    if (hasKey) {
      try {
        const r = await P.searchProvider(plat, params.query, {
          maxResults: params.maxResults || s.search.maxResults,
          fetchPageContent: params.fetchPageContent,
          timeRange: tr,
          signal: registerExternalAbort(params.rid)
        });
        // 只有该平台**真的**支持时间过滤时才声称已过滤
        const platformTimeOk = supportsTime(plat.kind) || supportsTime(plat.id);
        out = {
          ...r,
          results: (r.results || []).map((x) => sanitizeResult(x)),
          timeRange: tr ? tr.label : '',
          timeFiltered: tr ? platformTimeOk : true
        };
        if (tr && !platformTimeOk) {
          out.note = `${plat.name} 不支持按时间过滤，结果可能包含较早内容`;
        }
      } catch (err) {
        const detail = (err && err.payload && err.payload.title) || (err && err.message) || '未知错误';
        out = await keylessFallback(`配置的检索平台（${plat.name}）失败：${detail}`);
      }
    } else {
      out = await keylessFallback('');
    }

    searchCache.set(cacheKey, out);
    return out;
  },

  'search.fetch-page': async (params) => ({
    text: await P.fetchPageText(params.url, { signal: registerExternalAbort(params.rid) })
  }),

  'search.open-engine': async (params) => {
    const s = await ST.loadSettings();
    const engines = {
      bing: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
      google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
      baidu: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
      duckduckgo: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
      bilibili: (q) => `https://search.bilibili.com/all?keyword=${encodeURIComponent(q)}`
    };
    const engine = params.engine || s.search.engine || 'bing';
    const fn = engines[engine] || engines.bing;
    const url = fn(params.query || '');
    await chrome.tabs.create({ url, active: true });
    return { url };
  },

  // ---- 历史 / 缓存 / 诊断 ----
  'history.list': async (params) => ({ rows: await ST.historyList(params?.limit || 100) }),
  'history.get': async (params) => ({ row: await ST.historyGet(params.key) }),
  'history.put': async (params) => ({ row: await ST.historyPut(params.video, params.entry) }),
  'history.remove': async (params) => {
    await ST.historyRemove(params.key);
    return { ok: true };
  },
  'history.clear': async () => {
    await ST.historyClear();
    return { ok: true };
  },

  'cache.stats': async () => ST.cacheStats(),
  'cache.clear': async () => {
    await ST.db.clear(ST.STORES.STORE_CACHE);
    await ST.clearAudioChunks();
    return { ok: true };
  },

  diagnostics: async () => {
    const s = await ST.loadSettings();
    const stats = await ST.cacheStats();
    let permissions = {};
    try {
      permissions = await chrome.permissions.getAll();
    } catch (err) {
      permissions = {};
    }
    const mb = await chrome.runtime.getManifest();
    return {
      app: APP_NAME,
      extensionVersion: mb.version,
      contentVersion: CONTENT_VERSION,
      manifestVersion: mb.manifest_version,
      userAgent: navigator.userAgent,
      buildTime: BUILD_TIME,
      modules: BUILD_MODULES.length,
      readiness: CFG.computeReadiness(s),
      cache: stats,
      permissions,
      platformSummary: {
        ai: s.ai.platforms.map((p) => ({ id: p.id, name: p.name, active: p.id === s.ai.activeId, keySet: CFG.hasSecret(p.apiKey), model: p.model, baseUrl: p.baseUrl })),
        asr: s.asr.platforms.map((p) => ({ id: p.id, name: p.name, active: p.id === s.asr.activeId, keySet: CFG.hasSecret(p.apiKey), model: p.model, baseUrl: p.baseUrl })),
        search: s.search.platforms.map((p) => ({ id: p.id, name: p.name, active: p.id === s.search.activeId, keySet: CFG.hasSecret(p.apiKey), baseUrl: p.baseUrl }))
      }
    };
  },

  'build.info': async () => ({
    app: APP_NAME,
    version: chrome.runtime.getManifest().version,
    contentVersion: CONTENT_VERSION,
    modules: BUILD_MODULES.length,
    buildTime: BUILD_TIME
  }),

  'tab.open': async (params) => {
    const tab = await chrome.tabs.create({ url: params.url, active: params.active !== false });
    return { tabId: tab.id };
  },

  'sidepanel.open': async (params, sender) => {
    const tabId = params?.tabId ?? sender?.tab?.id;
    if (tabId == null) return { ok: false, reason: 'no-tab' };
    try {
      if (chrome.sidePanel.open) await chrome.sidePanel.open({ tabId });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String(err && err.message) };
    }
  },

  'ai.chat': async (params) => {
    const s = await ST.loadSettings();
    const plat = s.ai.platforms.find((p) => p.id === (params.platformId || s.ai.activeId));
    const messages = params.messages || [];

    // 若开启了 MCP，先收集可用工具，再走「带工具的对话循环」。
    // 失败时降级为普通对话 —— 宁可回答得朴素一点，也不要整个对话不可用。
    let tools = [];
    let mcpError = null;
    if (s.mcp && s.mcp.enabled && Array.isArray(s.mcp.servers) && s.mcp.servers.length) {
      try {
        tools = await collectMcpTools(s.mcp, { signal: registerExternalAbort(params.rid) });
      } catch (err) {
        mcpError = toErrorPayload(err);
      }
    }

    if (tools.length) {
      const out = await T.chatWithTools(plat, messages, tools, {
        temperature: params.temperature,
        maxTokens: params.maxTokens || s.ai.maxTokens,
        timeoutMs: params.timeoutMs || 300000,
        signal: registerExternalAbort(params.rid),
        maxToolRounds: s.mcp.maxToolRounds,
        toolTimeoutMs: s.mcp.callTimeoutMs
      });
      return { text: out.text, toolEvents: out.toolEvents, mcp: { tools: tools.length, rounds: out.rounds, mcpError } };
    }

    const text = await P.chatOnce(plat, messages, {
      temperature: params.temperature,
      maxTokens: params.maxTokens || s.ai.maxTokens,
      timeoutMs: params.timeoutMs || 300000,
      signal: registerExternalAbort(params.rid)
    });
    return { text, mcp: { tools: 0, mcpError } };
  },

  // ---- MCP ----
  // 连接一个 MCP 服务并列出工具（设置页「测试连接」用）
  'mcp.probe': async (params) => {
    const s = await ST.loadSettings();
    const server = (s.mcp.servers || []).find((x) => x.id === params.id) || params.server;
    const out = await M.connectServer(server, { timeoutMs: 30000 });
    return out;
  },

  // 列出所有已启用 MCP 服务的工具（合并后返回）
  'mcp.tools': async () => {
    const s = await ST.loadSettings();
    const tools = await collectMcpTools(s.mcp, {});
    return {
      tools: tools.map((t) => ({
        qualifiedName: t.qualifiedName,
        serverName: t.serverName,
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      }))
    };
  },

  // 热门评论（总结时参考用；失败返回 ok:false，绝不抛错）
  'bili.comments': async (params) =>
    BILI.fetchTopComments(
      { aid: params.aid, bvid: params.bvid, pageUrl: params.pageUrl },
      { limit: params.limit || 10, timeoutMs: 20000 }
    ),

  // 展开 B 站合集 → 视频列表（供批量队列使用）
  'bili.collection': async (params) =>
    BILI.expandCollection(
      { mid: params.mid, seasonId: params.seasonId, pageUrl: params.pageUrl },
      { timeoutMs: params.timeoutMs || 25000, maxItems: params.maxItems || 400 }
    ),

  'cancel': async (params) => {
    const rec = inflight.get(params.rid);
    if (rec) {
      rec.controller.abort();
      inflight.delete(params.rid);
      return { cancelled: true };
    }
    return { cancelled: false };
  },

  'cancel-all': async () => {
    for (const [, rec] of inflight) rec.controller.abort();
    inflight.clear();
    return { ok: true };
  }
};

// 外部终止注册表（RPC 形式也支持 rid 取消）
const externalAborts = new Map();
function registerExternalAbort(rid) {
  if (!rid) return null;
  let rec = externalAborts.get(rid);
  if (!rec) {
    rec = new AbortController();
    externalAborts.set(rid, rec);
  }
  return rec.signal;
}

// 批量：规整链接（补协议、去易变参数、保留 p 分 P 参数）
function normalizeBatchUrl(url) {
  let u;
  try {
    u = new URL(/^https?:/i.test(url) ? url : `https://${url}`);
  } catch (err) {
    return url;
  }
  const p = u.searchParams.get('p');
  const clean = new URL(`${u.protocol}//${u.host}${u.pathname}`);
  if (p) clean.searchParams.set('p', p);
  return clean.toString();
}

function waitTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') finish(null);
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(
      (t) => {
        if (t && t.status === 'complete') finish(null);
      },
      () => finish(null)
    );
  });
}

// 把界面选项推给内容脚本（按钮 / 页面内字幕 / 跟随播放）
async function pushPageOptions(settings, tabId) {
  const payload = {
    playerButton: settings.page.playerButton,
    playerButtonPrompt: settings.page.playerButtonPrompt,
    overlay: settings.page.overlay,
    overlayFontScale: settings.page.overlayFontScale,
    overlayBottom: settings.page.overlayBottom,
    followPlayback: settings.page.followPlayback
  };
  const targets = [];
  if (tabId != null) targets.push(tabId);
  else {
    const tabs = await collectCandidateTabs({});
    for (const t of tabs) targets.push(t.id);
  }
  for (const id of targets) {
    try {
      await withTimeout(chrome.tabs.sendMessage(id, { type: CHANNEL.TO_CONTENT, method: 'applyOptions', params: payload }), 3000);
    } catch (err) {
      /* 标签页不可用，跳过 */
    }
  }
  return { pushed: targets.length };
}

// ---------------------------------------------------------------------------
// 消息入口
// ---------------------------------------------------------------------------

function methodTimeout(method) {
  return METHOD_TIMEOUT[method] || DEFAULT_RPC_TIMEOUT;
}

async function handleRpc(message, sender) {
  const fn = methods[message.method];
  if (!fn) {
    throw new AppError('nomethod', '未知请求', String(message.method), '请更新扩展或刷新侧边栏。');
  }
  const timeout = methodTimeout(message.method);
  const rid = message.params && message.params.rid;
  const result = await withTimeout(
    Promise.resolve().then(() => fn(message.params || {}, sender)),
    timeout,
    `${message.method} 超时`
  );
  if (rid) externalAborts.delete(rid);
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return undefined;
  if (message.type === 'bsub:ping') {
    sendResponse({ ok: true, version: CONTENT_VERSION });
    return undefined;
  }
  if (message.kind === RPC.KIND_REQ) {
    handleRpc(message, sender)
      .then((data) => sendResponse({ kind: RPC.KIND_RES, id: message.id, ok: true, data }))
      .catch((err) => sendResponse({ kind: RPC.KIND_RES, id: message.id, ok: false, error: toErrorPayload(err) }));
    return true;
  }
  if (message.type === 'bsub:content-event') {
    // 内容脚本上报的事件（分 P 变化、按钮点击等）转发给侧边栏
    broadcast({ type: 'bsub:content-event', event: message.event, payload: message.payload, tabId: sender?.tab?.id });
    if (message.event === 'player-button' || message.event === 'open-panel') {
      const tabId = sender?.tab?.id;
      if (tabId != null && chrome.sidePanel?.open) {
        // 这里由内容脚本另外发一条 bsub:open-side-panel 来拿结果，
        // 此处只做「顺手也开一下」，失败不额外处理（那条消息会报原因）。
        chrome.sidePanel.open({ tabId }).catch(() => {});
      }
    }
    sendResponse({ ok: true });
    return undefined;
  }
  if (message.type === 'bsub:open-side-panel') {
    // 打开侧边栏失败的原因必须**报出去**，不能吞掉。
    //
    // 早先这里是 `chrome.sidePanel.open({tabId}).catch(() => {})` ——
    // 失败时用户看到的就是「点了没反应」，而我们什么都不知道。
    // 常见失败原因：
    //   · 页面主环境的点击没被 Chrome 认作「用户手势」（安全限制）
    //   · 浏览器不支持 sidePanel.open（Chrome < 116）
    //   · 该标签页被 setOptions 关掉了侧边栏
    const tabId = sender?.tab?.id;
    const done = (payload) => {
      sendResponse(payload);
    };
    if (tabId == null) {
      done({ ok: false, reason: 'no-tab', detail: '拿不到当前标签页 ID' });
      return undefined;
    }
    if (!chrome.sidePanel?.open) {
      done({
        ok: false,
        reason: 'unsupported',
        detail: '当前浏览器不支持以程序方式打开侧边栏（需要 Chrome 116+），请点工具栏上的扩展图标。'
      });
      return undefined;
    }
    // 先确保这个标签页的侧边栏是启用的，再打开
    try {
      chrome.sidePanel
        .setOptions({ tabId, path: 'src/sidepanel/panel.html', enabled: true })
        .catch(() => {});
    } catch (err) {
      /* ignore */
    }
    chrome.sidePanel
      .open({ tabId })
      .then(() => done({ ok: true }))
      .catch((err) => {
        const msg = String((err && err.message) || err);
        // 手势限制是唯一「用户自己能解决」的一类，单独说明
        const gesture = /user gesture|must be called|gesture/i.test(msg);
        done({
          ok: false,
          reason: gesture ? 'gesture' : 'error',
          detail: gesture
            ? '浏览器要求打开侧边栏必须来自用户手势。请点浏览器工具栏上的扩展图标打开（或在扩展设置里把它固定到工具栏）。'
            : msg
        });
      });
    return true; // 异步 sendResponse
  }
  return undefined;
});

// ---------------------------------------------------------------------------
// 流式端口
// ---------------------------------------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== RPC.PORT_NAME) return;
  const states = new Map();

  port.onMessage.addListener(async (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind === RPC.KIND_START) {
      const rid = msg.rid;
      const controller = new AbortController();
      states.set(rid, { controller, label: msg.route });
      try {
        await runStreamRoute(msg, port, controller);
        port.postMessage({ kind: RPC.KIND_END, rid });
      } catch (err) {
        port.postMessage({ kind: RPC.KIND_ERROR, rid, error: toErrorPayload(err) });
      } finally {
        states.delete(rid);
        externalAborts.delete(rid);
      }
      return;
    }
    if (msg.kind === 'stream:cancel') {
      const st = states.get(msg.rid);
      if (st) st.controller.abort();
      const ext = externalAborts.get(msg.rid);
      if (ext) ext.abort();
      return;
    }
  });

  port.onDisconnect.addListener(() => {
    for (const [, st] of states) st.controller.abort();
    states.clear();
  });
});

async function runStreamRoute(msg, port, controller) {
  const { rid, route, params = {} } = msg;
  const send = {
    delta: (text) => port.postMessage({ kind: RPC.KIND_DELTA, rid, text }),
    log: (level, text) => port.postMessage({ kind: RPC.KIND_LOG, rid, level, text }),
    progress: (info) => port.postMessage({ kind: 'stream:progress', rid, info }),
    replace: (text) => port.postMessage({ kind: 'stream:replace', rid, text }),
    tool: (event) => port.postMessage({ kind: 'stream:tool', rid, event }),
    reasoning: (text) => port.postMessage({ kind: 'stream:reasoning', rid, text })
  };
  const settings = await ST.loadSettings();

  if (route === 'ai.chat' || route === 'ai.summarize') {
    const plat = settings.ai.platforms.find((p) => p.id === (params.platformId || settings.ai.activeId));
    const messages = params.messages || [];
    const timeoutMs = params.timeoutMs || (route === 'ai.summarize' ? 600000 : 300000);

    // ---- MCP 工具（只对对话生效，总结不需要外部工具）----
    // 注意：面板的对话走的是**流式**路由，而工具调用是非流式的多轮循环。
    // 所以有工具时改走 chatWithTools，普通对话仍走 chatStream（保留逐字输出）。
    let tools = [];
    let mcpError = '';
    if (route === 'ai.chat' && settings.mcp && settings.mcp.enabled) {
      try {
        tools = await collectMcpTools(settings.mcp, { signal: controller.signal });
      } catch (err) {
        mcpError = err && err.message ? err.message : String(err);
      }
    }

    if (tools.length) {
      send.log('info', `已连接 ${tools.length} 个 MCP 工具，本轮对话将按需要调用`);
      const out = await T.chatWithTools(plat, messages, tools, {
        temperature: params.temperature ?? settings.ai.temperature,
        maxTokens: params.maxTokens || settings.ai.maxTokens,
        signal: controller.signal,
        timeoutMs,
        maxToolRounds: settings.mcp && settings.mcp.maxToolRounds,
        toolTimeoutMs: settings.mcp && settings.mcp.callTimeoutMs,
        onToolEvent: (e) => send.tool(e)
      });
      // 工具循环本身是整段返回的，这里一次性推给面板
      if (out.text) send.delta(out.text);
      if (out.toolEvents && out.toolEvents.length) {
        send.log('info', `本轮调用了 ${out.toolEvents.filter((e) => e.phase === 'end').length} 次工具`);
      }
      return { text: out.text };
    }
    if (mcpError) {
      send.log('warn', `MCP 工具不可用，已降级为普通对话：${mcpError}`);
    }

    const text = await P.chatStream(plat, messages, send.delta, {
      temperature: params.temperature ?? settings.ai.temperature,
      maxTokens: params.maxTokens || settings.ai.maxTokens,
      signal: controller.signal,
      timeoutMs,
      // 思维链单独走一条通道，绝不混进正文
      onReasoning: send.reasoning
    });
    return { text };
  }

  if (route === 'asr.transcribe') {
    // 真正的切片/解码在侧边栏（需要 WebAudio）；后台只提供下载与识别接口。
    throw new AppError(
      'noroute',
      '该流程由侧边栏本地执行',
      '语音转录的解码与切片在侧边栏完成，请使用 transcribe 界面。',
      '无需操作。'
    );
  }

  throw new AppError('noroute', '未知流式路由', String(route), '请更新扩展。');
}

// ---------------------------------------------------------------------------
// 窗口 / 标签页事件：分 P 变化、页面关闭
// ---------------------------------------------------------------------------

chrome.webNavigation?.onHistoryStateUpdated?.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (!isBilibili(details.url)) return;
  broadcast({ type: 'bsub:navigation', tabId: details.tabId, url: stripQuery(details.url) });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  broadcast({ type: 'bsub:tab-closed', tabId });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isBilibili(tab.url || '')) registerActiveTab(tabId);
  } catch (err) {
    /* ignore */
  }
});

function registerActiveTab(id) {
  broadcast({ type: 'bsub:active-tab', tabId: id });
}
