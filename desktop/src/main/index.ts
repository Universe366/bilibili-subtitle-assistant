import { app, BrowserWindow, Menu, Tray, nativeImage, nativeTheme, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { TabManager } from './tabs';
import { registerIpc } from './ipc';
import { closeLibrary, getSummaryFor, ingestVideo, initLibrary, listLibrary, saveSummary, searchLibrary } from './library';
import { getPageInfo, getSubtitles, getTrackBody } from './page';
import { summarize } from './ai';
import { buildExport } from './exporters';
import { settingsSnapshot } from './settings';
import { startBridge, stopBridge } from './bridge';

const CHROME = process.versions.chrome;
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36 Edg/${CHROME}`;
const START_URL = process.env.BSUB_START_URL || 'https://www.bilibili.com/';

function writeLog(file: string, message: string): void {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, file), `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {
    // ignore
  }
}

function fatal(tag: string, error: unknown): void {
  writeLog('fatal.log', `${tag}: ${(error as Error)?.stack || String(error)}`);
}

process.on('uncaughtException', (error) => fatal('uncaughtException', error));
process.on('unhandledRejection', (reason) => fatal('unhandledRejection', reason));
writeLog('startup.log', `boot packaged=${app.isPackaged}`);

// 开发期可用 BSUB_USER_DATA 指定会话目录（例如复用已登录的 Electron profile）
if (process.env.BSUB_USER_DATA) {
  try {
    fs.mkdirSync(process.env.BSUB_USER_DATA, { recursive: true });
    app.setPath('userData', process.env.BSUB_USER_DATA);
  } catch (error) {
    console.warn('[app] 无法设置 userData:', (error as Error).message);
  }
}

let mainWindow: BrowserWindow | null = null;
let tabManager: TabManager | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function resolveResource(name: string): string | null {
  const candidates = [
    path.join(process.resourcesPath, name),
    path.join(app.getAppPath(), 'resources', name)
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) return file;
    } catch {
      // 尝试下一个
    }
  }
  return null;
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    if (mainWindow) void startBridge(mainWindow);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  if (tray) return;
  const iconPath = resolveResource('tray.png');
  if (!iconPath) {
    console.warn('[tray] 找不到 tray.png，跳过托盘');
    return;
  }
  try {
    const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(image);
    tray.setToolTip('B站字幕助手');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: () => showWindow() },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ])
    );
    tray.on('double-click', () => showWindow());
    console.log('[tray] ready');
  } catch (error) {
    console.warn('[tray] 创建失败:', (error as Error).message);
  }
}

