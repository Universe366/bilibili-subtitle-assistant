import type { BrowserWindow } from 'electron';

import type { TabManager } from './tabs';

import { registerBrowserIpc } from './ipc/browser';
import { registerRecordsIpc } from './ipc/records';
import { registerSettingsIpc } from './ipc/settings';
import { registerToolsIpc } from './ipc/tools';
import { registerPageIpc } from './ipc/page';
import { registerJobsIpc } from './ipc/jobs';
import { registerLibraryIpc } from './ipc/library';
import { registerMediaIpc } from './ipc/media';
import { registerShotIpc } from './ipc/shot';
import { abortControllers } from './ipc/shared';
import type { IpcContext } from './ipc/shared';

const { ai: aiControllers } = abortControllers;

export function registerIpc(win: BrowserWindow, tabs: TabManager): void {
  const send = (channel: string, payload: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };
  const ctx: IpcContext = { win, send, tabs, aiControllers };
  registerJobsIpc(ctx);

  registerBrowserIpc(ctx);

  registerPageIpc(ctx);

  registerLibraryIpc(ctx);

  registerSettingsIpc(ctx);

  registerMediaIpc(ctx);

  registerShotIpc();

  registerToolsIpc(ctx);

  registerRecordsIpc(ctx);

  // 渲染进程加载完成后补发一次当前标签状态
  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send('tabs:changed', tabs.list());
  });
}
