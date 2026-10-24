import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { loadSettings, saveSettings } from './settings';
import {
  clampRectToArea,
  defaultPetRect,
  nearestWorkArea,
  normalizePetSize,
  petLayoutSize,
  snapRectToEdges,
  type PetLayoutMode,
  type Rect
} from './petGeometry';

let petWindow: BrowserWindow | null = null;
let saveTimer: NodeJS.Timeout | null = null;
let layoutMode: PetLayoutMode = 'compact';

function workAreas(): Rect[] {
  return screen.getAllDisplays().map((display) => display.workArea);
}

function areaFor(point: { x: number; y: number } | null): Rect {
  const primary = screen.getPrimaryDisplay().workArea;
  return nearestWorkArea(point, workAreas()) || primary;
}

/** 当前窗口矩形；窗口不存在时用默认右下角位置兜底。 */
function currentRect(): Rect {
  const petSize = normalizePetSize(loadSettings().general.petSize);
  if (!petWindow || petWindow.isDestroyed()) {
    return defaultPetRect(petSize, screen.getPrimaryDisplay().workArea, layoutMode);
  }
  const [x, y] = petWindow.getPosition();
  const [width, height] = petWindow.getSize();
  return { x, y, width, height };
}

/** 保存位置（写设置前先夹到可见区域，避免拔掉副屏后桌宠“消失”）。 */
function persistPosition(): void {
  const rect = currentRect();
  const area = areaFor({ x: rect.x + Math.round(rect.width / 2), y: rect.y + Math.round(rect.height / 2) });
  const bounded = clampRectToArea(rect, area);
  if (bounded.x !== rect.x || bounded.y !== rect.y) {
    petWindow?.setPosition(bounded.x, bounded.y);
  }
  const settings = loadSettings();
  settings.general.petX = bounded.x;
  settings.general.petY = bounded.y;
  saveSettings(settings);
}

function schedulePersist(delay = 400): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistPosition();
  }, delay);
}

function initialRect(): Rect {
  const settings = loadSettings();
  const petSize = normalizePetSize(settings.general.petSize);
  const saved =
    settings.general.petX || settings.general.petY
      ? { x: settings.general.petX, y: settings.general.petY }
      : null;
  const area = areaFor(saved);
  const size_ = petLayoutSize(layoutMode, petSize);
  if (saved) {
    return clampRectToArea({ ...size_, x: saved.x, y: saved.y }, area);
  }
  return defaultPetRect(petSize, area, layoutMode);
}

/** 桌宠窗口：透明、无边框、置顶、不进任务栏；尺寸随内容伸缩。 */
export function openPetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.showInactive();
    return;
  }
  const rect = initialRect();
  petWindow = new BrowserWindow({
    ...rect,
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
  // 用系统拖拽（-webkit-app-region: drag）移动时也要落盘；渲染层主动拖拽会走 pet:drop。
  petWindow.on('moved', () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    schedulePersist();
  });
  petWindow.on('closed', () => {
    petWindow = null;
  });
  const onDisplaysChanged = () => layoutPetWindow();
  screen.on('display-metrics-changed', onDisplaysChanged);
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  petWindow.on('closed', () => {
    screen.removeListener('display-metrics-changed', onDisplaysChanged);
    screen.removeListener('display-added', onDisplaysChanged);
    screen.removeListener('display-removed', onDisplaysChanged);
  });
  console.log('[pet] window opened', `${rect.width}x${rect.height}`, layoutMode);
}

export function closePetWindow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
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

/** 按当前布局模式重排窗口：保持左上角，尺寸随内容变化，并夹在可见区域内。 */
export function layoutPetWindow(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const settings = loadSettings();
  const petSize = normalizePetSize(settings.general.petSize);
  const size = petLayoutSize(layoutMode, petSize);
  const [x, y] = petWindow.getPosition();
  const area = areaFor({ x: x + Math.round(size.width / 2), y: y + Math.round(size.height / 2) });
  const bounded = clampRectToArea({ x, y, ...size }, area);
  petWindow.setBounds(bounded);
}

/** 渲染层切换气泡/挂件/菜单时调用。 */
export function setPetLayout(mode: PetLayoutMode): void {
  const allowed: PetLayoutMode[] = ['compact', 'bubble', 'widget', 'menu'];
  layoutMode = allowed.includes(mode) ? mode : 'compact';
  layoutPetWindow();
}

export function petLayout(): PetLayoutMode {
  return layoutMode;
}

function applyWindowStyle(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const settings = loadSettings();
  petWindow.setOpacity(Math.min(1, Math.max(0.4, settings.general.petOpacity ?? 1)));
  petWindow.setAlwaysOnTop(settings.general.petAlwaysOnTop !== false, 'screen-saver');
  layoutPetWindow();
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
  const petSize = normalizePetSize(loadSettings().general.petSize);
  const area = screen.getPrimaryDisplay().workArea;
  const rect = defaultPetRect(petSize, area, layoutMode);
  petWindow.setBounds(rect);
  persistPosition();
}

/** 拖拽过程中的实时移动：夹在当前显示器工作区内，防止拖出屏幕。 */
export function movePet(x: number, y: number): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const [width, height] = petWindow.getSize();
  const area = areaFor({ x, y });
  const bounded = clampRectToArea({ x: Math.round(x), y: Math.round(y), width, height }, area);
  petWindow.setPosition(bounded.x, bounded.y);
}

/** 松手：吸附屏幕边缘 + 立即保存位置。 */
export function dropPet(x: number, y: number): { x: number; y: number } | null {
  if (!petWindow || petWindow.isDestroyed()) return null;
  const [width, height] = petWindow.getSize();
  const area = areaFor({ x, y });
  const snapped = snapRectToEdges({ x: Math.round(x), y: Math.round(y), width, height }, area);
  petWindow.setPosition(snapped.x, snapped.y);
  persistPosition();
  return { x: snapped.x, y: snapped.y };
}

/** 右键菜单里的「置顶」开关：立即生效并写回设置。 */
export function setPetAlwaysOnTop(enabled: boolean): boolean {
  const settings = loadSettings();
  settings.general.petAlwaysOnTop = enabled;
  saveSettings(settings);
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setAlwaysOnTop(enabled, 'screen-saver');
  }
  return enabled;
}
