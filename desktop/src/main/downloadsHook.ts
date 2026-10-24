import { app, session } from 'electron';
import type { BrowserWindow, DownloadItem } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { addDownload, updateDownload } from './library';
import { registerDownloadItem, unregisterDownloadItem } from './downloads';

/**
 * 浏览器下载 → 本地库记录。
 *
 * 保存位置：`BSUB_DOWNLOAD_DIR` 存在时直接落到该目录（自动化测试用），
 * 否则弹保存对话框；进度按 500ms 节流写库，完成/取消/中断时强制落一次。
 */
export function installDownloadHook(getWindow: () => BrowserWindow | null): void {
  const notify = () => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('downloads:changed');
  };

  session.defaultSession.on('will-download', (_event, item: DownloadItem) => {
    const autoDir = String(process.env.BSUB_DOWNLOAD_DIR || '').trim();
    if (autoDir) {
      try {
        fs.mkdirSync(autoDir, { recursive: true });
        item.setSavePath(path.join(autoDir, item.getFilename()));
      } catch (error) {
        console.warn('[download] 自动保存路径不可用:', (error as Error).message);
      }
    } else {
      item.setSaveDialogOptions({
        title: '保存文件',
        defaultPath: path.join(app.getPath('downloads'), item.getFilename())
      });
    }

    let downloadId = 0;
    try {
      downloadId = addDownload({
        url: item.getURL(),
        filename: item.getFilename(),
        total: item.getTotalBytes()
      });
      if (downloadId) registerDownloadItem(downloadId, item);
      notify();
    } catch (error) {
      console.warn('[download] 登记失败:', (error as Error).message);
    }

    let lastWrite = 0;
    const sync = (
      state: 'progressing' | 'completed' | 'cancelled' | 'interrupted',
      done = false
    ) => {
      if (!downloadId) return;
      const now = Date.now();
      if (!done && now - lastWrite < 500) return;
      lastWrite = now;
      try {
        updateDownload(downloadId, {
          state,
          total: item.getTotalBytes(),
          received: item.getReceivedBytes(),
          path: item.getSavePath(),
          finished: done
        });
      } catch (error) {
        console.warn('[download] 更新失败:', (error as Error).message);
      }
      notify();
    };

    item.on('updated', (_event, state) => {
      sync(state === 'interrupted' ? 'interrupted' : 'progressing');
    });
    item.on('done', (_event, state) => {
      if (state === 'completed') sync('completed', true);
      else if (state === 'cancelled') sync('cancelled', true);
      else sync('interrupted', true);
      unregisterDownloadItem(downloadId);
    });
  });
}
