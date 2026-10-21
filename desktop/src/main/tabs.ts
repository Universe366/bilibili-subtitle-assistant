import { app, BrowserWindow, session, WebContentsView } from 'electron';
import type { WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LayoutRect, TabInfo } from '../shared/types';
import { normalizeUrl } from './url';

// 后台标签闲置多久后释放渲染进程。可用环境变量覆盖，便于本地验证。
const SUSPEND_AFTER_MS = Math.max(2000, Number(process.env.BSUB_SUSPEND_MS) || 5 * 60 * 1000);
const SUSPEND_CHECK_MS = Math.min(30000, Math.max(1000, Math.floor(SUSPEND_AFTER_MS / 2)));

interface TabRecord {
  id: string;
  view: WebContentsView | null;
  title: string;
  url: string;
  loading: boolean;
  favicon?: string;
  suspended: boolean;
  lastActiveAt: number;
}

let bridgeCache: string | null = null;

function bridgeSource(): string {
  if (bridgeCache) return bridgeCache;
  const candidates = [
    path.join(process.resourcesPath, 'page-bridge.js'),
    path.join(app.getAppPath(), 'resources/page-bridge.js'),
    path.resolve(app.getAppPath(), '../bilibili-subtitle-assistant/src/content/page-bridge.js')
  ];
  for (const file of candidates) {
    try {
      bridgeCache = fs.readFileSync(file, 'utf8');
      return bridgeCache;
    } catch {
      // 尝试下一个候选路径
    }
  }
  throw new Error('找不到 page-bridge.js，请先运行 npm run sync:bridge');
}

export class TabManager {
  private readonly tabs = new Map<string, TabRecord>();
  private readonly creating = new Map<string, Promise<void>>();
  private activeId: string | null = null;
  private bounds: LayoutRect = { x: 0, y: 0, width: 0, height: 0 };
  private readonly suspendTimer: NodeJS.Timeout;

  constructor(
    private readonly win: BrowserWindow,
    private readonly onChanged: (tabs: TabInfo[]) => void
  ) {
    this.suspendTimer = setInterval(() => this.suspendIdle(), SUSPEND_CHECK_MS);
    this.suspendTimer.unref?.();
  }

  async create(input = 'https://www.bilibili.com/'): Promise<string> {
    const id = randomUUID();
    const url = normalizeUrl(input);
    const record: TabRecord = {
      id,
      view: null,
      title: '新标签页',
      url,
      loading: true,
      suspended: false,
      lastActiveAt: Date.now()
    };
    this.tabs.set(id, record);

    await this.ensureView(record);
    this.setActive(id);
    console.log('[tab] created', id, url, `suspendAfter=${SUSPEND_AFTER_MS}ms`);
    this.emit();
    return id;
  }

  // 创建（或重建）一个标签的 WebContentsView。休眠标签恢复时也走这里。
  private ensureView(record: TabRecord): Promise<void> {
    if (record.view) return Promise.resolve();
    const existing = this.creating.get(record.id);
    if (existing) return existing;

    const task = (async () => {
      const view = new WebContentsView({
        webPreferences: {
          session: session.defaultSession,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          backgroundThrottling: false
        }
      });
      view.setBackgroundColor('#ffffff');
      view.setBorderRadius(10);

      record.view = view;
      record.suspended = false;
      record.loading = true;

      this.win.contentView.addChildView(view);
      view.setBounds(this.bounds);
      this.wire(record);

      // prepare 会先导航到 about:blank 来挂 CDP；这里先把目标地址记下来，
      // 避免 about:blank 的导航事件把 record.url 覆盖掉。
      const target = record.url || 'about:blank';

      // 必须先加载一次，CDP 才能正常挂上；随后注入 page-bridge。
      await this.prepare(view);
      record.url = target;

      void view.webContents
        .loadURL(target)
        .then(async () => {
          const version = await view.webContents
            .executeJavaScript('window.__BSUB_PAGE_BRIDGE__?.version ?? null')
            .catch(() => null);
          console.log('[tab] page ready', target, 'bridge=', version);
        })
        .catch((err: Error) => {
          console.warn('[tab] loadURL 失败', target, err.message);
        });

      this.emit();
    })();

    this.creating.set(record.id, task);
    return task.finally(() => {
      this.creating.delete(record.id);
    });
  }

