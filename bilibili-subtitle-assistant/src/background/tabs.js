// 标签页候选收集 + 内容脚本注入 + 版本握手（稳定性 #6、#7、#9）。
// 不解析单一目标标签页；收集多个候选逐个尝试，任一失效自动降级。

import { CHANNEL, CONTENT_VERSION, VIDEO_PAGE_TYPES } from '../shared/constants.js';
import { AppError } from './errors.js';

const BILI_RE = /^https?:\/\/([^/]*\.)?bilibili\.com(\/|$)/i;

export function isBilibili(url) {
  return BILI_RE.test(String(url || ''));
}

// 支持的页面类型必须与声明一致：普通视频页、列表页、番剧播放页、合集播放页。
// 协议 / 主机（含 www 与否）/ 端口都不写死。
export function pageTypeOf(url) {
  let u;
  try {
    u = new URL(url);
  } catch (err) {
    return null;
  }
  const p = u.pathname;
  if (/^\/video\/BV[0-9A-Za-z]+/i.test(p) || /^\/video\/av\d+/i.test(p) || /^\/video\/BV/i.test(p)) {
    return 'video';
  }
  if (/^\/bangumi\/play\//i.test(p)) return 'bangumi';
  if (/^\/list\//i.test(p) || /^\/medialist\//i.test(p)) return 'list';
  if (/^\/festival\//i.test(p) || /^\/blackboard\//i.test(p)) return 'list';
  if (/^\/cheese\/play\//i.test(p)) return 'bangumi';
  if (/^\/space\//i.test(p)) return 'list';
  return null;
}

export function pageTypeLabel(t) {
  return VIDEO_PAGE_TYPES[t] || '未知页面';
}

export function isVideoLikePage(url) {
  return isBilibili(url) && pageTypeOf(url) !== null;
}

// 收集候选标签页：调用方指定 → 消息来源 → 已登记的 → 当前活动的 B 站视频页 → 所有打开的 B 站视频页
export async function collectCandidateTabs(opts = {}) {
  const out = [];
  const seen = new Set();
  const push = (tab) => {
    if (!tab || tab.id == null) return;
    if (seen.has(tab.id)) return;
    if (!isBilibili(tab.url || '')) return;
    seen.add(tab.id);
    out.push(tab);
  };

  // 1. 调用方指定
  if (opts.tabId != null) {
    try {
      const t = await chrome.tabs.get(opts.tabId);
      push(t);
    } catch (err) {
      /* 已关闭 */
    }
  }

  // 2. 消息来源
  if (opts.senderTabId != null && opts.senderTabId !== opts.tabId) {
    try {
      const t = await chrome.tabs.get(opts.senderTabId);
      push(t);
    } catch (err) {
      /* ignore */
    }
  }

  // 3. 已登记的（后台记忆最近一次成功过的 B 站标签页）
  for (const id of registeredTabs) {
    if (seen.has(id)) continue;
    try {
      const t = await chrome.tabs.get(id);
      push(t);
    } catch (err) {
      registeredTabs.delete(id);
    }
  }

  // 4 & 5. 当前活动页 + 所有打开的 B 站页面
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (err) {
    tabs = [];
  }
  const activeIds = new Set(tabs.filter((t) => t.active).map((t) => t.id));
  // 先放「当前活动的 B 站视频页」，再放其它已打开的 B 站页面
  for (const t of tabs) {
    if (activeIds.has(t.id)) push(t);
  }
  for (const t of tabs) push(t);
  // 视频播放页优先于列表页
  const rank = (t) => (pageTypeOf(t.url) === 'video' || pageTypeOf(t.url) === 'bangumi' ? 0 : 1);
  out.sort((a, b) => rank(a) - rank(b));
  return out;
}

const registeredTabs = new Set();

export function registerTab(id) {
  if (id != null) registeredTabs.add(id);
}

// ---------------------------------------------------------------------------
// 注入与握手
// ---------------------------------------------------------------------------

export function contentFiles() {
  return {
    js: ['src/content/page-bridge.js', 'src/content/content.js'],
    css: ['src/content/content.css']
  };
}

export async function injectContentScripts(tabId) {
  const files = contentFiles();
  // 0) 先写入「期望版本」，让页面里可能残留的旧版 content.js 主动退休。
  //    不这么做的话，新旧两份脚本会同时应答，ping 到的永远是先注册的旧版本，
  //    版本握手永远收敛不了（表现为「内容脚本不支持该方法 xxx」）。
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (version) => {
        try {
          window.__bsub_expected_version__ = version;
        } catch (err) {
          /* ignore */
        }
      },
      args: [CONTENT_VERSION],
      injectImmediately: true
    });
  } catch (err) {
    /* 不支持 func 注入时忽略，下面的注入流程照常进行 */
  }
  // 主环境桥：优先用 world 参数；不支持时退化为脚本自注入 fallback（content.js 会处理）
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/page-bridge.js'],
      world: 'MAIN',
      injectImmediately: true
    });
  } catch (err) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/page-bridge.js'],
        injectImmediately: true
      });
    } catch (err2) {
      /* page-bridge 未能注入主环境：content.js 里的自注入逻辑会再试 */
    }
  }
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['src/content/content.css'] });
  } catch (err) {
    /* ignore */
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['src/content/content.js'],
    injectImmediately: true
  });
}

