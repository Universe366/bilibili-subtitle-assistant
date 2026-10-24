import { app, BrowserWindow, dialog, Tray, nativeTheme, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { TabManager } from './tabs';
import { registerIpc } from './ipc';

import {
  closeLibrary,
  initLibrary,
  recordHistory,
} from './library';

import {
  loadSettings,
  migrateSettingsSecrets,
  saveSettings,
} from './settings';
import { installLogger } from './logger';
import { fatal, writeLog } from './log';
import { installPermissionGate } from './permissions';
import { installCsp } from './csp';
import { startBridge, stopBridge } from './bridge';
import { disposeUpdater, initUpdater } from './updater';
import { initPetWindow } from './petWindow';
import { applyDataDirOverride, scheduleOldDataCleanup } from './dataDir';
import { migrateLegacyUserData } from './userDataMigration';
import { loadSession } from './session';
import { createSessionPersister, createTray as createTrayShell } from './shell';
import { APP_NAME } from '../shared/brand';
import { installDownloadHook } from './downloadsHook';
import {
  buildUserAgent,
  closeAction,
  closeChoiceFromDialog,
  resolveStartUrl,
  shortcutAction,
  shouldRestoreSession,
  windowFrameOptions
} from './windowPolicy';
import { restoreSession } from './sessionRestore';

const UA = buildUserAgent(process.versions.chrome);
const START_URL = resolveStartUrl();

// 自定义数据目录必须早于任何 userData 读写；环境变量仅用于开发期覆盖。
let migrationFallback: string | null = null;
if (!process.env.BSUB_USER_DATA) {
  const migration = migrateLegacyUserData();
  if (migration.result.status !== 'none') {
    console.log('[data] legacy migration', migration.result.status, migration.result.target || '');
  }
  if (migration.result.status === 'failed') {
    migrationFallback = migration.fallback || null;
    console.warn('[data] migration failed, fallback:', migration.result.error || 'unknown');
  }
}
const dataDirOverride = applyDataDirOverride();
if (!dataDirOverride && migrationFallback && !process.env.BSUB_USER_DATA) {
  try {
    app.setPath('userData', migrationFallback);
    console.warn('[data] using legacy userData:', migrationFallback);
  } catch {
    // ignore
  }
}
if (process.env.BSUB_USER_DATA) {
  try {
    fs.mkdirSync(process.env.BSUB_USER_DATA, { recursive: true });
    app.setPath('userData', process.env.BSUB_USER_DATA);
  } catch (error) {
    console.warn('[app] 无法设置 userData:', (error as Error).message);
  }
}
writeLog('startup.log', `boot packaged=${app.isPackaged} dataDir=${dataDirOverride || ''}`);

let mainWindow: BrowserWindow | null = null;
let tabManager: TabManager | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let closingChoicePending = false;

// 双开会共用 library.db 和桥端口，第二个实例启动时还会把第一个实例的
// running 任务标成「应用退出」——必须只允许一个实例。
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    showWindow();
    const url = argv.find((arg) => /^https?:\/\//i.test(arg));
    if (url && tabManager) void tabManager.create(url);
  });
}

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

const sessionPersister = createSessionPersister(() => tabManager);

function createTray(): void {
  if (tray) return;
  tray = createTrayShell({
    iconPath: resolveResource('tray.png'),
    tooltip: APP_NAME,
    onShow: () => showWindow(),
    onQuit: () => {
      isQuitting = true;
    }
  });
}

