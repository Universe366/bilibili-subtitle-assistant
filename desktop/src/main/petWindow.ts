import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { loadSettings, saveSettings } from './settings';

let petWindow: BrowserWindow | null = null;
let saveTimer: NodeJS.Timeout | null = null;

function initialPosition(): { x: number; y: number } {
  const settings = loadSettings();
  if (settings.general.petX && settings.general.petY) {
    return { x: settings.general.petX, y: settings.general.petY };
  }
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - 300, y: area.y + area.height - 340 };
}

/** 桌宠窗口：透明、无边框、置顶、不进任务栏。 */
export function openPetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show();
    return;
  }
  const position = initialPosition();
  petWindow = new BrowserWindow({
    ...position,
    width: 260,
    height: 320,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  applyWindowStyle();
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void petWindow.loadURL(`${rendererUrl}?window=pet`);
  } else {
    void petWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { window: 'pet' }
    });
  }
  petWindow.once('ready-to-show', () => petWindow?.showInactive());
  petWindow.on('moved', () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!petWindow || petWindow.isDestroyed()) return;
      const [x, y] = petWindow.getPosition();
      const settings = loadSettings();
      settings.general.petX = x;
      settings.general.petY = y;
      saveSettings(settings);
    }, 500);
  });
  petWindow.on('closed', () => {
    petWindow = null;
  });
  console.log('[pet] window opened');
}

export function closePetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) petWindow.close();
  petWindow = null;
}

/** 设置里切换开关时调用：创建/销毁窗口并写回设置。 */
export function setPetEnabled(enabled: boolean): void {
  // 只负责窗口生命周期；开关值由 settings:set 统一保存，避免两处写设置互相覆盖。
  if (enabled) openPetWindow();
  else closePetWindow();
}

export function initPetWindow(): void {
  if (loadSettings().general.petEnabled) {
    setTimeout(() => openPetWindow(), 1200);
  }
}

function applyWindowStyle(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const settings = loadSettings();
  const size = Math.min(180, Math.max(64, Math.round(settings.general.petSize || 96)));
  petWindow.setOpacity(Math.min(1, Math.max(0.4, settings.general.petOpacity ?? 1)));
  petWindow.setAlwaysOnTop(settings.general.petAlwaysOnTop !== false, 'screen-saver');
  const [x, y] = petWindow.getPosition();
  petWindow.setBounds({ x, y, width: size + 156, height: size + 220 });
}

/** 保存设置后同步窗口尺寸、透明度与置顶。 */
export function applyPetSettings(): void {
  applyWindowStyle();
}

export function petPosition(): { x: number; y: number } | null {
  if (!petWindow || petWindow.isDestroyed()) return null;
  const [x, y] = petWindow.getPosition();
  return { x, y };
}

export function resetPetPosition(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const area = screen.getPrimaryDisplay().workArea;
  petWindow.setPosition(area.x + area.width - 300, area.y + area.height - 340);
}

export function movePet(x: number, y: number): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.setPosition(Math.round(x), Math.round(y));
}