function createWindow(): void {
  const dark = nativeTheme.shouldUseDarkColors;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'B站字幕助手',
    backgroundColor: dark ? '#141416' : '#f6f6f3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  tabManager = new TabManager(mainWindow, (tabs) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tabs:changed', tabs);
    }
  });
  registerIpc(mainWindow, tabManager);

  mainWindow.webContents.once('did-finish-load', () => {
    console.log('[m0] userData', app.getPath('userData'));
    console.log('[m0] start', START_URL);
    void tabManager?.create(START_URL);

    if (process.env.BSUB_M4_TEST === '1') {
      setTimeout(async () => {
        const wc = tabManager?.activeWebContents();
        if (!wc) return;
        try {
          const info = await getPageInfo(wc);
          const bundle = await getSubtitles(wc);
          const track =
            bundle.tracks.find((item) => info.cid && item.url.includes(String(info.cid))) ||
            bundle.tracks[0];
          if (!track) {
            console.log('[m4-test] no track');
            return;
          }
          const body = await getTrackBody(track.url);

          const platform = {
            id: 'mock',
            name: 'Mock',
            baseUrl: 'http://127.0.0.1:8787/v1',
            apiKey: 'test',
            model: 'mock-summary'
          };
          let streamed = '';
          const result = await summarize({
            info,
            lines: body.lines,
            platform,
            prompt: '请总结以下字幕。',
            onDelta: (delta) => {
              streamed += delta;
            }
          });
          console.log(
            '[m4-test] ai',
            `chars=${result.text.length}`,
            `streamed=${streamed.length}`,
            result.text.slice(0, 40)
          );

          const saved = saveSummary(info, result.text, result.model);
          console.log('[m4-test] saved', JSON.stringify(saved));
          const stored = getSummaryFor({ bvid: info.bvid, cid: info.cid, epId: info.epId });
          console.log(
            '[m4-test] stored',
            stored ? `${stored.content.length} chars / ${stored.model}` : 'null'
          );

          const markdown = buildExport({
            format: 'md',
            info,
            track,
            lines: body.lines,
            summary: result.text
          });
          const srt = buildExport({ format: 'srt', info, track, lines: body.lines });
          const outDir = path.join(app.getAppPath(), 'out');
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(path.join(outDir, 'test-export.md'), markdown.content, 'utf8');
          fs.writeFileSync(path.join(outDir, 'test-export.srt'), srt.content, 'utf8');
          console.log(
            '[m4-test] export',
            `md=${markdown.content.length}`,
            `srt=${srt.content.length}`,
            `${markdown.filename}.${markdown.ext}`
          );

          const snapshot = settingsSnapshot();
          console.log(
            '[m4-test] settings',
            `platforms=${snapshot.settings.ai.platforms.length}`,
            `dataDir=${snapshot.dataDir}`
          );

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('library:changed');
            await mainWindow.webContents.executeJavaScript(
              `document.querySelectorAll('.side-nav-item')[1] && document.querySelectorAll('.side-nav-item')[1].click()`
            );
          }
        } catch (error) {
          console.warn('[m4-test] failed', (error as Error).message);
        }
      }, 12000);
    }

    if (process.env.BSUB_M3_TEST === '1') {
      setTimeout(async () => {
        const wc = tabManager?.activeWebContents();
        if (!wc) return;
        try {
          const info = await getPageInfo(wc);
          const bundle = await getSubtitles(wc);
          const track =
            bundle.tracks.find((item) => info.cid && item.url.includes(String(info.cid))) ||
            bundle.tracks[0];
          if (!track) {
            console.log('[m3-test] no track');
            return;
          }
          const body = await getTrackBody(track.url);
          const result = ingestVideo({ info, track, lines: body.lines });
          console.log('[m3-test] ingest', JSON.stringify(result));
          console.log('[m3-test] stats', JSON.stringify(listLibrary().stats));
          const two = searchLibrary('折叠');
          const three = searchLibrary('折叠屏');
          console.log('[m3-test] search2', two.mode, two.total, two.matches[0]?.text);
          console.log('[m3-test] search3', three.mode, three.total, three.matches[0]?.text);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('library:changed');
            await mainWindow.webContents.executeJavaScript(
              `document.querySelectorAll('.side-nav-item')[2] && document.querySelectorAll('.side-nav-item')[2].click()`
            );
          }
        } catch (error) {
          console.warn('[m3-test] failed', (error as Error).message);
        }
      }, 12000);
    }
  });

  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.log('[renderer]', `[${level}]`, message, `${sourceId}:${line}`);
    });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.warn('[renderer] gone', details);
    });
    setTimeout(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        const diag = await mainWindow.webContents.executeJavaScript(
          `({ api: typeof window.bsub, rootChildren: document.querySelector('#root') ? document.querySelector('#root').children.length : -1, text: (document.body.innerText || '').slice(0, 300) })`
        );
        console.log('[diag]', JSON.stringify(diag));
      } catch (error) {
        console.warn('[diag] failed', (error as Error).message);
      }
    }, 7000);
  }

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const section = process.env.BSUB_START_SECTION;
  if (rendererUrl) {
    void mainWindow.loadURL(section ? `${rendererUrl}?section=${encodeURIComponent(section)}` : rendererUrl);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, '../renderer/index.html'),
      section ? { query: { section } } : undefined
    );
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    tabManager?.dispose();
    tabManager = null;
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  writeLog('startup.log', 'ready');
  if (process.platform === 'win32') app.setAppUserModelId('com.bsub.desktop');
  session.defaultSession.setUserAgent(UA);
  initLibrary();
  writeLog('startup.log', 'library ready');
  createWindow();
  writeLog('startup.log', 'window created');
  createTray();
  if (mainWindow) void startBridge(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (mainWindow) void startBridge(mainWindow);
    } else {
      showWindow();
    }
  });
}).catch((error) => {
  fatal('whenReady', error);
});

app.on('before-quit', () => {
  writeLog('startup.log', 'before-quit');
  isQuitting = true;
  stopBridge();
  closeLibrary();
});

app.on('window-all-closed', () => {
  writeLog('startup.log', 'window-all-closed');
  if (process.platform !== 'darwin') app.quit();
});

app.on('render-process-gone', (_event, webContents, details) => {
  writeLog('fatal.log', `render-process-gone ${webContents.getURL()} ${JSON.stringify(details)}`);
});

app.on('child-process-gone', (_event, details) => {
  writeLog('fatal.log', `child-process-gone ${JSON.stringify(details)}`);
});
