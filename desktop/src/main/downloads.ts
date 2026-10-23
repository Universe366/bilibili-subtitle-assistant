import type { DownloadItem } from 'electron';

/**
 * 活跃下载句柄表。数据库只记录状态，暂停/继续/取消需要拿到 Electron 的
 * DownloadItem；done 后必须移除，避免句柄泄漏。
 */
const items = new Map<number, DownloadItem>();

export function registerDownloadItem(id: number, item: DownloadItem): void {
  if (id > 0) items.set(id, item);
}

export function unregisterDownloadItem(id: number): void {
  items.delete(id);
}

export function controlDownload(
  id: number,
  action: 'pause' | 'resume' | 'cancel'
): { ok: boolean; state: 'paused' | 'progressing' | 'cancelled'; error?: string } {
  const item = items.get(Number(id));
  if (!item) return { ok: false, state: 'cancelled', error: '下载已结束' };
  try {
    if (action === 'pause') {
      if (!item.isPaused()) item.pause();
      return { ok: true, state: 'paused' };
    }
    if (action === 'resume') {
      if (item.canResume()) item.resume();
      return { ok: true, state: 'progressing' };
    }
    item.cancel();
    return { ok: true, state: 'cancelled' };
  } catch (error) {
    return { ok: false, state: 'cancelled', error: (error as Error).message };
  }
}
