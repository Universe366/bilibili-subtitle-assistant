import type { BrowserWindow } from 'electron';
import { app, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AiDeltaEvent,
  AiDoneEvent,
  AiErrorEvent,
  AiStatusEvent,
  AiPlatform,
  AppSettings,
  BridgeStatus,
  ExportPayload,
  LayoutRect,
  PageInfo,
  Result,
  StoredSummary,
  SubtitleBundle,
  SummarizeRequest,
  SummaryRef,
  UpdateStatus,
  TrackBody,
  WebReference,
  LibraryIngestPayload,
  LibraryIngestResult,
  LibraryList,
  LibrarySearchResult
} from '../shared/types';
import type { TabManager } from './tabs';
import { getPageInfo, getSubtitles, getTime, getTrackBody, seek } from './page';
import { getSummaryFor, ingestVideo, listLibrary, removeVideo, saveSummary, searchLibrary } from './library';
import { activePlatform, loadSettings, saveSettings, settingsSnapshot, testPlatform } from './settings';
import { bridgeStatus, restartBridge } from './bridge';
import { checkForUpdates, downloadUpdate, installUpdate, updateStatus } from './updater';
import { summarize } from './ai';
import { testSearch } from './search';
import { applyCorrectionToLines, applyCorrectionToText } from './correction';
import { buildExport, exportFilters } from './exporters';

function failure<T>(error: unknown): Result<T> {
  return { ok: false, error: (error as Error)?.message || String(error) };
}

const aiControllers = new Map<string, AbortController>();