async function pingTab(tabId, timeoutMs = 1500) {
  try {
    const res = await withTimeout(chrome.tabs.sendMessage(tabId, { type: 'bsub:ping' }), timeoutMs);
    if (res && res.ok) return res;
    return null;
  } catch (err) {
    return null;
  }
}

export function withTimeout(promise, ms, message = '操作超时') {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new AppError('timeout', '操作超时', `${message}（${ms}ms）`, '请刷新该 B 站页面后重试。'));
    }, ms);
    promise.then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

// 确保标签页里有「当前版本」的内容脚本；版本不一致则重新注入（稳定性 #6）。
export async function ensureContentScript(tabId, opts = {}) {
  let ping = await pingTab(tabId, opts.pingTimeoutMs || 1200);
  if (ping && ping.version === CONTENT_VERSION) {
    registerTab(tabId);
    return { injected: false, version: ping.version };
  }
  const staleVersion = ping ? ping.version : null;
  await injectContentScripts(tabId);
  await new Promise((r) => setTimeout(r, 120));
  ping = await pingTab(tabId, 2000);
  if (!ping) {
    throw new AppError(
      'inject',
      '内容脚本无法在该页面运行',
      '注入后没有响应。可能是页面尚未加载完、被其它扩展拦截，或页面被浏览器内置页替换。',
      '请刷新这个 B 站页面；若仍失败，确认扩展有该站点的访问权限。'
    );
  }
  if (ping.version !== CONTENT_VERSION) {
    throw new AppError(
      'version',
      '页面里的脚本版本与扩展不一致',
      `页面脚本 ${ping.version || '未知'}，扩展 ${CONTENT_VERSION}。`,
      '请刷新该 B 站页面（F5）后再试；扩展更新后旧页面必须刷新才会生效。'
    );
  }
  registerTab(tabId);
  return { injected: true, version: ping.version, staleVersion, reloadHint: staleVersion !== null };
}

// 向第一个可用的候选标签页发送请求，逐个降级尝试（稳定性 #7）
export async function callOnBestTab(method, params = {}, opts = {}) {
  const candidates = await collectCandidateTabs(opts);
  if (!candidates.length) {
    throw new AppError(
      'notab',
      '没有找到 B 站视频页面',
      '当前没有打开任何 B 站标签页。',
      '请打开一个 B 站视频页面，然后重新点击侧边栏里的按钮。'
    );
  }
  const errors = [];
  const tried = [];
  for (const tab of candidates) {
    const type = pageTypeOf(tab.url);
    if (!type) continue;
    tried.push({ tabId: tab.id, url: tab.url, type });
    try {
      await ensureContentScript(tab.id, opts);
      const res = await withTimeout(
        chrome.tabs.sendMessage(tab.id, { type: CHANNEL.TO_CONTENT, method, params }),
        opts.timeoutMs || 15000,
        `${method} 无响应`
      );
      if (res && res.ok) {
        registerTab(tab.id);
        return { data: res.data, tabId: tab.id, url: tab.url, pageType: type };
      }
      errors.push({ tabId: tab.id, url: tab.url, error: (res && res.error) || { title: '未知错误' } });
    } catch (err) {
      errors.push({ tabId: tab.id, url: tab.url, error: err?.toJSON ? err.toJSON() : { title: String(err && err.message) } });
    }
  }
  if (!tried.length) {
    throw new AppError(
      'nopage',
      '当前标签页不是支持的 B 站页面',
      `支持：普通视频页、番剧播放页、合集播放页、列表页。`,
      '请切换到 B 站视频播放页后重试。'
    );
  }
  const last = errors[errors.length - 1];
  const err = new AppError(
    'alltabs',
    '所有候选页面都没有成功',
    `共尝试 ${tried.length} 个页面。最后一个错误：${last ? last.error.title || '' : ''} ${last ? last.error.detail || '' : ''}`,
    '请刷新 B 站页面后重试；若持续失败，可在设置 → 诊断 中复制详细信息。'
  );
  err.extra = { errors, tried };
  throw err;
}

// 广播给所有侧边栏 / 内容脚本
export async function broadcast(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (err) {
    /* 没有监听者 */
  }
}
