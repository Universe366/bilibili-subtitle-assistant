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
  SearchPlatform,
  AsrPlatform,
  AppSettings,
  CorrectionRuleGroup,
  BridgeStatus,
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatRequest,
  AsrDoneEvent,
  AsrErrorEvent,
  AsrProgressEvent,
  TranslateRequest,
  TranslateProgressEvent,
  TranslateDoneEvent,
  TranslateErrorEvent,
  OptimizeSuggestion,
  OptimizeProgressEvent,
  OptimizeDoneEvent,
  OptimizeErrorEvent,
  ExportPayload,
  LayoutRect,
  PageInfo,
  Result,
  StoredSummary,
  SubtitleBundle,
  SubtitleLine,
  SummarizeRequest,
  SummaryRef,
  UpdateStatus,
  TrackBody,
  WebReference,
  LibraryIngestPayload,
  LibraryHistoryItem,
  LibraryTranscriptionItem,
  BatchProgressEvent,
  BatchDoneEvent,
  UrlBatchProgressEvent,
  UrlBatchDoneEvent,
  UrlBatchErrorEvent,
  Chapter,
  QualityReport,
  McpServer,
  McpTool,
  SkillItem,
  LibraryIngestResult,
  LibraryList,
  LibrarySearchResult
} from '../shared/types';
import type { TabManager } from './tabs';
import { getPageInfo, getSubtitles, getTime, getTrackBody, seek } from './page';
import {
  clearHistory,
  deleteHistoryItem,
  getSummaryFor,
  ingestVideo,
  listHistory,
  listTranscriptions,
  listLibrary,
  removeVideo,
  saveSummary,
  searchLibrary
} from './library';
import {
  activePlatform,
  isMaskedSecret,
  loadSettings,
  saveSettings,
  setSidebarWidth,
  setSidebarLayout,
  settingsSnapshot,
  testPlatform
} from './settings';
import { bridgeStatus, restartBridge } from './bridge';
import { checkForUpdates, downloadUpdate, installUpdate, updateStatus } from './updater';
import { summarize } from './ai';
import { chat } from './chat';
import { transcribe } from './asr';
import { translateLines } from './translate';
import { optimizeLines } from './optimize';
import { batchSummarize } from './batch';
import type { BatchControl } from './batch';
import { batchUrls, parseVideoUrls } from './urlbatch';
import { checkSubtitles } from './quality';
import { generateChapters } from './chapters';
import { callMcpTool, listMcpTools } from './mcp';
import { readSkillFile } from './skills';
import { testSearch } from './search';
import { probePlatformModels, testPlatformConnection } from './platform';
import { applyCorrectionToLines, applyCorrectionToText } from './correction';
import { buildExport, exportFilters } from './exporters';

function failure<T>(error: unknown): Result<T> {
  return { ok: false, error: (error as Error)?.message || String(error) };
}