function createWindow(): void {
  const dark = nativeTheme.shouldUseDarkColors;
  mainWindow = new BrowserWindow({
    ...windowFrameOptions({
      dark,
      preloadPath: path.join(__dirname, '../preload/index.js')
    }),
    title: APP_NAME
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const action = shortcutAction(input);
    if (!action) return;
    if (action === 'exit-fullscreen') {
      if (!mainWindow?.isFullScreen()) return;
      event.preventDefault();
      void tabManager
        ?.activeWebContents()
        ?.executeJavaScript(
          'document.fullscreenElement ? document.exitFullscreen().catch(() => null) : null'
        )
        .catch(() => undefined);
      mainWindow.setFullScreen(false);
      return;
    }
    event.preventDefault();
    if (action === 'zoom-in') tabManager?.zoomIn();
    else if (action === 'zoom-out') tabManager?.zoomOut();
    else if (action === 'zoom-reset') tabManager?.zoomReset();
    else if (action === 'toggle-fullscreen') mainWindow?.setFullScreen(!mainWindow.isFullScreen());
    else if (action === 'quit') app.quit();
  });

  tabManager = new TabManager(
    mainWindow,
    (tabs) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tabs:changed', tabs);
      }
      sessionPersister.schedule();
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
    },
    (visit) => {
      try {
        recordHistory(visit);
      } catch (error) {
        console.warn('[history] 记录失败:', (error as Error).message);
      }
    }
  );
  registerIpc(mainWindow, tabManager);
  tabManager.setSuspendMinutes(loadSettings().general.suspendMinutes);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void tabManager?.create(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.once('did-finish-load', () => {
    console.log('[m0] userData', app.getPath('userData'));
    console.log('[m0] start', START_URL);
    const saved = shouldRestoreSession(loadSettings()) ? loadSession() : null;
    if (tabManager) {
      const manager = tabManager;
      void restoreSession({ manager, saved, startUrl: START_URL }).then((result) => {
        if (!result.usedStartUrl) console.log('[session] restored', result.restored, 'tabs');
      });
    }

    // 开发探针不进生产包：按需动态加载，只有未打包或显式开启时才拉取。
    if (mainWindow && tabManager && (!app.isPackaged || process.env.BSUB_ENABLE_DEV_HOOKS === '1')) {
      const devWindow = mainWindow;
      const devTabs = tabManager;
      void import('./devHooks').then(({ runDevHooks }) => runDevHooks(devWindow, devTabs));
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
    void mainWindow.loadURL(
      section ? `${rendererUrl}?section=${encodeURIComponent(section)}` : rendererUrl
    );
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, '../renderer/index.html'),
      section ? { query: { section } } : undefined
    );
  }

  mainWindow.on('close', (event) => {
    const action = closeAction({
      isQuitting,
      closeToTray: loadSettings().general.closeToTray,
      choicePending: closingChoicePending
    });
    if (action === 'allow') return;
    event.preventDefault();

    closingChoicePending = true;
    void dialog
      .showMessageBox(mainWindow as BrowserWindow, {
        type: 'question',
        title: APP_NAME,
        message: '要最小化到托盘，还是退出应用？',
        detail: '最小化后可以从托盘图标恢复；选择「记住」下次不再询问。',
        buttons: ['最小化到托盘', '退出应用', '取消'],
        defaultId: 0,
        cancelId: 2,
        checkboxLabel: '记住我的选择',
        checkboxChecked: false,
        noLink: true
      })
      .then((result) => {
        closingChoicePending = false;
        const choice = closeChoiceFromDialog(result);
        if (choice === 'cancel') return;
        if (result.checkboxChecked) {
          const settings = loadSettings();
          settings.general.closeToTray = choice === 'tray';
          saveSettings(settings);
        }
        if (choice === 'tray') {
          mainWindow?.hide();
        } else {
          isQuitting = true;
          app.quit();
        }
      })
      .catch(() => {
        closingChoicePending = false;
      });
  });

  mainWindow.on('closed', () => {
    tabManager?.dispose();
    tabManager = null;
    mainWindow = null;
  });
}

app
  .whenReady()
  .then(() => {
    if (!hasSingleInstanceLock) return;
    installLogger();
    writeLog('startup.log', 'ready');
    migrateSettingsSecrets();
    nativeTheme.themeSource = loadSettings().general.theme;
    if (process.platform === 'win32') app.setAppUserModelId('com.shizi.desktop');
    session.defaultSession.setUserAgent(UA);
    installDownloadHook(() => mainWindow);
    initLibrary();
    writeLog('startup.log', 'library ready');
    scheduleOldDataCleanup();
    // 先装权限闸门和 CSP，再创建窗口：CSP 监听必须在 renderer 发起请求前注册。
    installPermissionGate(() =>
      mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.id : null
    );
    installCsp(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.id : null));
    createWindow();
    writeLog('startup.log', 'window created');
    createTray();
    initPetWindow();
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
  })
  .catch((error) => {
    fatal('whenReady', error);
  });

app.on('before-quit', () => {
  writeLog('startup.log', 'before-quit');
  isQuitting = true;
  sessionPersister.persist();
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
