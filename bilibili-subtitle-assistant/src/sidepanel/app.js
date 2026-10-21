// 侧边栏入口：装配各面板、处理跨上下文事件、主题/布局/快捷键/向导。

import { call, errorPayload } from './modules/bridge.js';
import { store, loadSettings, loadBuildInfo } from './modules/store.js';
import { app, usePanel, renderPanels, applyTheme, loadVideo, harvest, transcribe, exportSubtitles, copyAllSubtitles, doProviderSearch, pushPageOptions, saveHistory } from './modules/context.js';
import * as jobs from './modules/jobs.js';
import { h, clear, button, toast, setBoolAttr, fmtBytes } from './modules/dom.js';
import { openOverlay, closeOverlays, canDismissOverlay } from './modules/ui.js';
import * as subtitlesPanel from './modules/panel-subtitles.js';
import * as aiPanel from './modules/panel-ai.js';
import * as settingsPanel from './modules/panel-settings.js';
import * as actionsPanel from './modules/panel-actions.js';
import { DEFAULT_SYSTEM_PROMPT } from '../shared/constants.js';
import { initWizard } from './modules/wizard.js';

// 页面内嵌时 (?embed=1) 由内容脚本的外框显示标题与收起按钮，
// 面板自己的品牌行可以隐藏，避免出现两遍标题。
let IS_EMBED = false;
try {
  IS_EMBED = new URLSearchParams(location.search).get('embed') === '1';
  if (IS_EMBED) document.body.dataset.embed = 'true';
} catch (err) {
  /* ignore */
}

// 非内嵌 = 浏览器侧边栏。保留一个端口，让后台知道侧边栏当前是否打开，
// 从而把「侧栏」按钮做成开关。
let sidePanelPort = null;
function connectSidePanelPort() {
  if (IS_EMBED || !chrome.runtime || !chrome.runtime.id) return;
  try {
    const port = chrome.runtime.connect({ name: 'bsub:sidepanel' });
    sidePanelPort = port;
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      sidePanelPort = null;
      // service worker 休眠/重启会断开端口；稍后重连，恢复「侧边栏是否打开」状态
      setTimeout(() => {
        if (!sidePanelPort) connectSidePanelPort();
      }, 600);
    });
  } catch (err) {
    sidePanelPort = null;
    setTimeout(() => {
      if (!sidePanelPort) connectSidePanelPort();
    }, 1000);
  }
}
if (!IS_EMBED) connectSidePanelPort();

boot();

async function boot() {
  try {
    await store.loadUiState();
  } catch (err) {
    /* ignore */
  }
  installShell();
  window.addEventListener('bsub:update-state', (e) => applyUpdateBadge(e && e.detail));
  jobs.setJobsHost(document.getElementById('jobs'));

  // 面板挂载
  usePanel('subtitles', subtitlesPanel.init(document.getElementById('subtitles-pane')));
  usePanel('ai', aiPanel.init(document.getElementById('ai-pane')));
  usePanel('settings', settingsPanel.init(document.getElementById('settings-pane')));
  usePanel('actions', actionsPanel.init(document.getElementById('actionbar')));
  usePanel('wizard', initWizard());

  try {
    const s = await loadSettings();
    applyTheme(s);
  } catch (err) {
    renderReadiness(errorPayload(err));
  }
  await loadBuildInfo();
  renderFingerprint();
  renderTabs();
  renderReadiness();
  renderPanels();

  try {
    await pushPageOptions();
  } catch (err) {
    /* 没有 B 站页面时忽略 */
  }

  wireRuntime();
  wireStore();
  wireKeys();
  checkUpdateBadge();

  // 首次使用向导（必须能随时跳过，跳过入口常驻可见）
  const s = store.get().settings;
  if (s && s.general.firstRun && !s.general.wizardDone) {
    setTimeout(() => app.panels.wizard && app.panels.wizard.open(), 400);
  }
}

