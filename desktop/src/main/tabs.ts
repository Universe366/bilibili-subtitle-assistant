import { app, BrowserWindow, session, WebContentsView } from 'electron';
import type { WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LayoutRect, TabInfo } from '../shared/types';
import { normalizeUrl } from './url';

interface TabRecord {
  id: string;
  view: WebContentsView;
  title: string;
  url: string;
  loading: boolean;
  favicon?: string;
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
  private activeId: string | null = null;
  private bounds: LayoutRect = { x: 0, y: 0, width: 0, height: 0 };

  constructor(
    private readonly win: BrowserWindow,
    private readonly onChanged: (tabs: TabInfo[]) => void
  ) {}

  async create(input = 'https://www.bilibili.com/'): Promise<string> {
    const id = randomUUID();
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

    const record: TabRecord = { id, view, title: '新标签页', url: '', loading: true };
    this.tabs.set(id, record);
    this.win.contentView.addChildView(view);
    view.setBounds(this.bounds);
    this.wire(record);

    // 必须先加载一次，CDP 才能正常挂上；随后注入 page-bridge。
    await this.prepare(view);

    this.setActive(id);
    const url = normalizeUrl(input);
    record.url = url;
    console.log('[m0] tab created', id, url);
    void view.webContents
      .loadURL(url)
      .then(async () => {
        const version = await view.webContents
          .executeJavaScript('window.__BSUB_PAGE_BRIDGE__?.version ?? null')
          .catch(() => null);
        console.log('[m0] page ready', url, 'bridge=', version);
      })
      .catch((err: Error) => {
        console.warn('[tab] loadURL 失败', url, err.message);
      });
    this.emit();
    return id;
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
    const wc = record.view.webContents;
    const touch = () => this.emit();

    wc.on('page-title-updated', (_event, title) => {
      record.title = title;
      touch();
    });
    wc.on('page-favicon-updated', (_event, icons) => {
      record.favicon = icons[0];
      touch();
    });
    wc.on('did-navigate', (_event, url) => {
      record.url = url;
      touch();
    });
    wc.on('did-navigate-in-page', (_event, url) => {
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
    for (const [tabId, record] of this.tabs) {
      try {
        record.view.setVisible(tabId === id);
      } catch {
        // setVisible 不可用时忽略；新窗口的视图仍会显示
      }
    }
    const record = this.tabs.get(id);
    if (record) record.view.setBounds(this.bounds);
    this.emit();
  }

  activate(id: string): void {
    if (!this.tabs.has(id) || this.activeId === id) return;
    this.setActive(id);
  }

  close(id: string): void {
    const record = this.tabs.get(id);
    if (!record) return;

    this.tabs.delete(id);
    try {
      this.win.contentView.removeChildView(record.view);
    } catch {
      // ignore
    }
    try {
      record.view.webContents.close();
    } catch {
      // ignore
    }

    if (this.activeId === id) {
      const next = [...this.tabs.keys()].pop() ?? null;
      this.activeId = next;
      if (next) {
        const nextRecord = this.tabs.get(next);
        if (nextRecord) {
          try {
            nextRecord.view.setVisible(true);
          } catch {
            // ignore
          }
          nextRecord.view.setBounds(this.bounds);
        }
      }
    }
    this.emit();
  }

  navigate(input: string): void {
    const record = this.activeRecord();
    if (!record) return;
    const url = normalizeUrl(input);
    void record.view.webContents.loadURL(url).catch((err: Error) => {
      console.warn('[tab] navigate 失败', url, err.message);
    });
  }

  back(): void {
    const wc = this.activeRecord()?.view.webContents;
    if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  forward(): void {
    const wc = this.activeRecord()?.view.webContents;
    if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(): void {
    this.activeRecord()?.view.webContents.reload();
  }

  stop(): void {
    this.activeRecord()?.view.webContents.stop();
  }

  setLayout(rect: LayoutRect): void {    const hadSize = this.bounds.width > 0 && this.bounds.height > 0;
    this.bounds = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    };
    if (!hadSize && this.bounds.width > 0) {
      console.log('[m0] layout set', JSON.stringify(this.bounds));
    }
    const record = this.activeRecord();
    if (record) record.view.setBounds(this.bounds);
  }

  activeWebContents(): WebContents | null {
    return this.activeRecord()?.view.webContents ?? null;
  }

  list(): TabInfo[] {
    return [...this.tabs.values()].map((record) => {
      const wc = record.view.webContents;
      let canGoBack = false;
      let canGoForward = false;
      try {
        canGoBack = wc.navigationHistory.canGoBack();
        canGoForward = wc.navigationHistory.canGoForward();
      } catch {
        // ignore
      }
      return {
        id: record.id,
        title: record.title || '新标签页',
        url: record.url,
        loading: record.loading,
        active: record.id === this.activeId,
        canGoBack,
        canGoForward,
        favicon: record.favicon
      };
    });
  }

  dispose(): void {
    for (const record of this.tabs.values()) {
      try {
        this.win.contentView.removeChildView(record.view);
      } catch {
        // ignore
      }
      try {
        record.view.webContents.close();
      } catch {
        // ignore
      }
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
