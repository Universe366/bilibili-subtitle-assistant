/* B站字幕助手 —— 内容脚本（隔离环境）
 *
 * 职责：
 *  1. 通过 DOM 通道向主环境桥索要页面数据（稳定性 #8）
 *  2. 单页应用导航检测：patch pushState/replaceState + popstate + 兜底轮询，
 *     用「视频 ID + 分 P」做签名（稳定性 #10）
 *  3. 播放器内嵌按钮（可开关、提示词可配）
 *  4. 页面内字幕覆盖层 / 跟随播放
 *  5. 版本握手（稳定性 #6）：声明自己的版本，响应 bsub:ping
 */
(function () {
  'use strict';

  const CONTENT_VERSION = '1.41.0';
  const PAGE_ID = '__bsub_page_channel__';
  const CONTENT_ID = '__bsub_content_channel__';
  const EVT = '__bsub_dom_event__';

  if (window.__BSUB_CONTENT_LOADED__ && window.__BSUB_CONTENT_VERSION__ === CONTENT_VERSION) {
    return;
  }
  window.__BSUB_CONTENT_LOADED__ = true;
  window.__BSUB_CONTENT_VERSION__ = CONTENT_VERSION;

  const state = {
    connected: true,
    options: {
      playerButton: true,
      playerButtonPrompt: '总结这个视频的要点',
      overlay: false,
      overlayFontScale: 1,
      overlayBottom: 8,
      followPlayback: true
    },
    signature: '',
    lastTime: -1,
    lastIndex: -1,
    overlayLines: [],
    bridgeReady: false
  };

  const log = (...a) => {
    if (window.__BSUB_DEBUG__) console.log('[字幕助手/内容]', ...a);
  };

  // ---------------------------------------------------------------------------
  // 与主环境桥的 DOM 通道
  // ---------------------------------------------------------------------------

  let contentEl = null;
  let outSeq = 0;
  const pending = new Map();

  function ensureChannel() {
    if (!document.documentElement) return false;
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
    return !!contentEl;
  }

  function onPageMessage(raw) {
    if (!raw) return;
    let msg = null;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      return;
    }
    if (!msg) return;
    if (msg.id === '__hello__') {
      state.bridgeReady = true;
      return;
    }
    const rec = pending.get(msg.id);
    if (!rec) return;
    pending.delete(msg.id);
    clearTimeout(rec.timer);
    if (msg.ok) rec.resolve(msg.data);
    else {
      const e = new Error((msg.error && msg.error.title) || '页面读取失败');
      e.payload = msg.error;
      rec.reject(e);
    }
  }

  function watchPageChannel() {
    let lastSeq = '-1';
    const check = () => {
      const el = document.getElementById(PAGE_ID);
      if (el) {
        const seq = el.getAttribute('data-seq') || '0';
        if (seq !== lastSeq) {
          lastSeq = seq;
          onPageMessage(el.textContent);
        }
      } else if (!state.bridgeReady) {
        injectPageBridgeFallback();
      }
    };
    setInterval(check, 90);
    document.addEventListener(EVT, () => check(), false);
  }

  // 主环境桥未能注入时（旧内核 / 注入时序），用 web_accessible_resources 兜底自注入
  let bridgeFallbackTried = false;
  function injectPageBridgeFallback() {
    if (bridgeFallbackTried) return;
    bridgeFallbackTried = true;
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('src/content/page-bridge.js');
      s.async = false;
      s.onload = () => {
        s.remove();
        state.bridgeReady = true;
        log('主环境桥已兜底注入');
      };
      (document.head || document.documentElement).appendChild(s);
    } catch (err) {
      log('兜底注入失败', err);
    }
  }

  let reqSeq = 0;
  function callPage(method, params = {}, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      if (!ensureChannel()) {
        reject(new Error('DOM 通道尚未就绪'));
        return;
      }
      reqSeq += 1;
      const id = `c${reqSeq}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`读取页面超时：${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      contentEl.textContent = JSON.stringify({ id, method, params });
      contentEl.setAttribute('data-seq', String(++outSeq));
      try {
        document.dispatchEvent(new CustomEvent(EVT, { detail: { side: 'content', seq: outSeq } }));
      } catch (err) {
        /* ignore */
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 单页应用导航检测（稳定性 #10）
  // ---------------------------------------------------------------------------

  function computeSignature(info) {
    if (!info) return '';
    const vid = info.bvid || info.aid || info.epId || location.pathname;
    return `${vid}@p${info.page || 1}@c${info.cid || '-'}`;
  }

  function patchHistory() {
    for (const name of ['pushState', 'replaceState']) {
      const orig = history[name];
      if (!orig || orig.__bsubPatched) continue;
      const wrapped = function (...args) {
        const ret = orig.apply(this, args);
        setTimeout(onUrlMaybeChanged, 0);
        return ret;
      };
      wrapped.__bsubPatched = true;
      try {
        history[name] = wrapped;
      } catch (err) {
        /* ignore */
      }
    }
    window.addEventListener('popstate', onUrlMaybeChanged, false);
    window.addEventListener('hashchange', onUrlMaybeChanged, false);
    // 兜底轮询
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        onUrlMaybeChanged();
      }
    }, 1000);
  }

  let navTimer = null;
  function onUrlMaybeChanged() {
    if (navTimer) clearTimeout(navTimer);
    navTimer = setTimeout(async () => {
      try {
        const info = await callPage('getInfo', {}, 6000);
        const sig = computeSignature(info);
        if (sig && sig !== state.signature) {
          state.signature = sig;
          state.overlayLines = [];
          sendEvent('navigate', { signature: sig, info });
          log('导航签名变化', sig);
        }
      } catch (err) {
        /* 页面尚未就绪，等下一次 */
      }
    }, 450);
  }

  // ---------------------------------------------------------------------------
  // 播放器内嵌按钮
  // ---------------------------------------------------------------------------

  const BTN_ID = '__bsub_player_btn__';

  // 「点不到侧边栏」的兜底提示条。
  // 侧边栏打不开时，至少让用户知道发生了什么以及该怎么办 ——
  // 之前是 `.catch(() => {})` 静默吞掉，表现就是「点了没反应」。
  let hintTimer = 0;
  function showPanelHint(text) {
    let el = document.getElementById('__bsub_hint__');
    if (!el) {
      el = document.createElement('div');
      el.id = '__bsub_hint__';
      el.className = 'bsub-hint';
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = text || '侧边栏未能自动打开，请点浏览器工具栏上的扩展图标。';
    el.classList.add('is-open');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => el.classList.remove('is-open'), 6000);
  }

  // 尝试直接打开侧边栏。
  //
  // 说明：`chrome.sidePanel` **只在扩展页面里可用**，内容脚本拿不到
  // （内容脚本只有 runtime / i18n 等少数 API）。所以这里实际做的是
  // 「确认不可用就返回 false」，让调用方走后台路径。
  // 保留这个探测是为了未来浏览器放开权限时能自动受益。
  function tryOpenSidePanelDirect() {
    try {
      if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
        return true; // 未来若放开，调用方会直接用
      }
    } catch (err) {
      /* ignore */
    }
    return false;
  }

  function removePlayerButton() {
    const el = document.getElementById(BTN_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function findButtonHost() {
    return (
      document.querySelector('.bpx-player-control-bottom-right') ||
      document.querySelector('.bpx-player-control-bottom-left') ||
      document.querySelector('.bpx-player-control-bottom') ||
      document.querySelector('.video-toolbar-right') ||
      document.querySelector('.bilibili-player-video-btn') ||
      null
    );
  }

  function ensurePlayerButton() {
    if (!state.options.playerButton) {
      removePlayerButton();
      return;
    }
    if (document.getElementById(BTN_ID)) return;
    const host = findButtonHost();
    if (!host) return;
    const btn = document.createElement('div');
    btn.id = BTN_ID;
    btn.className = 'bsub-player-btn';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.title = '字幕助手：打开侧边栏并执行操作';
    const label = document.createElement('span');
    label.className = 'bsub-player-btn-label';
    label.textContent = '字幕';
    btn.appendChild(label);
    const fire = (ev) => {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      sendEvent('player-button', { prompt: state.options.playerButtonPrompt });
      // 打开侧边栏失败时必须让用户看见 —— 否则就是「点了没反应」
      try {
        chrome.runtime.sendMessage({ type: 'bsub:open-side-panel' }, (res) => {
          const err = chrome.runtime.lastError;
          if (err) return; // 后台没起来，事件其实已经发出去，会由侧边栏接手
          // 打不开时重试一次：首次失败常常是侧边栏正在切换状态
          if (res && res.ok === false) {
            setTimeout(() => {
              try {
                chrome.runtime.sendMessage({ type: 'bsub:open-side-panel' }, (res2) => {
                  void chrome.runtime.lastError;
                  if (res2 && res2.ok === false) {
                    showPanelHint(res2.detail || '侧边栏未能自动打开，请点浏览器工具栏上的扩展图标。');
                  }
                });
              } catch (e2) {
                showPanelHint(res.detail || '');
              }
            }, 260);
          }
        });
      } catch (err) {
        /* 扩展已重载 */
      }
    };
    btn.addEventListener('click', fire, true);
    btn.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') fire(ev);
    });
    host.appendChild(btn);
  }

  // ---------------------------------------------------------------------------
  // 页面内字幕覆盖层
  // ---------------------------------------------------------------------------

  async function syncOverlay() {
    if (!state.options.overlay) {
      await callPage('setOverlay', { visible: false }, 4000).catch(() => {});
      return;
    }
    await callPage(
      'setOverlay',
      {
        visible: true,
        lines: state.overlayLines,
        style: { fontScale: state.options.overlayFontScale, bottom: state.options.overlayBottom }
      },
      4000
    ).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // 跟随播放：把当前时间 / 当前句上报给侧边栏
  // ---------------------------------------------------------------------------

  let followTimer = null;
  function startFollow() {
    if (followTimer) return;
    followTimer = setInterval(async () => {
      if (!state.options.followPlayback) return;
      if (!chrome.runtime || !chrome.runtime.id) return;
      try {
        const t = await callPage('getTime', {}, 2500);
        const cur = Math.round((t && t.currentTime) || 0);
        if (cur === state.lastTime) return;
        state.lastTime = cur;
        sendEvent('time', { currentTime: (t && t.currentTime) || 0, duration: (t && t.duration) || 0 });
      } catch (err) {
        /* ignore */
      }
    }, 1000);
  }

  function sendEvent(event, payload) {
    if (!chrome.runtime || !chrome.runtime.id) return;
    try {
      chrome.runtime.sendMessage({ type: 'bsub:content-event', event, payload }, () => {
        void chrome.runtime.lastError;
      });
    } catch (err) {
      /* 扩展已重载 */
    }
  }

  // ---------------------------------------------------------------------------
  // 后台/侧边栏 RPC
  // ---------------------------------------------------------------------------

  // 这些方法只是「转发给主环境桥」，没有自己的逻辑。
  // 注意：这是一个显式白名单 —— 桥新增了方法就必须在这里同步登记，
  // 否则后台会收到「内容脚本不支持该方法」，而桥其实完全支持。
  const PASSTHROUGH = {
    // 音轨相关
    getAudioCandidates: 40000,
    refreshAudio: 30000,
    fetchAudioRange: 180000,
    // 字幕相关
    getSubtitleBundle: 45000,
    triggerSubtitleMenu: 30000,
    // 覆盖层
    setOverlay: 6000,
    // 其它页面能力
    getInitAudio: 8000,
    sniffStatus: 6000,
    audioSniffStatus: 6000,
    ping: 6000
  };

  async function handle(method, params) {
    if (Object.prototype.hasOwnProperty.call(PASSTHROUGH, method)) {
      // 带诊断的方法直接把桥的返回原样透传（含 diag / supported 等附加字段）
      return callPage(method, params || {}, PASSTHROUGH[method]);
    }
    switch (method) {
      case 'getInfo':
        return callPage('getInfo', {}, 8000);
      case 'getSubtitles':
        return callPage('getSubtitles', {}, 8000);
      case 'getAudio':
        return callPage('getAudio', {}, 8000);
      case 'getTime':
        return callPage('getTime', {}, 6000);
      case 'seek': {
        const r = await callPage('seek', { time: params.time }, 6000);
        return r;
      }
      case 'applyOptions': {
        state.options = { ...state.options, ...(params || {}) };
        ensurePlayerButton();
        await syncOverlay();
        return { ok: true, options: state.options };
      }
      case 'setOverlayLines': {
        state.overlayLines = Array.isArray(params.lines) ? params.lines : [];
        await syncOverlay();
        return { ok: true, count: state.overlayLines.length };
      }
      case 'clearOverlay': {
        state.overlayLines = [];
        await syncOverlay();
        return { ok: true };
      }
      case 'getOptions':
        return { ok: true, options: state.options };
      default: {
        const err = { title: '内容脚本不支持该方法', detail: String(method) };
        throw Object.assign(new Error(err.title), { payload: err });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 多版本去重（稳定性 #6）
  //
  // 扩展更新后，旧的内容脚本仍然留在页面里。chrome.scripting.executeScript 会把
  // 新的 content.js 再注入一份，于是页面里出现两份脚本、两个 onMessage 监听器。
  // chrome.tabs.sendMessage 只会把「第一个」响应者的结果回来 —— 如果那是旧脚本，
  // 后台就会一直读到旧版本，于是反复注入、永远修不好（表现为「内容脚本不支持该方法」）。
  //
  // 所以：新脚本注入时声明自己的版本，旧脚本发现自己比新脚本旧就**停止响应**，
  // 让新脚本接管。这样后台的版本握手才能正常收敛。
  // ---------------------------------------------------------------------------
  const ISOLATED_VERSION_KEY = '__bsub_isolated_version__';
  const EXPECTED_VERSION_KEY = '__bsub_expected_version__';

  // 后台在重新注入前会先写入「期望版本」。旧脚本读到它之后主动退休，
  // 否则页面里新旧两份脚本会一直同时抢答，后台 ping 到的永远是旧版本。
  function shouldRetire() {
    let expected = null;
    try {
      expected = window[EXPECTED_VERSION_KEY];
    } catch (err) {
      expected = null;
    }
    if (expected && String(expected) !== String(CONTENT_VERSION) && isOlder(CONTENT_VERSION, expected)) {
      return true;
    }
    return false;
  }

  function claimIsolatedVersion() {
    if (shouldRetire()) {
      state.retired = true;
      try {
        delete window[ISOLATED_VERSION_KEY];
      } catch (err) {
        /* ignore */
      }
      return false;
    }
    try {
      window[ISOLATED_VERSION_KEY] = CONTENT_VERSION;
    } catch (err) {
      /* ignore */
    }
    state.retired = false;
    return true;
  }

  // 简单的语义化版本比较：a 比 b 旧则返回 true
  function isOlder(a, b) {
    const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x !== y) return x < y;
    }
    return false;
  }

  function listenRuntime() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== 'object') return undefined;
      // 已退休的旧脚本不再应答，避免把旧版本号/旧能力报回后台
      if (state.retired) return undefined;
      if (message.type === 'bsub:ping') {
        // 每收到一次 ping 都重新检查一次：后台可能刚刚写入新的「期望版本」
        if (shouldRetire()) {
          state.retired = true;
          return undefined;
        }
        sendResponse({ ok: true, version: CONTENT_VERSION, href: location.href });
        return undefined;
      }
      if (message.type === 'bsub:to-content') {
        handle(message.method, message.params)
          .then((data) => sendResponse({ ok: true, data }))
          .catch((err) =>
            sendResponse({ ok: false, error: err.payload || { title: '失败', detail: String(err && err.message) } })
          );
        return true;
      }
      return undefined;
    });
  }

  // ---------------------------------------------------------------------------
  // 启动
  // ---------------------------------------------------------------------------

  async function init() {
    if (!claimIsolatedVersion()) {
      log('检测到更新版本的脚本已接管，本实例退出');
      return;
    }
    ensureChannel();
    watchPageChannel();
    patchHistory();
    listenRuntime();
    startFollow();

    try {
      const info = await callPage('getInfo', {}, 8000);
      state.signature = computeSignature(info);
      log('已连接页面', state.signature);
    } catch (err) {
      log('首次读取页面信息失败（稍后由导航检测重试）', err && err.message);
    }

    // 周期性确保播放器按钮存在（播放器会被动态重建）
    setInterval(ensurePlayerButton, 1500);

    // 拉取界面选项
    try {
      const res = await chrome.runtime.sendMessage({ kind: 'rpc', id: 'opt0', method: 'page.options', params: {} });
      if (res && res.ok && res.data && res.data.pushed >= 0) {
        /* 选项经由 applyOptions 推回本脚本 */
      }
    } catch (err) {
      /* ignore */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