// 自动检查更新后，在设置入口留一个小圆点，避免用户永远不知道有新版本。
async function checkUpdateBadge() {
  try {
    let out = await call('update.state');
    if (!out || !out.checkedAt) out = await call('update.check', { manual: false });
    applyUpdateBadge(out);
  } catch (err) {
    /* 更新检查失败不影响面板 */
  }
}

export function applyUpdateBadge(out) {
  const on = !!(out && out.hasUpdate);
  const tab = document.querySelector('[data-tab-btn="settings"]');
  const btn = document.getElementById('btn-settings');
  if (tab) {
    if (on) tab.setAttribute('data-update', 'true');
    else tab.removeAttribute('data-update');
  }
  if (btn) {
    if (on) {
      btn.setAttribute('data-update', 'true');
      btn.setAttribute('title', `设置（发现新版本 v${out.latest}）`);
    } else {
      btn.removeAttribute('data-update');
      btn.setAttribute('title', '设置');
    }
  }

  // 顶部常驻提醒：更新前先备份设置，避免换目录后 chrome.storage 读不到旧配置。
  const banner = document.getElementById('update-banner');
  if (!banner) return;
  if (!on) {
    clear(banner);
    banner.dataset.visible = 'false';
    banner.dataset.version = '';
    return;
  }
  const version = String((out && out.latest) || '');
  // 同一版本只渲染一次；用户点 × 收起后不再反复弹。
  if (banner.dataset.version === version) return;
  banner.dataset.version = version;
  clear(banner);
  banner.appendChild(
    h('div', { class: 'update-banner-main' }, [
      h('div', {
        class: 'update-banner-text',
        text: `发现新版本 v${version}。更新前建议先备份设置，避免换目录后设置丢失。`
      }),
      h('div', { class: 'row tight' }, [
        button('备份设置', () => settingsPanel.exportSettingsBackup(), { small: true, primary: true }),
        button(
          '查看更新',
          () => {
            store.setGroupOpen('advanced', true);
            switchTab('settings');
            settingsPanel.jumpToGroup('advanced');
          },
          { small: true }
        )
      ])
    ])
  );
  banner.appendChild(
    h('button', {
      class: 'btn icon-btn update-banner-close',
      type: 'button',
      text: '×',
      title: '收起提醒',
      onclick: () => {
        banner.dataset.visible = 'false';
      }
    })
  );
  banner.dataset.visible = 'true';
}

function installShell() {
  const tabButtons = Array.from(document.querySelectorAll('[data-tab-btn]'));
  for (const b of tabButtons) {
    b.addEventListener('click', () => switchTab(b.getAttribute('data-tab-btn')));
  }
  document.getElementById('btn-settings').addEventListener('click', () => switchTab('settings'));
  const btnEmbed = document.getElementById('btn-embed');
  if (btnEmbed) {
    btnEmbed.addEventListener('click', async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'bsub:open-embed', action: 'toggle-close' });
        if (res && res.ok) {
          const closed = res.open === false || !!res.closed;
          btnEmbed.title = closed
            ? '在 B 站页面内打开面板（Alt+Shift+B）'
            : '关闭页面内嵌面板（Alt+Shift+B）';
          toast({ title: closed ? '已关闭页面内面板' : '已打开页面内面板' }, 'ok');
        } else {
          toast({ title: '无法切换页面内面板', detail: (res && res.detail) || '请先打开 B 站视频页' }, 'warn');
        }
      } catch (err) {
        toast({ title: '无法切换页面内面板', detail: String((err && err.message) || err) }, 'warn');
      }
    });
  }
  document.getElementById('btn-layout').addEventListener('click', cycleLayout);
  document.getElementById('btn-theme').addEventListener('click', cycleTheme);
  document.getElementById('btn-font-up').addEventListener('click', () => bumpFont(0.05));
  document.getElementById('btn-font-down').addEventListener('click', () => bumpFont(-0.05));
  document.getElementById('btn-help').addEventListener('click', () => shortcutsDialog());
  document.getElementById('fingerprint').addEventListener('click', () => settingsPanel.diagnosticsDialog());
  window.addEventListener('resize', () => applyLayout());
  applyLayout();
}

