import { app, BrowserWindow, Menu, Tray, nativeImage, nativeTheme, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { TabManager } from './tabs';
import { registerIpc } from './ipc';
import { closeLibrary, getSummaryFor, ingestVideo, initLibrary, listLibrary, saveSummary, searchLibrary } from './library';
import { getPageInfo, getSubtitles, getTrackBody } from './page';
import { summarize } from './ai';
import { searchWeb } from './search';
import { applyCorrectionToText } from './correction';
import { buildExport } from './exporters';
import { loadSettings, saveSettings, settingsSnapshot } from './settings';
import { startBridge, stopBridge } from './bridge';
import { disposeUpdater, initUpdater } from './updater';

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

  tabManager = new TabManager(
    mainWindow,
    (tabs) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tabs:changed', tabs);
      }
    },
    (result) => {
      if (!app.isPackaged) {
        console.log(
          '[find]',
          result.tabId.slice(0, 8),
          `${result.activeMatchOrdinal}/${result.matches}`,
          `final=${result.finalUpdate}`
        );
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('find:result', result);
      }
    }
  );
  registerIpc(mainWindow, tabManager);
  tabManager.setSuspendMinutes(loadSettings().general.suspendMinutes);

  mainWindow.webContents.once('did-finish-load', () => {
    console.log('[m0] userData', app.getPath('userData'));
    console.log('[m0] start', START_URL);
    void tabManager?.create(START_URL);

    if (process.env.BSUB_CHAT_TEST === '1') {
      setTimeout(async () => {
        try {
          if (!mainWindow) return;
          const settings = loadSettings();
          settings.ai.platforms = [
            {
              id: 'mock',
              name: 'Mock',
              baseUrl: process.env.BSUB_MOCK_AI || 'http://127.0.0.1:8787/v1',
              apiKey: 'mock',
              model: 'mock'
            }
          ];
          settings.ai.activeId = 'mock';
          saveSettings(settings);

          const result = await mainWindow.webContents.executeJavaScript(`new Promise(async (resolve) => {
            const info = { title: '测试视频', owner: '测试UP', duration: 60, bvid: 'BV1', cid: 1, url: '' };
            const lines = [
              { start: 0, end: 5, text: '这是第一句字幕。' },
              { start: 5, end: 10, text: '这是第二句字幕。' }
            ];
            let text = '';
            const offD = window.bsub.onChatDelta((e) => { text += e.delta; });
            const offDone = window.bsub.onChatDone((e) => {
              offD(); offDone(); offErr();
              resolve({ ok: true, len: e.text.length, text: e.text.slice(0, 40) });
            });
            const offErr = window.bsub.onChatError((e) => {
              offD(); offDone(); offErr();
              resolve({ ok: false, error: e.error });
            });
            const started = await window.bsub.chat({
              requestId: 'chat-test',
              info,
              lines,
              messages: [{ role: 'user', content: '这个视频讲了什么？' }]
            });
            if (!started.ok) {
              offD(); offDone(); offErr();
              resolve({ ok: false, error: started.error });
            }
          })`);
          console.log('[chat-test]', JSON.stringify(result));
        } catch (error) {
          console.warn('[chat-test] failed', (error as Error).message);
        }
      }, 5000);
    }

    if (process.env.BSUB_CORRECTION_TEST === '1') {
      setTimeout(() => {
        const settings = loadSettings();
        settings.correction.groups = [
          {
            id: 'g',
            name: '测试',
            enabled: true,
            rules: [
              {
                id: 'r1',
                pattern: 'AI',
                replacement: '人工智能',
                regex: false,
                caseSensitive: true
              }
            ]
          }
        ];
        settings.correction.glossary.terms = [
          { id: 't', from: 'UP主', to: 'UP 主', note: '' }
        ];
        console.log(
          '[correction-test]',
          applyCorrectionToText('AI 和 UP主 的视频，AI 很好', settings)
        );
      }, 4000);
    }

    if (process.env.BSUB_SEARCH_TEST === '1') {
      setTimeout(async () => {
        try {
          const settings = loadSettings();
          const refs = await searchWeb(
            { ...settings, search: { ...settings.search, enabled: true, provider: 'exa' } },
            'B站 视频 总结'
          );
          console.log(
            '[search-test]',
            refs.length,
            JSON.stringify(refs.map((ref) => ({ title: ref.title.slice(0, 40), url: ref.url })))
          );
        } catch (error) {
          console.warn('[search-test] failed', (error as Error).message);
        }
      }, 5000);
    }

    if (process.env.BSUB_SETTINGS_TEST === '1') {
      setTimeout(async () => {
        if (!mainWindow) return;
        try {
          const result = await mainWindow.webContents.executeJavaScript(`(async () => {
            const r = await window.bsub.getSettings();
            const s = r.data.settings;
            s.general.theme = 'dark';
            s.general.suspendMinutes = 7;
            s.ai.platforms = s.ai.platforms.filter((p) => p.id !== 'openai');
            s.ai.activeId = 'deepseek';
            s.ai.temperature = 0.7;
            s.prompt.templates.push({ id: 'test-tpl', name: '测试模板', text: '只输出一句话' });
            s.prompt.activeId = 'test-tpl';
            s.export.filenamePattern = '{title}-{bvid}';
            return await window.bsub.saveSettings(s);
          })()`);
          console.log('[settings-test]', JSON.stringify(result).slice(0, 600));
        } catch (error) {
          console.warn('[settings-test] failed', (error as Error).message);
        }
      }, 5000);
    }

    if (process.env.BSUB_UI_TEST === '1') {
      setTimeout(() => {
        const wc = tabManager?.activeWebContents();
        if (!wc) return;
        tabManager?.zoomIn();
        console.log('[ui-test] zoom', wc.getZoomFactor());
        tabManager?.zoomReset();
        console.log('[ui-test] zoom reset', wc.getZoomFactor());
        tabManager?.findInPage('视频');
        setTimeout(() => tabManager?.findInPage('视频', { findNext: true }), 1200);
      }, 7000);
    }

    if (process.env.BSUB_TAB_TEST === '1') {      setTimeout(async () => {
        if (!tabManager) return;
        await tabManager.create('https://www.bilibili.com/');
        await tabManager.create('https://www.bilibili.com/video/BV1xrnz6gEVD');
        setTimeout(() => {
          const list = tabManager?.list() || [];
          const total = app
            .getAppMetrics()
            .reduce(
              (sum, metric) => sum + Math.round(((metric.memory && metric.memory.workingSetSize) || 0) / 1024),
              0
            );
          console.log(
            '[tabs-test]',
            JSON.stringify(list.map((tab) => ({ title: tab.title, suspended: tab.suspended, active: tab.active }))),
            `memMB=${total}`
          );

          const target = list.find((tab) => tab.suspended);
          if (target && tabManager) {
            void tabManager.activate(target.id).then(() => {
              setTimeout(() => {
                const after = tabManager?.list() || [];
                console.log(
                  '[tabs-test] resumed',
                  JSON.stringify(
                    after.map((tab) => ({ title: tab.title, suspended: tab.suspended, active: tab.active }))
                  )
                );
              }, 4000);
            });
          }
        }, 10000);
      }, 4000);
    }

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
    if (isQuitting) return;
    // 设置里关掉「关闭到托盘」后，点关闭直接退出。
    if (loadSettings().general.closeToTray === false) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    tabManager?.dispose();
    tabManager = null;
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  writeLog('startup.log', 'ready');
  nativeTheme.themeSource = loadSettings().general.theme;
  if (process.platform === 'win32') app.setAppUserModelId('com.bsub.desktop');
  session.defaultSession.setUserAgent(UA);
  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({
      title: '保存文件',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename())
    });
  });
  initLibrary();
  writeLog('startup.log', 'library ready');
  createWindow();
  writeLog('startup.log', 'window created');
  createTray();
  if (mainWindow) {
    void startBridge(mainWindow);
    initUpdater(mainWindow);
  }

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
  disposeUpdater();
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
