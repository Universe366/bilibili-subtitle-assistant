import { app, Menu, nativeImage, Tray } from 'electron';
import type { TabManager } from './tabs';
import { saveSession } from './session';

/**
 * 启动外壳里可以独立出来的两小块：
 * - 托盘创建（图标解析由调用方负责，找不到图标时静默跳过）
 * - 会话延迟保存（1.5s 合并写入，避免每次标签变化都落盘）
 */

export interface TrayOptions {
  iconPath: string | null;
  tooltip: string;
  onShow: () => void;
  onQuit: () => void;
}

export function createTray(options: TrayOptions): Tray | null {
  const { iconPath, tooltip, onShow, onQuit } = options;
  if (!iconPath) {
    console.warn('[tray] 找不到 tray.png，跳过托盘');
    return null;
  }
  try {
    const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    const tray = new Tray(image);
    tray.setToolTip(tooltip);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: onShow },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            app.quit();
            onQuit();
          }
        }
      ])
    );
    tray.on('double-click', onShow);
    console.log('[tray] ready');
    return tray;
  } catch (error) {
    console.warn('[tray] 创建失败:', (error as Error).message);
    return null;
  }
}

export interface SessionPersister {
  persist: () => void;
  schedule: () => void;
  dispose: () => void;
}

/** 会话保存：标签变化后延迟 1.5s 写盘，退出时由调用方主动 persist。 */
export function createSessionPersister(
  getManager: () => TabManager | null,
  delayMs = 1500
): SessionPersister {
  let timer: NodeJS.Timeout | null = null;

  const persist = () => {
    try {
      const manager = getManager();
      if (!manager) return;
      const snapshot = manager.sessionSnapshot();
      if (snapshot.tabs.length) saveSession(snapshot.tabs, snapshot.activeUrl);
    } catch (error) {
      console.warn('[session] 保存失败:', (error as Error).message);
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(persist, delayMs);
  };

  const dispose = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return { persist, schedule, dispose };
}