function switchTab(tab) {
  store.set({ activeTab: tab });
  renderTabs();
  store.scheduleUiPersist();
  if (tab === 'settings') settingsPanel.render();
  if (tab === 'ai') aiPanel.render();
  if (tab === 'subtitles') subtitlesPanel.render();
}

function renderTabs() {
  const st = store.get();
  const tab = st.activeTab || 'subtitles';
  document.body.setAttribute('data-tab', tab);
  document.getElementById('view').setAttribute('data-tab', tab);
}

function applyLayout() {
  const st = store.get();
  const columns = document.getElementById('columns');
  const layout = st.settings ? st.settings.general.layout : 'one';
  const narrow = window.innerWidth < 420;
  // 默认单列堆叠；auto 只在窄屏时单列
  const one = layout === 'one' || (layout === 'auto' && narrow) || (layout === 'two' && narrow);
  columns.setAttribute('data-mode', one ? 'one' : 'two');
  const tab = st.activeTab || 'subtitles';
  const isSettings = tab === 'settings';
  document.getElementById('col-subtitles').setAttribute('data-hidden', String(one && !isSettings && tab === 'ai'));
  document.getElementById('col-ai').setAttribute('data-hidden', String(one && !isSettings && tab === 'subtitles'));
}

function cycleLayout() {
  const s = store.get().settings;
  if (!s) return;
  const order = ['one', 'two', 'auto'];
  const next = order[(order.indexOf(s.general.layout) + 1) % order.length];
  call('settings.patch', { path: ['general', 'layout'], value: next })
    .then((res) => {
      store.set({ settings: res, readiness: res.__readiness || { ok: {}, issues: [] } });
      applyLayout();
      toast({ title: `布局：${{ auto: '自动（仅窄屏单列）', two: '双列', one: '单列堆叠' }[next]}` }, 'ok', 1500);
    })
    .catch((err) => toast({ title: '切换布局失败', detail: errorPayload(err).detail }, 'warn'));
}

function cycleTheme() {
  const s = store.get().settings;
  if (!s) return;
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(s.general.theme) + 1) % order.length];
  call('settings.patch', { path: ['general', 'theme'], value: next })
    .then((res) => {
      store.set({ settings: res, readiness: res.__readiness || { ok: {}, issues: [] } });
      applyTheme(res);
      settingsPanel.render();
      toast({ title: `主题：${{ system: '跟随系统', light: '浅色', dark: '深色' }[next]}` }, 'ok', 1500);
    })
    .catch((err) => toast({ title: '切换主题失败', detail: errorPayload(err).detail }, 'warn'));
}