const aiControllers = new Map<string, AbortController>();
const chatControllers = new Map<string, AbortController>();
const asrControllers = new Map<string, AbortController>();
const translateControllers = new Map<string, AbortController>();
const optimizeControllers = new Map<string, AbortController>();
const batchControllers = new Map<string, AbortController>();
const batchControls = new Map<string, BatchControl>();
const urlBatchControllers = new Map<string, AbortController>();

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
      const snapshot = settingsSnapshot();
      send('settings:changed', snapshot);
      return { ok: true, data: snapshot };
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

  ipcMain.handle(
    'platform:models',
    async (_event, payload: { kind: 'ai' | 'asr'; platform: AiPlatform | AsrPlatform }) => {
      try {
        return { ok: true, data: await probePlatformModels(payload.kind, payload.platform) };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'platform:test',
    async (
      _event,
      payload: {
        kind: 'ai' | 'asr' | 'search';
        platform: AiPlatform | AsrPlatform | SearchPlatform;
      }
    ) => {
      try {
        return { ok: true, data: await testPlatformConnection(payload.kind, payload.platform) };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle('settings:test', async (_event, platform?: AiPlatform) => {
    try {
      let target = platform || activePlatform();
      if (isMaskedSecret(target.apiKey)) {
        const saved = loadSettings().ai.platforms.find((item) => item.id === target.id);
        if (saved) target = { ...target, apiKey: saved.apiKey };
      }
      return { ok: true, data: await testPlatform(target) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'settings:sidebar-layout',
    (
      _event,
      patch: { width?: number; position?: 'left' | 'right'; collapsed?: boolean }
    ) => {
      try {
        setSidebarLayout(patch || {});
        const snapshot = settingsSnapshot();
        send('settings:changed', snapshot);
        return { ok: true, data: snapshot };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle('settings:sidebar-width', (_event, width: number) => {
    try {
      setSidebarWidth(Number(width));
      const snapshot = settingsSnapshot();
      send('settings:changed', snapshot);
      return { ok: true, data: snapshot };
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

  ipcMain.handle('chat:send', async (_event, payload: ChatRequest): Promise<Result<{ requestId: string }>> => {
    if (!payload || !payload.info || !Array.isArray(payload.lines) || payload.lines.length === 0) {
      return { ok: false, error: '没有可用的字幕内容' };
    }
    if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
      return { ok: false, error: '没有对话内容' };
    }

    const requestId = payload.requestId || randomUUID();
    const controller = new AbortController();
    chatControllers.set(requestId, controller);

    void (async () => {
      try {
        const result = await chat({
          info: payload.info,
          lines: payload.lines,
          messages: payload.messages,
          signal: controller.signal,
          onDelta: (delta) => send('chat:delta', { requestId, delta } satisfies ChatDeltaEvent),
          onReasoning: (reasoning) =>
            send('chat:delta', { requestId, delta: '', reasoning } satisfies ChatDeltaEvent)
        });
        send(
          'chat:done',
          {
            requestId,
            text: result.text,
            model: result.model,
            reasoning: result.reasoning
          } satisfies ChatDoneEvent
        );
      } catch (error) {
        const message = controller.signal.aborted ? '已取消' : (error as Error)?.message || String(error);
        console.warn('[chat] failed:', message);
        send('chat:error', { requestId, error: message } satisfies ChatErrorEvent);
      } finally {
        chatControllers.delete(requestId);
      }
    })();

    return { ok: true, data: { requestId } };
  });

  ipcMain.handle('chat:cancel', (_event, requestId: string) => {
    chatControllers.get(requestId)?.abort();
  });

  ipcMain.handle('asr:transcribe', async (_event, payload: { requestId: string }): Promise<Result<{ requestId: string }>> => {
    const wc = tabs.activeWebContents();
    if (!wc) return { ok: false, error: '当前没有活动页面' };
    const requestId = payload?.requestId || randomUUID();
    const controller = new AbortController();
    asrControllers.set(requestId, controller);

    void (async () => {
      try {
        const info = await getPageInfo(wc);
        const result = await transcribe(
          wc,
          info,
          (stage, percent, message) =>
            send('asr:progress', { requestId, stage, percent, message } satisfies AsrProgressEvent),
          controller.signal
        );
        send('asr:done', {
          requestId,
          lines: result.lines,
          model: result.model,
          duration: result.duration
        } satisfies AsrDoneEvent);
      } catch (error) {
        const message = controller.signal.aborted
          ? '已终止'
          : (error as Error)?.message || String(error);
        console.warn('[asr] failed:', message);
        send('asr:error', { requestId, error: message } satisfies AsrErrorEvent);
      } finally {
        asrControllers.delete(requestId);
      }
    })();

    return { ok: true, data: { requestId } };
  });

  ipcMain.handle('asr:cancel', (_event, requestId: string) => {
    asrControllers.get(requestId)?.abort();
  });

  ipcMain.handle('translate:start', async (_event, payload: TranslateRequest): Promise<Result<{ requestId: string }>> => {
    if (!payload || !Array.isArray(payload.lines) || payload.lines.length === 0) {
      return { ok: false, error: '没有可翻译的字幕' };
    }
    const requestId = payload.requestId || randomUUID();
    const controller = new AbortController();
    translateControllers.set(requestId, controller);

    void (async () => {
      try {
        const result = await translateLines(
          payload.lines,
          String(payload.target || '中文'),
          (percent, message) =>
            send('translate:progress', {
              requestId,
              percent,
              message
            } satisfies TranslateProgressEvent),
          controller.signal
        );
        send('translate:done', {
          requestId,
          lines: result.lines,
          language: result.language
        } satisfies TranslateDoneEvent);
      } catch (error) {
        const message = controller.signal.aborted
          ? '已终止'
          : (error as Error)?.message || String(error);
        console.warn('[translate] failed:', message);
        send('translate:error', { requestId, error: message } satisfies TranslateErrorEvent);
      } finally {
        translateControllers.delete(requestId);
      }
    })();

    return { ok: true, data: { requestId } };
  });

  ipcMain.handle('translate:cancel', (_event, requestId: string) => {
    translateControllers.get(requestId)?.abort();
  });

  ipcMain.handle('optimize:start', async (_event, payload: { requestId: string; lines: SubtitleLine[] }): Promise<Result<{ requestId: string }>> => {
    if (!payload || !Array.isArray(payload.lines) || payload.lines.length === 0) {
      return { ok: false, error: '没有可优化的字幕' };
    }
    const requestId = payload.requestId || randomUUID();
    const controller = new AbortController();
    optimizeControllers.set(requestId, controller);

    void (async () => {
      try {
        const suggestions = await optimizeLines(
          payload.lines,
          (percent, message) =>
            send('optimize:progress', {
              requestId,
              percent,
              message
            } satisfies OptimizeProgressEvent),
          controller.signal
        );
        send('optimize:done', {
          requestId,
          suggestions
        } satisfies OptimizeDoneEvent);
      } catch (error) {
        const message = controller.signal.aborted
          ? '已终止'
          : (error as Error)?.message || String(error);
        console.warn('[optimize] failed:', message);
        send('optimize:error', { requestId, error: message } satisfies OptimizeErrorEvent);
      } finally {
        optimizeControllers.delete(requestId);
      }
    })();

    return { ok: true, data: { requestId } };
  });

  ipcMain.handle('optimize:cancel', (_event, requestId: string) => {
    optimizeControllers.get(requestId)?.abort();
  });

  ipcMain.handle('batch:summarize', async (_event, payload: { requestId: string; videoIds: number[] }): Promise<Result<{ requestId: string }>> => {
    if (!payload || !Array.isArray(payload.videoIds) || !payload.videoIds.length) {
      return { ok: false, error: '没有选择视频' };
    }
    const requestId = payload.requestId || randomUUID();
    const controller = new AbortController();
    batchControllers.set(requestId, controller);
    const control: BatchControl = { paused: false, removed: new Set() };
    batchControls.set(requestId, control);

    void (async () => {
      try {
        const result = await batchSummarize(
          payload.videoIds,
          (percent, message) =>
            send('batch:progress', {
              requestId,
              percent,
              message
            } satisfies BatchProgressEvent),
          controller.signal,
          control
        );
        send('batch:done', { requestId, ...result } satisfies BatchDoneEvent);
        send('library:changed', null);
      } catch (error) {
        const message = controller.signal.aborted
          ? '已终止'
          : (error as Error)?.message || String(error);
        console.warn('[batch] failed:', message);
        send('batch:error', { requestId, error: message });
      } finally {
        batchControllers.delete(requestId);
        batchControls.delete(requestId);
      }
    })();

    return { ok: true, data: { requestId } };
  });

  ipcMain.handle('batch:pause', (_event, requestId: string) => {
    const control = batchControls.get(requestId);
    if (control) control.paused = true;
  });

  ipcMain.handle('batch:resume', (_event, requestId: string) => {
    const control = batchControls.get(requestId);
    if (control) control.paused = false;
  });

  ipcMain.handle('batch:remove', (_event, payload: { requestId: string; videoId: number }) => {
    const control = batchControls.get(payload.requestId);
    if (control) control.removed.add(Number(payload.videoId));
  });

  ipcMain.handle('batch:cancel', (_event, requestId: string) => {
    batchControllers.get(requestId)?.abort();
  });

  ipcMain.handle(
    'urlbatch:start',
    async (
      _event,
      payload: { requestId: string; urls: string[]; summarize: boolean }
    ): Promise<Result<{ requestId: string }>> => {
      const urls = (Array.isArray(payload?.urls) ? payload.urls : [])
        .flatMap((item) => parseVideoUrls(item))
        .filter((item, index, all) => all.indexOf(item) === index);
      if (!urls.length) return { ok: false, error: '没有解析到 B 站视频链接' };
      const requestId = payload.requestId || randomUUID();
      const controller = new AbortController();
      urlBatchControllers.set(requestId, controller);

      void (async () => {
        try {
          const result = await batchUrls(
            tabs,
            urls,
            payload.summarize !== false,
            (index, total, url, title, stage, percent) =>
              send('urlbatch:progress', {
                requestId,
                index,
                total,
                url,
                title,
                stage,
                percent
              } satisfies UrlBatchProgressEvent),
            controller.signal
          );
          send('urlbatch:done', { requestId, ...result } satisfies UrlBatchDoneEvent);
          send('library:changed', null);
        } catch (error) {
          const message = controller.signal.aborted
            ? '已终止'
            : (error as Error)?.message || String(error);
          console.warn('[urlbatch] failed:', message);
          send('urlbatch:error', { requestId, error: message } satisfies UrlBatchErrorEvent);
        } finally {
          urlBatchControllers.delete(requestId);
        }
      })();

      return { ok: true, data: { requestId } };
    }
  );

  ipcMain.handle('urlbatch:cancel', (_event, requestId: string) => {
    urlBatchControllers.get(requestId)?.abort();
  });

  ipcMain.handle('history:list', (): Result<LibraryHistoryItem[]> => {
    try {
      return { ok: true, data: listHistory() };
    } catch (error) {
      return failure<LibraryHistoryItem[]>(error);
    }
  });

  ipcMain.handle('history:delete', (_event, id: number): Result<{ removed: boolean }> => {
    try {
      return { ok: true, data: { removed: deleteHistoryItem(id) } };
    } catch (error) {
      return failure<{ removed: boolean }>(error);
    }
  });

  ipcMain.handle('history:transcriptions', (): Result<LibraryTranscriptionItem[]> => {
    try {
      return { ok: true, data: listTranscriptions() };
    } catch (error) {
      return failure<LibraryTranscriptionItem[]>(error);
    }
  });

  ipcMain.handle('history:clear', (): Result<{ removed: number }> => {
    try {
      return { ok: true, data: { removed: clearHistory() } };
    } catch (error) {
      return failure<{ removed: number }>(error);
    }
  });


  ipcMain.handle('mcp:test', async (_event, server: McpServer): Promise<Result<McpTool[]>> => {
    try {
      return { ok: true, data: await listMcpTools(server) };
    } catch (error) {
      return failure<McpTool[]>(error);
    }
  });

  ipcMain.handle(
    'mcp:call',
    async (
      _event,
      payload: { server: McpServer; name: string; args: Record<string, unknown> }
    ): Promise<Result<string>> => {
      try {
        return { ok: true, data: await callMcpTool(payload.server, payload.name, payload.args || {}) };
      } catch (error) {
        return failure<string>(error);
      }
    }
  );

  ipcMain.handle('skills:import', async (): Promise<Result<SkillItem | null>> => {
    try {
      const picked = await dialog.showOpenDialog(win, {
        title: '导入 SKILL.md',
        properties: ['openFile'],
        filters: [{ name: 'Skill', extensions: ['md'] }]
      });
      const file = picked.filePaths[0];
      if (picked.canceled || !file) return { ok: true, data: null };
      return { ok: true, data: readSkillFile(file) };
    } catch (error) {
      return failure<SkillItem | null>(error);
    }
  });

  ipcMain.handle(
    'quality:check',
    (_event, payload: { info: PageInfo; lines: SubtitleLine[] }): Result<QualityReport> => {
      try {
        if (!payload || !payload.info || !Array.isArray(payload.lines)) {
          throw new Error('缺少字幕数据');
        }
        return { ok: true, data: checkSubtitles(payload.info, payload.lines) };
      } catch (error) {
        return failure<QualityReport>(error);
      }
    }
  );

  ipcMain.handle(
    'chapters:generate',
    async (_event, payload: { info: PageInfo; lines: SubtitleLine[] }): Promise<Result<Chapter[]>> => {
      try {
        if (!payload || !payload.info || !Array.isArray(payload.lines) || !payload.lines.length) {
          throw new Error('缺少字幕数据');
        }
        return { ok: true, data: await generateChapters(payload.info, payload.lines) };
      } catch (error) {
        return failure<Chapter[]>(error);
      }
    }
  );

  ipcMain.handle('search:test', async (_event, query: string): Promise<Result<WebReference[]>> => {
    try {
      const q = String(query || '').trim() || 'B站 视频 总结';
      return { ok: true, data: await testSearch(loadSettings(), q) };
    } catch (error) {
      return failure<WebReference[]>(error);
    }
  });

  ipcMain.handle('rules:export', async (_event, group: CorrectionRuleGroup) => {
    try {
      const result = await dialog.showSaveDialog({
        defaultPath: `${String(group?.name || '字幕规则组').replace(/[\/:*?"<>|]/g, '_')}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePath) return { ok: true, data: { canceled: true } };
      fs.writeFileSync(
        result.filePath,
        JSON.stringify({ version: 1, groups: [group] }, null, 2),
        'utf8'
      );
      return { ok: true, data: { canceled: false, path: result.filePath } };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('rules:import', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePaths.length) {
        return { ok: true, data: [] as CorrectionRuleGroup[] };
      }
      const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
      const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.groups) ? parsed.groups : [];
      const groups: CorrectionRuleGroup[] = rows
        .filter((row: any) => row && typeof row === 'object')
        .map((row: any, index: number) => ({
          id: `group_${Date.now().toString(36)}_${index}`,
          name: String(row.name || `导入规则组 ${index + 1}`).slice(0, 80),
          enabled: row.enabled !== false,
          rules: (Array.isArray(row.rules) ? row.rules : [])
            .filter((rule: any) => rule && typeof rule === 'object')
            .map((rule: any, ruleIndex: number) => ({
              id: `rule_${Date.now().toString(36)}_${ruleIndex}`,
              pattern: String(rule.pattern ?? rule.from ?? ''),
              replacement: String(rule.replacement ?? rule.to ?? ''),
              regex: rule.regex === true,
              caseSensitive: rule.caseSensitive === true
            }))
        }));
      return { ok: true, data: groups };
    } catch (error) {
      return failure(error);
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
          filenamePattern: payload.filenamePattern || settings.export.filenamePattern,
          template: payload.template || settings.export.template,
          assFontSize: payload.assFontSize || settings.export.assFontSize,
          estimateTimestamps:
            payload.estimateTimestamps ?? settings.export.estimateTimestamps
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
