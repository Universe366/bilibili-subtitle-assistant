import { ipcMain, session, shell } from 'electron';
import type {
  Bookmark,
  DownloadRecord,
  HistoryEntry,
  LayoutRect,
  Result
} from '../../shared/types';
import {
  clearBrowseHistory,
  clearDownloads,
  deleteDownload,
  isBookmarked,
  listBookmarks,
  listBrowseHistory,
  listDownloads,
  removeBookmark,
  toggleBookmark,
  updateDownload
} from '../library';
import { controlDownload } from '../downloads';
import { seek } from '../page';
import { failure, withStartParam, type IpcContext } from './shared';

/** 标签页 / 书签 / 下载 / 浏览历史 / 布局 相关 IPC。 */
export function registerBrowserIpc(ctx: IpcContext): void {
  ipcMain.handle('tabs:list', () => ctx.tabs.list());
  ipcMain.handle('tab:new', (_event, url?: string) => ctx.tabs.create(url));
  ipcMain.handle('tab:open', async (_event, url: string, start?: number) => {
    const time = Number(start);
    const safeTime = Number.isFinite(time) && time > 0 ? Math.floor(time) : 0;
    // 新标签靠 URL 的 t 参数落点；复用标签不会被重新导航，下面再补 seek。
    const target = withStartParam(String(url || ''), safeTime);
    const result = await ctx.tabs.openOrActivate(target);
    if (result.reused && result.ready && safeTime > 0) {
      const wc = ctx.tabs.webContentsOf(result.id);
      if (wc) {
        try {
          await seek(wc, safeTime);
        } catch (error) {
          console.warn('[tab] seek 失败:', (error as Error).message);
        }
      }
    }
    return result;
  });
  ipcMain.handle('media:playing', async () => {
    const wc = ctx.tabs.activeWebContents();
    if (!wc) return { ok: true as const, data: false };
    try {
      const playing = await wc.executeJavaScript(
        '(() => { const v = document.querySelector("video, audio"); return Boolean(v && !v.paused && !v.ended && v.readyState > 2); })()'
      );
      return { ok: true as const, data: playing === true };
    } catch {
      return { ok: true as const, data: false };
    }
  });
  ipcMain.handle('media:toggle', async () => {
    const wc = ctx.tabs.activeWebContents();
    if (!wc) return { ok: true as const, data: { playing: false } };
    try {
      const playing = await wc.executeJavaScript(
        `(() => {
          const v = document.querySelector('video, audio');
          if (!v) return false;
          if (v.paused || v.ended) {
            const started = v.play();
            if (started && typeof started.catch === 'function') started.catch(() => {});
            return true;
          }
          v.pause();
          return false;
        })()`
      );
      return { ok: true as const, data: { playing: playing === true } };
    } catch {
      return { ok: true as const, data: { playing: false } };
    }
  });
  ipcMain.handle('media:set-rate', async (_event, rate: number) => {
    return { ok: true as const, data: await ctx.tabs.setPlaybackRate(rate) };
  });
  ipcMain.handle('tab:set-visible', (_event, visible: boolean) => {
    ctx.tabs.setActiveViewVisible(visible !== false);
  });
  ipcMain.handle('tab:pin', (_event, id: string, pinned: boolean) => {
    ctx.tabs.pin(id, pinned === true);
  });
  ipcMain.handle('tab:move', (_event, id: string, index: number) => {
    ctx.tabs.move(id, index);
  });
  ipcMain.handle('tab:close', (_event, id: string) => {
    ctx.tabs.close(id);
  });
  ipcMain.handle('tab:activate', async (_event, id: string) => {
    await ctx.tabs.activate(id);
  });
  ipcMain.handle('tab:navigate', (_event, url: string) => {
    ctx.tabs.navigate(url);
  });
  ipcMain.handle('tab:back', () => {
    ctx.tabs.back();
  });
  ipcMain.handle('tab:forward', () => {
    ctx.tabs.forward();
  });
  ipcMain.handle('tab:reload', () => {
    ctx.tabs.reload();
  });
  ipcMain.handle('tab:stop', () => {
    ctx.tabs.stop();
  });
  ipcMain.handle('tab:zoom-in', () => {
    ctx.tabs.zoomIn();
  });
  ipcMain.handle('tab:zoom-out', () => {
    ctx.tabs.zoomOut();
  });
  ipcMain.handle('tab:zoom-reset', () => {
    ctx.tabs.zoomReset();
  });
  ipcMain.handle(
    'tab:find',
    (_event, query: string, options?: { forward?: boolean; findNext?: boolean }) => {
      ctx.tabs.findInPage(query, options || {});
    }
  );
  ipcMain.handle('tab:stop-find', () => {
    ctx.tabs.stopFind();
  });
  ipcMain.handle('tab:reopen-closed', async (): Promise<string | null> => ctx.tabs.reopenClosed());

  ipcMain.handle(
    'browse-history:list',
    (_event, query?: string, limit?: number): Result<HistoryEntry[]> => {
      try {
        return { ok: true, data: listBrowseHistory(String(query || ''), Number(limit) || 100) };
      } catch (error) {
        return failure<HistoryEntry[]>(error);
      }
    }
  );

  ipcMain.handle('browse-history:clear', (): Result<{ removed: number }> => {
    try {
      return { ok: true, data: { removed: clearBrowseHistory() } };
    } catch (error) {
      return failure<{ removed: number }>(error);
    }
  });

  ipcMain.handle('bookmarks:list', (): Result<Bookmark[]> => {
    try {
      return { ok: true, data: listBookmarks() };
    } catch (error) {
      return failure<Bookmark[]>(error);
    }
  });

  ipcMain.handle('bookmarks:check', (_event, url: string): Result<{ bookmarked: boolean }> => {
    try {
      return { ok: true, data: { bookmarked: isBookmarked(String(url || '')) } };
    } catch (error) {
      return failure<{ bookmarked: boolean }>(error);
    }
  });

  ipcMain.handle(
    'bookmarks:toggle',
    (
      _event,
      payload: { url: string; title?: string; favicon?: string | null }
    ): Result<{
      bookmarked: boolean;
    }> => {
      try {
        return { ok: true, data: toggleBookmark(payload || { url: '' }) };
      } catch (error) {
        return failure<{ bookmarked: boolean }>(error);
      }
    }
  );

  ipcMain.handle('bookmarks:remove', (_event, url: string): Result<{ removed: boolean }> => {
    try {
      return { ok: true, data: { removed: removeBookmark(String(url || '')) } };
    } catch (error) {
      return failure<{ removed: boolean }>(error);
    }
  });

  ipcMain.handle('downloads:list', (): Result<DownloadRecord[]> => {
    try {
      return { ok: true, data: listDownloads() };
    } catch (error) {
      return failure<DownloadRecord[]>(error);
    }
  });

  ipcMain.handle('downloads:delete', (_event, id: number): Result<{ removed: boolean }> => {
    try {
      return { ok: true, data: { removed: deleteDownload(Number(id)) } };
    } catch (error) {
      return failure<{ removed: boolean }>(error);
    }
  });

  ipcMain.handle('downloads:clear', (): Result<{ removed: number }> => {
    try {
      return { ok: true, data: { removed: clearDownloads() } };
    } catch (error) {
      return failure<{ removed: number }>(error);
    }
  });

  ipcMain.handle(
    'downloads:control',
    (
      _event,
      payload: { id: number; action: 'pause' | 'resume' | 'cancel' }
    ): Result<{ state: string }> => {
      try {
        const result = controlDownload(Number(payload?.id), payload?.action);
        if (!result.ok) return { ok: false, error: result.error || '下载已结束' };
        updateDownload(Number(payload.id), {
          state: result.state,
          finished: result.state === 'cancelled'
        });
        ctx.send('downloads:changed', null);
        return { ok: true, data: { state: result.state } };
      } catch (error) {
        return failure<{ state: string }>(error);
      }
    }
  );

  ipcMain.handle('browser:clear-data', async (): Promise<Result<{ cleared: boolean }>> => {
    try {
      const ses = session.defaultSession;
      await ses.clearStorageData({
        storages: [
          'cookies',
          'filesystem',
          'indexdb',
          'localstorage',
          'shadercache',
          'serviceworkers',
          'cachestorage'
        ]
      });
      await ses.clearCache();
      await ses.clearAuthCache();
      return { ok: true, data: { cleared: true } };
    } catch (error) {
      return failure<{ cleared: boolean }>(error);
    }
  });

  ipcMain.handle('downloads:open', async (_event, id: number): Promise<Result<boolean>> => {
    try {
      const item = listDownloads(300).find((row) => row.id === Number(id));
      if (!item?.path) return { ok: false, error: '文件还没有保存到本地' };
      const error = await shell.openPath(item.path);
      return error ? { ok: false, error } : { ok: true, data: true };
    } catch (error) {
      return failure<boolean>(error);
    }
  });

  ipcMain.handle('downloads:reveal', (_event, id: number): Result<boolean> => {
    try {
      const item = listDownloads(300).find((row) => row.id === Number(id));
      if (!item?.path) return { ok: false, error: '文件还没有保存到本地' };
      shell.showItemInFolder(item.path);
      return { ok: true, data: true };
    } catch (error) {
      return failure<boolean>(error);
    }
  });
  ipcMain.on('layout:set', (_event, rect: LayoutRect) => {
    ctx.tabs.setLayout(rect);
  });
}
