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

  const CONTENT_VERSION = '2.14.6';
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
      followPlayback: true,
      // 由后台 applyOptions 推送；不要在拿到设置前自动注入
      embedPanel: false
    },
    signature: '',
    lastTime: -1,
    lastIndex: -1,
    overlayLines: [],
    bridgeReady: false,
    embedClosed: false,
    embedFrame: null,
    embedCollapsed: false,
    // B 站首屏/切页时还在做 DOM 初始化，过早插入会打断它自己的渲染
    embedMountAfter: Date.now() + 2200
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
    // 事件驱动是主路径（document 上的 EVT）；这里只是**兜底**。
    // 以前是 90ms（约 11 次/秒）的 DOM 查询，对每个 B 站页面都是无谓开销。
    setInterval(check, 250);
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
      ensureEmbedPanel();
      try {
        const info = await callPage('getInfo', {}, 6000);
        const sig = computeSignature(info);
        if (sig && sig !== state.signature) {
          state.signature = sig;
          state.overlayLines = [];
          // 切页后 B 站会重建右侧栏，等它渲染完再挂，避免打断评论区
          state.embedMountAfter = Date.now() + 1800;
          state.embedCollapsed = false;
          removeEmbedPanel();
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

  // 打开浏览器原生侧边栏；失败时重试一次并提示。
  function requestSidePanel() {
    try {
      chrome.runtime.sendMessage({ type: 'bsub:open-side-panel' }, (res) => {
        const err = chrome.runtime.lastError;
        if (err) return;
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
  }

  // 尝试直接打开侧边栏。
  //
  // 说明：`chrome.sidePanel` **只在扩展页面里可用**，内容脚本拿不到
  // （内容脚本只有 runtime / i18n 等少数 API）。所以打开侧边栏只能由后台做
  // （见下面按钮的 `bsub:open-side-panel` 消息）。

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
      sendEvent('player-button', { prompt: state.options.playerButtonPrompt, embedded: canEmbed() });
      // 开启页面内嵌时，播放器按钮直接展开面板；找不到 B 站右侧栏再退回侧边栏
      if (canEmbed()) {
        state.embedClosed = false;
        state.embedCollapsed = false;
        ensureEmbedPanel(true).then((ok) => {
          if (!ok) requestSidePanel();
        });
        return;
      }
      requestSidePanel();
    };
    btn.addEventListener('click', fire, true);
    btn.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') fire(ev);
    });
    host.appendChild(btn);
  }

  // ---------------------------------------------------------------------------
  // 页面内嵌面板（不点扩展图标也能用；浏览器侧边栏仍保留）
  // ---------------------------------------------------------------------------

  const EMBED_ID = '__bsub_embed_panel__';
  const EMBED_TAB_ID = '__bsub_embed_tab__';

  // Shadow DOM 的样式：B 站脚本只会看到 host，不会遍历到我们的按钮/iframe。
  const EMBED_SHADOW_CSS = `
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      background: #fff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
      font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    .bsub-embed-bar {
      flex: 0 0 auto;
      height: 34px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px;
      background: #fff;
      color: #18191c;
      border-bottom: 1px solid #e3e5e7;
      font-size: 12px;
      box-sizing: border-box;
    }
    .bsub-embed-title {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }
    .bsub-embed-btn {
      flex: 0 0 auto;
      appearance: none;
      border: 1px solid #e3e5e7;
      background: #f6f7f8;
      color: #18191c;
      border-radius: 5px;
      font-size: 12px;
      line-height: 1;
      padding: 4px 7px;
      cursor: pointer;
    }
    .bsub-embed-btn:hover { background: #eef0f2; }
    :host([data-collapsed='true']) { height: 34px !important; }
    :host([data-collapsed='true']) .bsub-embed-frame { display: none; }
    .bsub-embed-frame {
      flex: 1 1 auto;
      width: 100%;
      min-height: 0;
      border: 0;
      background: #fff;
      pointer-events: auto !important;
    }
  `;

  function isVideoPage() {
    return /^\/(video|bangumi\/play|list)\//.test(location.pathname);
  }

  function canEmbed() {
    return state.options.embedPanel !== false && isVideoPage();
  }

  function removeEmbedPanel() {
    const el = document.getElementById(EMBED_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // 按 Bilitato 的做法：挂进 B 站自己的右侧栏，而不是覆盖页面。
  function findEmbedHost() {
    return (
      document.querySelector('.right-container-inner.scroll-sticky') ||
      document.querySelector('.right-container-inner') ||
      document.querySelector('.right-container')
    );
  }

  function embedHeight() {
    const area =
      document.querySelector('.bpx-player-video-area') ||
      document.querySelector('.video-container-v1') ||
      document.querySelector('#bilibili-player');
    const sending = document.querySelector('.bpx-player-sending-bar') || document.querySelector('.player-sending-bar');
    const toolbar = document.querySelector('.video-toolbar-container') || document.querySelector('#arc_toolbar_report');
    let total = 0;
    if (area) total += area.getBoundingClientRect().height || 0;
    if (sending) total += sending.getBoundingClientRect().height || 0;
    if (toolbar) total += toolbar.getBoundingClientRect().height || 0;
    if (!total || total < 300) total = 560;
    return Math.round(Math.min(total, 760));
  }

  function syncEmbedHeight() {
    const el = document.getElementById(EMBED_ID);
    if (!el) return;
    const next = state.embedCollapsed ? 34 : embedHeight();
    const current = Number.parseFloat(el.style.height) || 0;
    // 定时器每 1.5s 都会走到这里；高度没变就不要重复写 style，避免无谓重绘
    if (Math.abs(current - next) <= 1) return;
    el.style.height = `${next}px`;
  }

  // 折叠只保留标题栏；再点一次展开。和「× 关闭」不同，面板不会被移除。
  function applyEmbedCollapsed() {
    const el = document.getElementById(EMBED_ID);
    if (!el) return;
    const collapsed = !!state.embedCollapsed;
    const desired = collapsed ? 'true' : 'false';
    if (el.dataset.collapsed !== desired) {
      el.dataset.collapsed = desired;
      const btn = el.shadowRoot && el.shadowRoot.querySelector('.bsub-embed-collapse');
      if (btn) {
        btn.textContent = collapsed ? '＋' : '−';
        btn.title = collapsed ? '展开面板' : '折叠面板';
        btn.setAttribute('aria-expanded', String(!collapsed));
      }
    }
    if (collapsed) {
      if (el.style.height !== '34px') el.style.height = '34px';
    } else {
      syncEmbedHeight();
    }
  }

  function setEmbedCollapsed(value) {
    state.embedCollapsed = !!value;
    applyEmbedCollapsed();
  }

  function removeEmbedTab() {
    const el = document.getElementById(EMBED_TAB_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function getEmbedTabId() {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      setTimeout(() => done(null), 500);
      try {
        chrome.runtime.sendMessage({ type: 'bsub:get-tab-id' }, (res) => {
          void chrome.runtime.lastError;
          const id = res && res.ok && res.tabId != null ? Number(res.tabId) : null;
          done(Number.isFinite(id) && id > 0 ? id : null);
        });
      } catch (err) {
        done(null);
      }
    });
  }

  function updateSidePanelButton(open) {
    const host = document.getElementById(EMBED_ID);
    const btn = host && host.shadowRoot && host.shadowRoot.querySelector('.bsub-embed-side');
    if (btn) btn.title = open ? '关闭浏览器侧边栏' : '打开浏览器侧边栏';
  }

  function syncSidePanelButton() {
    try {
      chrome.runtime.sendMessage({ type: 'bsub:sidepanel-state' }, (res) => {
        void chrome.runtime.lastError;
        if (res && res.ok) updateSidePanelButton(!!res.open);
      });
    } catch (err) {
      /* ignore */
    }
  }

  function openSidePanelFromEmbed() {
    try {
      chrome.runtime.sendMessage({ type: 'bsub:open-side-panel' }, (res) => {
        const err = chrome.runtime.lastError;
        if (err) return;
        if (res && res.ok) {
          updateSidePanelButton(!!res.open);
        } else {
          showPanelHint((res && res.detail) || '侧边栏未能切换，请点浏览器工具栏上的扩展图标。');
        }
      });
    } catch (err) {
      showPanelHint('侧边栏未能切换，请点浏览器工具栏上的扩展图标。');
    }
  }

  function ensureEmbedTab() {
    if (!canEmbed()) {
      removeEmbedTab();
      return;
    }
    if (document.getElementById(EMBED_TAB_ID)) return;
    const tab = document.createElement('button');
    tab.id = EMBED_TAB_ID;
    tab.type = 'button';
    tab.className = 'bsub-embed-tab';
    tab.textContent = '字幕';
    tab.title = '打开 B站字幕助手';
    tab.addEventListener('click', () => {
      state.embedClosed = false;
      state.embedCollapsed = false;
      removeEmbedTab();
      ensureEmbedPanel(true);
    });
    (document.body || document.documentElement).appendChild(tab);
  }

  async function ensureEmbedPanel(force) {
    if (!canEmbed()) {
      removeEmbedPanel();
      removeEmbedTab();
      return false;
    }
    if (state.embedClosed && !force) {
      removeEmbedPanel();
      ensureEmbedTab();
      return false;
    }
    // 等 B 站首屏渲染稳定后再插入；否则它的 vdom 会抛错并卸载评论区
    if (!force && Date.now() < state.embedMountAfter) return false;
    removeEmbedTab();

    const host = findEmbedHost();
    if (!host) {
      // B 站右侧栏还没渲染出来，等下一轮 interval 再试；不要退化成覆盖层
      return false;
    }

    let wrap = document.getElementById(EMBED_ID);
    if (wrap && wrap.isConnected && host.contains(wrap)) {
      applyEmbedCollapsed();
      syncEmbedHeight();
      return true;
    }
    // 右侧栏被 B 站重建时，复用已有 host/iframe 并移动过去；
    // 直接 remove 再新建会让 iframe 重新加载，看起来就是一闪一闪。
    if (wrap && wrap.shadowRoot) {
      const up = host.querySelector('.up-panel-container');
      if (up && up.parentNode === host) up.after(wrap);
      else host.prepend(wrap);
      state.embedFrame = wrap.shadowRoot.querySelector('iframe') || state.embedFrame;
      applyEmbedCollapsed();
      syncEmbedHeight();
      return true;
    }
    if (wrap) wrap.remove();

    // 把当前 tabId 传给内嵌面板：它后续所有 page.* 请求都显式指定这个标签页，
    // 不再依赖「当前活动标签页」——侧边栏能读、内嵌不能读的根因就在这里。
    const tabId = await getEmbedTabId();
    if (!canEmbed()) return false;

    wrap = document.createElement('div');
    wrap.id = EMBED_ID;
    wrap.className = 'bsub-embed';

    // 关键：面板内部全部放进 Shadow DOM。
    // B 站右侧栏脚本会遍历 light DOM 子节点并调用 setAttribute；
    // 之前把按钮/iframe 直接挂进去会让它抛 HierarchyRequestError，
    // 连带把评论区组件卸载。Shadow DOM 对页面只暴露一个空 host div。
    const root = wrap.attachShadow({ mode: 'open' });
    const styleEl = document.createElement('style');
    styleEl.textContent = EMBED_SHADOW_CSS;
    root.appendChild(styleEl);

    const bar = document.createElement('div');
    bar.className = 'bsub-embed-bar';
    const title = document.createElement('span');
    title.className = 'bsub-embed-title';
    title.textContent = 'B站字幕助手';
    const pop = document.createElement('button');
    pop.type = 'button';
    pop.className = 'bsub-embed-btn bsub-embed-side';
    pop.textContent = '侧栏';
    pop.title = '打开浏览器侧边栏';
    pop.addEventListener('click', openSidePanelFromEmbed);
    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'bsub-embed-btn bsub-embed-collapse';
    collapse.textContent = '−';
    collapse.title = '折叠面板';
    collapse.setAttribute('aria-expanded', 'true');
    collapse.addEventListener('click', () => setEmbedCollapsed(!state.embedCollapsed));
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'bsub-embed-btn bsub-embed-close';
    close.textContent = '×';
    close.title = '关闭页面内嵌面板（右侧「字幕」可重新打开）';
    close.addEventListener('click', () => {
      state.embedClosed = true;
      state.embedCollapsed = false;
      removeEmbedPanel();
      ensureEmbedTab();
    });
    bar.appendChild(title);
    bar.appendChild(collapse);
    bar.appendChild(pop);
    bar.appendChild(close);

    const frame = document.createElement('iframe');
    frame.className = 'bsub-embed-frame';
    frame.title = 'B站字幕助手';
    frame.setAttribute('allow', 'clipboard-read; clipboard-write');
    frame.src = `${chrome.runtime.getURL('src/sidepanel/panel.html')}?embed=1${tabId ? `&tabId=${tabId}` : ''}`;
    frame.addEventListener('error', () => showPanelHint('页面内嵌面板加载失败，请点工具栏图标用浏览器侧边栏。'));

    root.appendChild(bar);
    root.appendChild(frame);
    state.embedFrame = frame;

    // 插到右侧栏的 UP 主卡片之后、推荐列表之前；没有就放最前面
    const upPanel = host.querySelector('.up-panel-container');
    if (upPanel && upPanel.parentNode === host) upPanel.after(wrap);
    else host.prepend(wrap);

    syncEmbedHeight();
    applyEmbedCollapsed();
    syncSidePanelButton();
    return true;
  }

  // 内嵌面板与父页面的直连 RPC。
  // 面板就在 B 站页面里，没必要再绕后台「选标签页 + 注入内容脚本」；
  // 那条路一旦选错 tab 或页面未就绪，就会报「内容脚本无法运行」。
  const EMBED_RPC_MAP = {
    'page.info': 'getInfo',
    'page.subtitles': 'getSubtitles',
    'page.time': 'getTime',
    'page.audio': 'getAudio',
    'page.seek': 'seek'
  };

  function installEmbedRpc() {
    window.addEventListener('message', (ev) => {
      const data = ev && ev.data;
      if (!data || data.type !== 'bsub:embed-rpc') return;
      const frame = state.embedFrame;
      if (!frame || ev.source !== frame.contentWindow) return;
      if (!/^chrome-extension:\/\//.test(String(ev.origin || ''))) return;

      let method = data.method;
      let params = data.params || {};
      if (method === 'page.call') {
        method = params.name;
        params = params.params || {};
      } else if (EMBED_RPC_MAP[method]) {
        method = EMBED_RPC_MAP[method];
      } else {
        try {
          ev.source.postMessage(
            {
              type: 'bsub:embed-rpc-result',
              id: data.id,
              ok: false,
              error: { title: '不支持的页面方法', detail: String(data.method) }
            },
            '*'
          );
        } catch (err) {
          /* ignore */
        }
        return;
      }

      handle(method, params)
        .then((out) => {
          try {
            ev.source.postMessage({ type: 'bsub:embed-rpc-result', id: data.id, ok: true, data: out }, '*');
          } catch (err) {
            /* ignore */
          }
        })
        .catch((err) => {
          try {
            ev.source.postMessage(
              {
                type: 'bsub:embed-rpc-result',
                id: data.id,
                ok: false,
                error: err.payload || { title: '页面读取失败', detail: String((err && err.message) || err) }
              },
              '*'
            );
          } catch (e2) {
            /* ignore */
          }
        });
    });
  }

  // ---------------------------------------------------------------------------
  // 页面内字幕覆盖层
  // ---------------------------------------------------------------------------

  async function syncOverlay() {
    if (!state.options.overlay) {
      await callPage('setOverlay', { visible: false }, 4000).catch(() => {});
      // 页面桥刚重连时消息可能丢一次；稍后补发一条，确保关闭可靠
      setTimeout(() => {
        if (!state.options.overlay) {
          callPage('setOverlay', { visible: false }, 4000).catch(() => {});
        }
      }, 300);
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
      // 页面在后台时没人看，不必每秒唤醒 service worker（MV3 下这是实打实的开销）
      if (document.hidden) return;
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
    // 身份诊断：把「页面当前认为是哪个视频」报给面板，
    // 用于排查「标题对、内容错」
    identity: 6000,
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
        const hadEmbed = state.options.embedPanel !== false;
        state.options = { ...state.options, ...(params || {}) };
        // 用户重新打开开关时，允许面板重新出现；否则保持用户手动收起的状态
        if (!hadEmbed && state.options.embedPanel !== false) {
          state.embedClosed = false;
          state.embedCollapsed = false;
        }
        ensurePlayerButton();
        await syncOverlay();
        ensureEmbedPanel();
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
      if (message.type === 'bsub:ping' || message.type === 'bsub:ping2') {
        // 每收到一次 ping 都重新检查一次：后台可能刚刚写入新的「期望版本」
        if (shouldRetire()) {
          state.retired = true;
          return undefined;
        }
        sendResponse({
          ok: true,
          version: CONTENT_VERSION,
          // ping2 是新版专用握手：旧脚本不认识它，不会抢答
          protocol: message.type === 'bsub:ping2' ? 2 : 1,
          href: location.href
        });
        return undefined;
      }
      if (message.type === 'bsub:embed-command') {
        (async () => {
          const action = message.action || 'toggle';
          if (action === 'state') {
            sendResponse({
              ok: true,
              open: !!document.getElementById(EMBED_ID) && !state.embedClosed,
              collapsed: !!state.embedCollapsed
            });
            return;
          }
          if (action === 'toggle-close') {
            // 侧边栏按钮：已打开就直接关闭，不再打开
            if (document.getElementById(EMBED_ID) && !state.embedClosed) {
              state.embedClosed = true;
              state.embedCollapsed = false;
              removeEmbedPanel();
              ensureEmbedTab();
              sendResponse({ ok: true, closed: true, collapsed: false });
              return;
            }
            state.embedClosed = false;
            state.embedCollapsed = false;
          } else if (action === 'open') {
            state.embedClosed = false;
            state.embedCollapsed = false;
          } else if (action === 'collapse') {
            state.embedCollapsed = true;
          } else if (action === 'expand') {
            state.embedCollapsed = false;
          } else if (!document.getElementById(EMBED_ID) || state.embedClosed) {
            state.embedClosed = false;
            state.embedCollapsed = false;
          } else {
            state.embedCollapsed = !state.embedCollapsed;
          }
          const ok = await ensureEmbedPanel(true);
          if (ok) applyEmbedCollapsed();
          else showPanelHint('当前页面没有可用的右侧栏，无法打开页面内面板。');
          sendResponse({ ok, collapsed: state.embedCollapsed, closed: false });
        })();
        return true;
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
    ensureChannel();
    watchPageChannel();
    patchHistory();
    startFollow();
    // 主动要一次页面选项：页面内嵌面板默认开启，不能等侧边栏打开才推送
    try {
      chrome.runtime.sendMessage({ type: 'bsub:request-options' }, () => {
        void chrome.runtime.lastError;
      });
    } catch (err) {
      /* 扩展已重载 */
    }

    try {
      const info = await callPage('getInfo', {}, 8000);
      state.signature = computeSignature(info);
      log('已连接页面', state.signature);
    } catch (err) {
      log('首次读取页面信息失败（稍后由导航检测重试）', err && err.message);
    }

    ensureEmbedPanel();

    // 周期性确保播放器按钮存在（播放器会被动态重建）。
    // 面板已挂载时不要每 1.5s 重新走一遍挂载/写样式，只做轻量检查。
    setInterval(() => {
      ensurePlayerButton();
      const host = findEmbedHost();
      const panel = document.getElementById(EMBED_ID);
      if (!panel || !panel.isConnected || !host || !host.contains(panel)) {
        ensureEmbedPanel();
      } else {
        syncEmbedHeight();
      }
    }, 1500);

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => syncEmbedHeight(), 150);
    });
  }

  // 监听必须**在注入时立刻注册**，不能等 DOMContentLoaded。
  // 否则内嵌面板在 B 站页面还没加载完时请求 page.info，后台会误判
  // 「注入后没有响应」；侧边栏通常是页面加载完后手动打开的，所以不复现。
  if (!claimIsolatedVersion()) {
    log('检测到更新版本的脚本已接管，本实例退出');
  } else {
    listenRuntime();
    installEmbedRpc();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  }
})();