function bumpFont(delta) {
  const s = store.get().settings;
  if (!s) return;
  const next = Math.max(0.8, Math.min(1.6, Number((s.general.fontScale + delta).toFixed(2))));
  call('settings.patch', { path: ['general', 'fontScale'], value: next })
    .then((res) => {
      store.set({ settings: res });
      applyTheme(res);
      settingsPanel.render();
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// 构建指纹
// ---------------------------------------------------------------------------

function renderFingerprint() {
  const st = store.get();
  const el = document.getElementById('fingerprint');
  const b = st.build;
  if (!el) return;
  el.textContent = b
    ? `构建指纹 ${b.version} · ${b.modules} 模块 · ${b.buildTime}`
    : '构建指纹：未取到（点这里查看诊断）';
  el.title = '点击查看诊断信息（版本号 + 模块数 + 构建时间）';
}

// ---------------------------------------------------------------------------
// 配置状态常驻提示
// ---------------------------------------------------------------------------

function renderReadiness(extra) {
  const el = document.getElementById('readiness');
  if (!el) return;
  const st = store.get();
  clear(el);
  const issues = (st.readiness && st.readiness.issues) || [];
  const list = extra ? [{ level: 'error', text: `${extra.title}：${extra.detail || ''}`, area: 'ai' }, ...issues] : issues;
  if (!list.length) {
    setBoolAttr(el, 'data-visible', false);
    el.style.display = 'none';
    return;
  }
  setBoolAttr(el, 'data-visible', true);
  el.style.display = 'block';
  for (const issue of list.slice(0, 4)) {
    const row = h('div', { class: `issue ${issue.level}` });
    row.appendChild(h('span', { text: `${issue.level === 'error' ? '✕' : issue.level === 'warn' ? '!' : 'i'}` }));
    row.appendChild(h('span', { class: 'txt', text: issue.text }));
    row.appendChild(
      h('span', {
        class: 'fix',
        text: '去设置',
        onclick: () => {
          switchTab('settings');
          if (issue.area) store.setGroupOpen(issue.area, true);
          settingsPanel.render();
        }
      })
    );
    el.appendChild(row);
  }
  if (list.length > 4) el.appendChild(h('div', { class: 'issue info', text: `还有 ${list.length - 4} 条提示，见设置页。` }));
}

// ---------------------------------------------------------------------------
// 跨上下文事件
// ---------------------------------------------------------------------------

function wireRuntime() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return undefined;
    // 只处理自己关心的广播，并且**不要应答**：
    // 以前这里对所有消息都 sendResponse({ok:true})，会抢在后台前面，
    // 导致 bsub:open-embed 等请求拿到一个没有 closed/open 字段的空响应。
    if (msg.type === 'bsub:content-event') {
      handleContentEvent(msg);
      return undefined;
    }
    if (msg.type === 'bsub:settings-changed') {
      refreshSettingsSoft();
      return undefined;
    }
    return undefined;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (Object.keys(changes).some((k) => k.startsWith('bsub.settings'))) refreshSettingsSoft();
  });
}

async function refreshSettingsSoft() {
  try {
    const s = await loadSettings();
    const st = store.get();
    // 保留本地草稿/视图状态，仅同步配置本身
    store.set({ settings: s, readiness: s.__readiness || { ok: {}, issues: [] } });
    applyTheme(s);
    renderReadiness();
    settingsPanel.render();
    actionsPanel.render();
  } catch (err) {
    /* ignore */
  }
}

async function handleContentEvent(msg) {
  const { event, payload } = msg;
  if (event === 'time') {
    const st = store.get();
    store.set({ follow: { currentTime: payload.currentTime, duration: payload.duration, paused: false } });
    subtitlesPanel.syncActive();
    return;
  }
  if (event === 'navigate') {
    const st = store.get();
    const hadLines = (st.subtitles || []).length > 0;
    const oldSig = st.video && st.video.signature;
    if (payload.signature === oldSig) return;
    // 换视频/分P 时要清掉**所有由视频派生的状态**。
    // 早先漏了 search 与 transcriptLog —— 上一个视频的检索结果和转录日志
    // 会跟着过来，表现为「上次的残留影响这次」。
    store.set({
      video: payload.info,
      subtitles: [],
      subtitlesOriginal: [],
      summary: '',
      summaryStream: '',
      chat: [],
      quality: null,
      subtitleError: null,
      transcriptLog: [],
      search: { ...(st.search || {}), results: [], counts: {}, query: '' },
      // 让字幕列表等按依赖重绘
      subtitlesRevision: (st.subtitlesRevision || 0) + 1
    });
    settingsPanel.render();
    actionsPanel.render();
    // 换视频后要真的「从头开始」：这里必须 noRestore，
    // 否则 loadVideo 会自动把上一期的字幕/总结从历史载回来，
    // 界面看着还停在原来那期视频上（用户报过这个现象）。
    if (hadLines) {
      // 分 P 切换后字幕会不对，必须重新抓取（稳定性 #10）
      toast({ title: '检测到分 P / 视频切换', detail: '正在重新读取并抓取字幕…' }, 'warn', 4000);
      const v = await loadVideo({ noRestore: true });
      if (v) await harvest();
    } else {
      await loadVideo({ noRestore: true });
    }
    return;
  }
  if (event === 'player-button') {
    const st = store.get();
    switchTab('subtitles');
    const q = store.get().settings?.page?.playerButtonPrompt || '';
    toast({ title: '来自播放器按钮', detail: q ? `将使用提示词：${q}` : '' }, 'ok', 3000);
    if (q && promptIsQuestion(q)) {
      switchTab('ai');
      aiPanel.sendMessage(q);
    } else {
      aiPanel.generateSummary();
    }
  }
}

