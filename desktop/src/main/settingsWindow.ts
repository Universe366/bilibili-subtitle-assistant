import { BrowserWindow, nativeTheme } from 'electron';
import path from 'node:path';
import { APP_NAME } from '../shared/brand';

let settingsWindow: BrowserWindow | null = null;

/** 独立设置窗口：应用级设置不再挤在侧栏里。 */
export function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    title: `${APP_NAME} 设置`,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141416' : '#f6f6f3',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void settingsWindow.loadURL(`${rendererUrl}?window=settings`);
  } else {
    void settingsWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { window: 'settings' }
    });
  }
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}
