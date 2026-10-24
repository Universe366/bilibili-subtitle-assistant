import { BrowserWindow, desktopCapturer, screen } from 'electron';
import path from 'node:path';
import type { NativeImage } from 'electron';
import { toImageRect, type Rect } from '../shared/shotGeometry';

/**
 * 框选截图：全屏覆盖窗 + 拖拽选框 + 选框旁的三个动作。
 *
 * 流程：
 * 1. 桌宠调用 `beginRegionCapture()`，主进程截下光标所在显示器；
 * 2. 覆盖窗把截图铺满屏幕，用户拖出一个矩形；
 * 3. 用户点「识别图片 / 对话 / 提取文字」；
 * 4. 主进程按 HiDPI 比例裁剪位图，把 data URL 和动作一起回给桌宠。
 */

export type ShotAction = 'image' | 'chat' | 'ocr';

export interface ShotResult {
  action: ShotAction;
  dataUrl: string;
  width: number;
  height: number;
}

export interface ShotSelection {
  selection: Rect | null;
  action: ShotAction;
}

interface PendingShot {
  image: NativeImage;
  cssSize: { width: number; height: number };
  resolve: (result: ShotResult | null) => void;
}

let overlay: BrowserWindow | null = null;
let pending: PendingShot | null = null;
let timeout: NodeJS.Timeout | null = null;
let overlayImageUrl = '';

const TIMEOUT_MS = 120_000;

function settle(result: ShotResult | null): void {
  const current = pending;
  pending = null;
  if (timeout) {
    clearTimeout(timeout);
    timeout = null;
  }
  current?.resolve(result);
  closeOverlay();
}

export function closeOverlay(): void {
  overlayImageUrl = '';
  if (overlay && !overlay.isDestroyed()) overlay.close();
  overlay = null;
}

/** 覆盖窗加载后向它要背景图与尺寸。 */
export function shotOverlayPayload(): { dataUrl: string; width: number; height: number } | null {
  if (!pending) return null;
  return {
    dataUrl: overlayImageUrl,
    width: pending.cssSize.width,
    height: pending.cssSize.height
  };
}

/** 覆盖窗回传选中区域与动作；selection 为 null 表示取消。 */
export function completeRegionCapture(input: ShotSelection | null): void {
  if (!pending) return;
  if (!input || !input.selection) {
    settle(null);
    return;
  }
  const { image, cssSize } = pending;
  const size = image.getSize();
  const rect = toImageRect(input.selection, cssSize, size);
  let dataUrl = '';
  try {
    dataUrl = image.crop(rect).toDataURL();
  } catch (error) {
    console.warn('[shot] crop failed:', (error as Error).message);
    settle(null);
    return;
  }
  settle({ action: input.action, dataUrl, width: rect.width, height: rect.height });
}

/** 桌宠发起框选；用户取消返回 null。 */
export async function beginRegionCapture(): Promise<ShotResult | null> {
  if (pending) return null;
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const scale = display.scaleFactor || 1;
  const thumbnailSize = {
    width: Math.max(1, Math.round(display.size.width * scale)),
    height: Math.max(1, Math.round(display.size.height * scale))
  };

  let image: NativeImage | null = null;
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
    const source =
      sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
    if (source && !source.thumbnail.isEmpty()) image = source.thumbnail;
  } catch (error) {
    console.warn('[shot] desktopCapturer failed:', (error as Error).message);
  }
  if (!image) return null;

  overlayImageUrl = image.toDataURL();
  const cssSize = { width: display.size.width, height: display.size.height };

  return new Promise<ShotResult | null>((resolve) => {
    pending = { image: image as NativeImage, cssSize, resolve };
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: cssSize.width,
      height: cssSize.height,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      backgroundColor: '#000000',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    });
    overlay = win;
    win.setAlwaysOnTop(true, 'screen-saver');
    try {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {
      // 老系统不支持，忽略
    }
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) {
      void win.loadURL(`${rendererUrl}?window=shot`);
    } else {
      void win.loadFile(path.join(__dirname, '../renderer/index.html'), {
        query: { window: 'shot' }
      });
    }
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });
    win.on('closed', () => {
      overlay = null;
      if (pending) settle(null);
    });
    win.webContents.on('render-process-gone', () => {
      if (pending) settle(null);
    });

    timeout = setTimeout(() => settle(null), TIMEOUT_MS);
  });
}