function promptIsQuestion(q) {
  return /[?？]$/.test(q.trim()) || /^(什么|为什么|怎么|如何|哪些|是否)/.test(q.trim());
}

// ---------------------------------------------------------------------------
// 全局状态订阅
// ---------------------------------------------------------------------------

function wireStore() {
  let lastTab = store.get().activeTab;
  let lastLayoutKey = '';
  store.subscribe((st) => {
    if (st.activeTab !== lastTab) {
      lastTab = st.activeTab;
      renderTabs();
      applyLayout();
    }
    // 配置变化（主题 / 字号 / 布局）立即生效
    if (st.settings) {
      const key = `${st.settings.general.theme}|${st.settings.general.fontScale}|${st.settings.general.layout}`;
      if (key !== lastLayoutKey) {
        lastLayoutKey = key;
        applyTheme(st.settings);
        applyLayout();
      }
    }
    renderReadiness();
    actionsPanel.render();
    // 字幕面板自行按签名渲染（含虚拟滚动），避免频繁重建
    subtitlesPanel.render();
    if (st.activeTab === 'ai') aiPanel.render();
  });
}

// ---------------------------------------------------------------------------
// 快捷键
// ---------------------------------------------------------------------------

const SHORTCUTS = [
  ['Alt + 1 / 2 / 3', '切换到 字幕 / 总结·AI / 设置'],
  ['Alt + T', '开始语音转录'],
  ['Alt + H', '抓取官方字幕'],
  ['Alt + S', '对当前视频生成总结'],
  ['Alt + E', '导出字幕'],
  ['Alt + C', '复制全部字幕'],
  ['Alt + F', '搜索框聚焦（字幕内搜索）'],
  ['Alt + L', '切换布局（双列 / 单列）'],
  ['Alt + K', '切换主题'],
  ['Alt + Shift + B', '打开 / 折叠页面内面板（全局快捷键）'],
  ['Alt + ?', '打开本快捷键面板'],
  ['Ctrl + Enter', '在聊天框内发送消息'],
  ['Esc', '关闭浮层']
];

function wireKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // 向导这类 dismissable:false 的浮层不能被 Esc 绕过，
      // 否则「跳过 / 完成」流程不会执行，wizardDone 永远写不进去。
      if (canDismissOverlay()) closeOverlays();
      return;
    }
    if (!e.altKey) return;
    const k = e.key.toLowerCase();
    const map = {
      '1': () => switchTab('subtitles'),
      '2': () => switchTab('ai'),
      '3': () => switchTab('settings'),
      t: () => transcribe(),
      h: () => harvest(),
      s: () => aiPanel.generateSummary(),
      e: () => exportSubtitles(),
      c: () => copyAllSubtitles(),
      f: () => {
        const input = document.querySelector('#subtitles-pane input[type="search"]');
        if (input) input.focus();
      },
      l: () => cycleLayout(),
      k: () => cycleTheme(),
      '/': () => shortcutsDialog(),
      '?': () => shortcutsDialog()
    };
    const fn = map[k];
    if (fn) {
      e.preventDefault();
      fn();
    }
  });
}

function shortcutsDialog() {
  const body = h('div');
  for (const [k, desc] of SHORTCUTS) {
    body.appendChild(h('div', { class: 'shortcut-row' }, [h('span', { class: 'kbd', text: k }), h('span', { text: desc })]));
  }
  body.appendChild(h('div', { class: 'note', text: '提示：面板内所有操作也都可以用鼠标完成。' }));
  openOverlay('快捷键', body, [
    { label: '重新打开向导', onClick: () => { closeOverlays(); app.panels.wizard.open(); } },
    { label: '关闭', onClick: () => closeOverlays() }
  ], { width: '440px' });
}