  private async prepare(view: WebContentsView): Promise<void> {
    const wc = view.webContents;
    try {
      await wc.loadURL('about:blank');
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('Page.enable');
      await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: bridgeSource()
      });
    } catch (err) {
      console.warn('[tab] 注入 page-bridge 失败:', (err as Error).message);
    }
  }

  private wire(record: TabRecord): void {
    const view = record.view;
    if (!view) return;
    const wc = view.webContents;
    const touch = () => this.emit();

    wc.on('page-title-updated', (_event, title) => {
      if (!title || title === 'about:blank') return;
      record.title = title;
      touch();
    });
    wc.on('page-favicon-updated', (_event, icons) => {
      record.favicon = icons[0];
      touch();
    });
    wc.on('did-navigate', (_event, url) => {
      if (!url || url === 'about:blank') return;
      record.url = url;
      touch();
    });
    wc.on('did-navigate-in-page', (_event, url) => {
      if (!url || url === 'about:blank') return;
      record.url = url;
      touch();
    });
    wc.on('did-start-loading', () => {
      record.loading = true;
      touch();
    });
    wc.on('did-stop-loading', () => {
      record.loading = false;
      touch();
    });
    wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      record.loading = false;
      console.warn('[tab] 加载失败', code, description, url);
      touch();
    });

    wc.setWindowOpenHandler(({ url }) => {
      void this.create(url);
      return { action: 'deny' };
    });
  }

  private setActive(id: string): void {
    this.activeId = id;
    const active = this.tabs.get(id);
    if (active) active.lastActiveAt = Date.now();

    for (const [tabId, record] of this.tabs) {
      if (!record.view) continue;
      try {
        record.view.setVisible(tabId === id);
      } catch {
        // setVisible 不可用时忽略
      }
    }
    if (active && active.view) active.view.setBounds(this.bounds);
    this.emit();
  }

  async activate(id: string): Promise<void> {
    if (!this.tabs.has(id) || this.activeId === id) return;
    const record = this.tabs.get(id);
    if (!record) return;
    // 已休眠的标签在切回时才重建，页面重新加载（后台状态本来也不该保留）。
    if (!record.view || record.suspended) await this.ensureView(record);
    this.setActive(id);
  }

  close(id: string): void {
    const record = this.tabs.get(id);
    if (!record) return;

    this.tabs.delete(id);
    this.releaseView(record);

    if (this.activeId === id) {
      const next = [...this.tabs.keys()].pop() ?? null;
      this.activeId = next;
      if (next) {
        const nextRecord = this.tabs.get(next);
        if (nextRecord) {
          if (!nextRecord.view || nextRecord.suspended) {
            void this.ensureView(nextRecord).then(() => {
              if (this.activeId === next) this.setActive(next);
            });
          } else {
            try {
              nextRecord.view.setVisible(true);
            } catch {
              // ignore
            }
            nextRecord.view.setBounds(this.bounds);
          }
        }
      }
    }
    this.emit();
  }

  private releaseView(record: TabRecord): void {
    const view = record.view;
    record.view = null;
    if (!view) return;
    try {
      this.win.contentView.removeChildView(view);
    } catch {
      // ignore
    }
    try {
      view.webContents.close();
    } catch {
      // ignore
    }
  }

  // 后台标签闲置后释放渲染进程；正在出声的标签不回收（后台听视频）。
  private suspendIdle(): void {
    const now = Date.now();
    for (const [id, record] of this.tabs) {
      if (id === this.activeId || record.suspended || !record.view) continue;
      if (now - record.lastActiveAt < SUSPEND_AFTER_MS) continue;

      const wc = record.view.webContents;
      try {
        if (!wc.isDestroyed() && wc.isCurrentlyAudible()) {
          record.lastActiveAt = now;
          continue;
        }
      } catch {
        // ignore
      }
      this.suspend(record);
    }
  }

  private suspend(record: TabRecord): void {
    const view = record.view;
    if (!view) return;
    try {
      if (!view.webContents.isDestroyed()) record.url = view.webContents.getURL() || record.url;
    } catch {
      // ignore
    }
    this.releaseView(record);
    record.suspended = true;
    record.loading = false;
    console.log('[tabs] suspended', record.id, record.url);
    this.emit();
  }

  navigate(input: string): void {
    const record = this.activeRecord();
    if (!record || !record.view) return;
    const url = normalizeUrl(input);
    void record.view.webContents.loadURL(url).catch((err: Error) => {
      console.warn('[tab] navigate 失败', url, err.message);
    });
  }

  back(): void {
    const wc = this.activeRecord()?.view?.webContents;
    if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  forward(): void {
    const wc = this.activeRecord()?.view?.webContents;
    if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(): void {
    this.activeRecord()?.view?.webContents.reload();
  }

  stop(): void {
    this.activeRecord()?.view?.webContents.stop();
  }

  setLayout(rect: LayoutRect): void {
    const hadSize = this.bounds.width > 0 && this.bounds.height > 0;
    this.bounds = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    };
    if (!hadSize && this.bounds.width > 0) {
      console.log('[m0] layout set', JSON.stringify(this.bounds));
    }
    const view = this.activeRecord()?.view;
    if (view) view.setBounds(this.bounds);
  }

  activeWebContents(): WebContents | null {
    return this.activeRecord()?.view?.webContents ?? null;
  }

  list(): TabInfo[] {
    return [...this.tabs.values()].map((record) => {
      const wc = record.view?.webContents;
      let canGoBack = false;
      let canGoForward = false;
      if (wc) {
        try {
          canGoBack = wc.navigationHistory.canGoBack();
          canGoForward = wc.navigationHistory.canGoForward();
        } catch {
          // ignore
        }
      }
      return {
        id: record.id,
        title: record.title || '新标签页',
        url: record.url,
        loading: record.loading,
        active: record.id === this.activeId,
        canGoBack,
        canGoForward,
        favicon: record.favicon,
        suspended: record.suspended
      };
    });
  }

  dispose(): void {
    clearInterval(this.suspendTimer);
    for (const record of this.tabs.values()) {
      this.releaseView(record);
    }
    this.tabs.clear();
    this.activeId = null;
  }

  private activeRecord(): TabRecord | null {
    if (!this.activeId) return null;
    return this.tabs.get(this.activeId) ?? null;
  }

  private emit(): void {
    this.onChanged(this.list());
  }
}