export function registerIpc(win: BrowserWindow, tabs: TabManager): void {
  const send = (channel: string, payload: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };
  ipcMain.handle('tabs:list', () => tabs.list());
  ipcMain.handle('tab:new', (_event, url?: string) => tabs.create(url));
  ipcMain.handle('tab:close', (_event, id: string) => {
    tabs.close(id);
  });
  ipcMain.handle('tab:activate', async (_event, id: string) => {
    await tabs.activate(id);
  });
  ipcMain.handle('tab:navigate', (_event, url: string) => {
    tabs.navigate(url);
  });
  ipcMain.handle('tab:back', () => {
    tabs.back();
  });
  ipcMain.handle('tab:forward', () => {
    tabs.forward();
  });
  ipcMain.handle('tab:reload', () => {
    tabs.reload();
  });
  ipcMain.handle('tab:stop', () => {
    tabs.stop();
  });
  ipcMain.handle('tab:zoom-in', () => {
    tabs.zoomIn();
  });
  ipcMain.handle('tab:zoom-out', () => {
    tabs.zoomOut();
  });
  ipcMain.handle('tab:zoom-reset', () => {
    tabs.zoomReset();
  });
  ipcMain.handle('tab:find', (_event, query: string, options?: { forward?: boolean; findNext?: boolean }) => {
    tabs.findInPage(query, options || {});
  });
  ipcMain.handle('tab:stop-find', () => {
    tabs.stopFind();
  });
  ipcMain.on('layout:set', (_event, rect: LayoutRect) => {
    tabs.setLayout(rect);
  });

  ipcMain.handle('page:info', async (): Promise<Result<PageInfo>> => {
    const wc = tabs.activeWebContents();
    if (!wc) return { ok: false, error: '没有打开的页面' };
    try {
      const info = await getPageInfo(wc);
      console.log('[m2] info', info.bvid, info.title, `duration=${info.duration}`);
      return { ok: true, data: info };
    } catch (error) {
      console.warn('[m2] info failed:', (error as Error).message);
      return failure<PageInfo>(error);
    }
  });

  ipcMain.handle('page:subtitles', async (): Promise<Result<SubtitleBundle>> => {
    const wc = tabs.activeWebContents();
    if (!wc) return { ok: false, error: '没有打开的页面' };
    try {
      const bundle = await getSubtitles(wc);
      console.log(
        '[m2] subtitles',
        `tracks=${bundle.tracks.length}`,
        `needLogin=${bundle.needLogin}`,
        `sources=${bundle.sources.join(',')}`
      );
      console.log(
        '[m2] tracks',
        bundle.tracks.map((track) => `${track.lan}/${track.lanDoc}#${track.url.slice(-10)}`).join(' ')
      );
      return { ok: true, data: bundle };
    } catch (error) {
      console.warn('[m2] subtitles failed:', (error as Error).message);
      return failure<SubtitleBundle>(error);
    }
  });

  ipcMain.handle('page:track-body', async (_event, url: string): Promise<Result<TrackBody>> => {
    try {
      const body = await getTrackBody(url);
      const bodyCorrected = {
        ...body,
        lines: applyCorrectionToLines(body.lines, loadSettings())
      };
      console.log('[m2] track body', `lines=${bodyCorrected.lines.length}`, url.slice(0, 90));
      if (bodyCorrected.lines.length) {
        const first = bodyCorrected.lines[0];
        const last = bodyCorrected.lines[bodyCorrected.lines.length - 1];
        console.log(
          '[m2] track range',
          `start=${first.start}`,
          `end=${last.end}`,
          JSON.stringify({ first: first.text, last: last.text })
        );
      }
      return { ok: true, data: bodyCorrected };
    } catch (error) {
      console.warn('[m2] track body failed:', (error as Error).message);
      return failure<TrackBody>(error);
    }
  });

  ipcMain.handle('page:time', async (): Promise<Result<{ currentTime: number; duration: number }>> => {
    const wc = tabs.activeWebContents();
    if (!wc) return { ok: false, error: '没有打开的页面' };
    try {
      return { ok: true, data: await getTime(wc) };
    } catch (error) {
      return failure<{ currentTime: number; duration: number }>(error);
    }
  });

  ipcMain.handle('page:seek', async (_event, time: number): Promise<void> => {
    const wc = tabs.activeWebContents();
    if (!wc) return;
    try {
      await seek(wc, time);
    } catch (error) {
      console.warn('[m2] seek failed:', (error as Error).message);
    }
  });

  ipcMain.handle('library:ingest', async (_event, payload: LibraryIngestPayload): Promise<Result<LibraryIngestResult>> => {
    try {
      // 字幕读取时已经套过校对规则；这里不再重复应用，避免 A→AA 被放大。
      const result = ingestVideo(payload);
      console.log(
        '[m3] ingest',
        `video=${result.videoId}`,
        `track=${result.trackId}`,
        `lines=${result.lineCount}`,
        `created=${result.created}`
      );
      if (!win.isDestroyed()) win.webContents.send('library:changed');
      return { ok: true, data: result };
    } catch (error) {
      console.warn('[m3] ingest failed:', (error as Error).message);
      return failure<LibraryIngestResult>(error);
    }
  });

  ipcMain.handle('library:list', async (): Promise<Result<LibraryList>> => {
    try {
      return { ok: true, data: listLibrary() };
    } catch (error) {
      return failure<LibraryList>(error);
    }
  });

  ipcMain.handle('library:search', async (_event, query: string): Promise<Result<LibrarySearchResult>> => {
    try {
      return { ok: true, data: searchLibrary(query) };
    } catch (error) {
      return failure<LibrarySearchResult>(error);
    }
  });

  ipcMain.handle('library:remove', async (_event, id: number): Promise<Result<{ removed: boolean }>> => {
    try {
      const removed = removeVideo(id);
      if (removed && !win.isDestroyed()) win.webContents.send('library:changed');
      return { ok: true, data: { removed } };
    } catch (error) {
      return failure<{ removed: boolean }>(error);
    }
  });

  ipcMain.handle('library:get-summary', async (_event, ref: SummaryRef): Promise<Result<StoredSummary | null>> => {
    try {
      return { ok: true, data: getSummaryFor(ref) };
    } catch (error) {
      return failure<StoredSummary | null>(error);
    }
  });

  ipcMain.handle('settings:get', (): Result<ReturnType<typeof settingsSnapshot>> => {
    try {
      return { ok: true, data: settingsSnapshot() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('settings:set', async (_event, next: AppSettings): Promise<Result<ReturnType<typeof settingsSnapshot>>> => {
    try {
      const saved = saveSettings(next);
      nativeTheme.themeSource = saved.general.theme;
      tabs.setSuspendMinutes(saved.general.suspendMinutes);
      await restartBridge(win);
      return { ok: true, data: settingsSnapshot() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'settings:export',
    async (): Promise<Result<{ canceled: boolean; path?: string }>> => {
      try {
        const result = await dialog.showSaveDialog(win, {
          title: '导出设置',
          defaultPath: path.join(app.getPath('documents'), 'bsub-settings.json'),
          filters: [{ name: 'JSON', extensions: ['json'] }]
        });
        if (result.canceled || !result.filePath) return { ok: true, data: { canceled: true } };
        fs.writeFileSync(result.filePath, JSON.stringify(loadSettings(), null, 2), 'utf8');
        return { ok: true, data: { canceled: false, path: result.filePath } };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'settings:import',
    async (): Promise<
      Result<{ canceled: boolean; snapshot?: ReturnType<typeof settingsSnapshot> }>
    > => {
      try {
        const result = await dialog.showOpenDialog(win, {
          title: '导入设置',
          properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }]
        });
        const file = result.filePaths[0];
        if (result.canceled || !file) return { ok: true, data: { canceled: true } };
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as AppSettings;
        const saved = saveSettings(raw);
        nativeTheme.themeSource = saved.general.theme;
        tabs.setSuspendMinutes(saved.general.suspendMinutes);
        await restartBridge(win);
        return { ok: true, data: { canceled: false, snapshot: settingsSnapshot() } };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle('bridge:status', (): Result<BridgeStatus> => {
    try {
      return { ok: true, data: bridgeStatus() };
    } catch (error) {
      return failure<BridgeStatus>(error);
    }
  });

  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(String(text ?? ''));
  });

  ipcMain.handle('update:status', (): Result<UpdateStatus> => {
    try {
      return { ok: true, data: updateStatus() };
    } catch (error) {
      return failure<UpdateStatus>(error);
    }
  });

  ipcMain.handle('update:check', async (): Promise<Result<UpdateStatus>> => {
    try {
      return { ok: true, data: await checkForUpdates(true) };
    } catch (error) {
      return failure<UpdateStatus>(error);
    }
  });

  ipcMain.handle('update:download', async (): Promise<Result<UpdateStatus>> => {
    try {
      return { ok: true, data: await downloadUpdate() };
    } catch (error) {
      return failure<UpdateStatus>(error);
    }
  });

  ipcMain.handle('update:install', () => {
    installUpdate();
  });

  ipcMain.handle('settings:test', async (_event, platform?: AiPlatform) => {
    try {
      const target = platform || activePlatform();
      return { ok: true, data: await testPlatform(target) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('settings:open-data', async () => {
    await shell.openPath(app.getPath('userData'));
  });

  ipcMain.handle(
    'ai:summarize',
    async (
      _event,
      payload: SummarizeRequest
    ): Promise<Result<{ requestId: string }>> => {
      if (!payload || !payload.info || !Array.isArray(payload.lines) || payload.lines.length === 0) {
        return { ok: false, error: '没有可用的字幕内容' };
      }

      const requestId = payload.requestId || randomUUID();
      const controller = new AbortController();
      aiControllers.set(requestId, controller);

      void (async () => {
        try {
          const result = await summarize({
            info: payload.info,
            lines: payload.lines,
            signal: controller.signal,
            onDelta: (delta) => send('ai:delta', { requestId, delta } satisfies AiDeltaEvent),
            onStatus: (status) => send('ai:status', { requestId, status } satisfies AiStatusEvent)
          });
          const saved = saveSummary(payload.info, result.text, result.model);
          send('ai:done', { requestId, text: result.text, model: result.model } satisfies AiDoneEvent);
          send('library:changed', null);
          console.log('[m4] summary saved', saved.id, `chars=${result.text.length}`);
        } catch (error) {
          const message = controller.signal.aborted
            ? '已取消'
            : (error as Error)?.message || String(error);
          console.warn('[m4] summary failed:', message);
          send('ai:error', { requestId, error: message } satisfies AiErrorEvent);
        } finally {
          aiControllers.delete(requestId);
        }
      })();

      return { ok: true, data: { requestId } };
    }
  );

  ipcMain.handle('ai:cancel', (_event, requestId: string) => {
    aiControllers.get(requestId)?.abort();
  });

  ipcMain.handle('search:test', async (_event, query: string): Promise<Result<WebReference[]>> => {
    try {
      const q = String(query || '').trim() || 'B站 视频 总结';
      return { ok: true, data: await testSearch(loadSettings(), q) };
    } catch (error) {
      return failure<WebReference[]>(error);
    }
  });

  ipcMain.handle('correction:preview', (_event, text: string, settings?: AppSettings): Result<string> => {
    try {
      return {
        ok: true,
        data: applyCorrectionToText(String(text || ''), settings || loadSettings())
      };
    } catch (error) {
      return failure<string>(error);
    }
  });

  ipcMain.handle(
    'export:save',
    async (
      _event,
      payload: ExportPayload
    ): Promise<Result<{ path: string } | { canceled: true }>> => {
      try {
        if (!payload || !payload.info) throw new Error('缺少视频信息');
        const settings = loadSettings();
        const built = buildExport({
          ...payload,
          includeTimestamps: payload.includeTimestamps ?? settings.export.includeTimestamps,
          filenamePattern: payload.filenamePattern || settings.export.filenamePattern
        });
        let target = payload.savePath;

        if (!target) {
          const picked = await dialog.showSaveDialog(win, {
            title: '导出',
            defaultPath: path.join(app.getPath('documents'), `${built.filename}.${built.ext}`),
            filters: exportFilters(payload.format)
          });
          if (picked.canceled || !picked.filePath) {
            return { ok: true, data: { canceled: true } };
          }
          target = picked.filePath;
        }

        fs.writeFileSync(target, built.content, 'utf8');
        console.log('[m4] exported', payload.format, target, `chars=${built.content.length}`);
        return { ok: true, data: { path: target } };
      } catch (error) {
        return failure<{ path: string } | { canceled: true }>(error);
      }
    }
  );

  // 渲染进程加载完成后补发一次当前标签状态
  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send('tabs:changed', tabs.list());
  });
}
