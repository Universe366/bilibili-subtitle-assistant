// 侧边栏全局状态。UI 只读 state，通过 store.set 修改并触发订阅。

import { call } from './bridge.js';

const UI_KEY = 'bsub.uiState.v1';

function emptyState() {
  return {
    ready: false,
    settings: null,
    maskedSettings: null,
    readiness: { ok: {}, issues: [] },
    video: null,
    subtitles: [],
    // AI 校对前的原始字幕（用于「回退字幕」）。只在换视频时清空。
    subtitlesOriginal: [],
    subtitleMeta: null,
    summary: '',
    chat: [],
    suggestions: [],
    search: { results: [], counts: {}, query: '', lastAt: 0 },
    history: [],
    queue: [],
    jobs: [],
    activeTab: 'subtitles',
    ui: {
      groups: {},
      scroll: {},
      search: '',
      bulkPrompt: '',
      batchInput: '',
      pendingKeyVisibility: {}
    },
    diagnostics: null,
    build: null,
    contentTabs: []
  };
}

class Store {
  constructor() {
    this.state = emptyState();
    this.listeners = new Set();
    this.uiPersistTimer = null;
  }

  get() {
    return this.state;
  }

  set(patch) {
    if (typeof patch === 'function') {
      const next = patch(this.state);
      if (next) Object.assign(this.state, next);
    } else {
      Object.assign(this.state, patch);
    }
    this.emit();
    return this.state;
  }

  setUi(patch) {
    this.state.ui = { ...this.state.ui, ...patch };
    this.scheduleUiPersist();
    this.emit();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) {
      try {
        fn(this.state);
      } catch (err) {
        console.error('[字幕助手] 订阅回调异常', err);
      }
    }
  }

  // 展开状态 / 滚动位置持久化（稳定性 #5）
  scheduleUiPersist() {
    if (this.uiPersistTimer) clearTimeout(this.uiPersistTimer);
    this.uiPersistTimer = setTimeout(() => {
      try {
        chrome.storage.local.set({
          [UI_KEY]: {
            groups: this.state.ui.groups,
            scroll: this.state.ui.scroll,
            search: this.state.ui.search,
            activeTab: this.state.activeTab
          }
        });
      } catch (err) {
        /* ignore */
      }
    }, 350);
  }

  async loadUiState() {
    try {
      const got = await chrome.storage.local.get(UI_KEY);
      const saved = got ? got[UI_KEY] : null;
      if (saved) {
        this.state.ui.groups = saved.groups || {};
        this.state.ui.scroll = saved.scroll || {};
        this.state.ui.search = saved.search || '';
        if (saved.activeTab) this.state.activeTab = saved.activeTab;
      }
    } catch (err) {
      /* ignore */
    }
  }

  setGroupOpen(key, open) {
    this.state.ui.groups = { ...this.state.ui.groups, [key]: !!open };
    this.scheduleUiPersist();
  }

  groupOpen(key, fallback) {
    const v = this.state.ui.groups[key];
    return typeof v === 'boolean' ? v : !!fallback;
  }

  setScroll(key, top) {
    this.state.ui.scroll = { ...this.state.ui.scroll, [key]: top };
    this.scheduleUiPersist();
  }

  scrollOf(key, fallback = 0) {
    const v = this.state.ui.scroll[key];
    return typeof v === 'number' ? v : fallback;
  }
}

export const store = new Store();

export async function loadSettings() {
  const s = await call('settings.get');
  store.set({ settings: s, maskedSettings: s, readiness: s.__readiness || { ok: {}, issues: [] }, ready: true });
  return s;
}

export async function saveSettings(next) {
  const s = await call('settings.set', { settings: next });
  store.set({ settings: s, maskedSettings: s, readiness: s.__readiness || { ok: {}, issues: [] } });
  return s;
}

export async function loadBuildInfo() {
  try {
    const b = await call('build.info');
    store.set({ build: b });
    return b;
  } catch (err) {
    return null;
  }
}
