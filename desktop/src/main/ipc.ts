import type { BrowserWindow } from 'electron';
import { app, clipboard, dialog, ipcMain, nativeTheme, Notification, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AiDeltaEvent,
  AiDoneEvent,
  AiErrorEvent,
  AiStatusEvent,
  AiReasoningEvent,
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
  SummaryVersion,
  SummaryVersionMeta,
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
  BatchErrorEvent,
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
  LibrarySearchResult,
  LibraryDetail,
  LibrarySort,
  LibraryTag,
  LibraryCollection,
  LibraryNote,
  NoteVersion,
  NoteVersionMeta,
  CollectionSummary,
  CollectionSummaryVersion,
  CollectionSummaryVersionMeta,
  CollectionResolveResult,
  ExportRecord,
  JobRecord,
  GlobalSearchResult,
  HistoryEntry,
  Bookmark,
  DownloadRecord
} from '../shared/types';
import type { TabManager } from './tabs';
import {
  getPageInfo,
  getSubtitles,
  getTime,
  getTrackBody,
  seek,
  triggerSubtitleMenu
} from './page';
import {
  addCollectionToVideos,
  addExportRecord,
  addTagToVideos,
  addVideoToCollection,
  clearExports,
  clearFinishedJobs,
  clearBrowseHistory,
  clearHistory,
  listBrowseHistory,
  clearDownloads,
  clearTrash,
  createCollection,
  createJob,
  createJobItem,
  deleteCollection,
  deleteDownload,
  deleteExport,
  deleteHistoryItem,
  deleteTag,
  deleteTrash,
  finishJob,
  isBookmarked,
  listBookmarks,
  listDownloads,
  removeBookmark,
  toggleBookmark,
  getCollectionSummary,
  getCollectionSummaryVersion,
  getJob,
  getLibraryDetail,
  getNote,
  getNoteVersion,
  getSummaryFor,
  getSummaryVersion,
  globalSearch,
  ingestVideo,
  listCollections,
  listCollectionSummaryVersions,
  listExports,
  listHistory,
  listJobs,
  listNoteVersions,
  listSummaryVersions,
  listTags,
  listTranscriptions,
  listTrash,
  listLibrary,
  removeVideo,
  removeVideos,
  removeVideoFromCollection,
  renameCollection,
  renameTag,
  restoreCollectionSummaryVersion,
  restoreSummaryVersion,
  restoreTrash,
  saveNote,
  saveSummary,
  searchLibrary,
  setJobsListener,
  setVideoTags,
  updateJob,
  updateJobItem,
  vacuumLibrary
} from './library';
import { summarizeCollection } from './collectionSummary';
import { resolveBilibiliCollection } from './biliCollection';
import {
  activePlatform,
  isMaskedSecret,
  loadSettings,
  saveSettings,
  setSidebarWidth,
  setSidebarLayout,
  settingsForExport,
  settingsSnapshot,
  testPlatform
} from './settings';
import { exportDiagnostics } from './diagnostics';
import { clearSitePermissions } from './permissions';
import { pageContextSummary, readPageContext } from './pageContext';
import { bridgeStatus, restartBridge } from './bridge';
import { installBrowserExtension } from './extension-install';
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  skipUpdate,
  updateStatus
} from './updater';
import { summarize } from './ai';
import { chat } from './chat';
import { transcribe, transcribeFile } from './asr';
import { probeDuration } from './media';
import { downloadPodcastAudio, loadPodcastFeed } from './podcast';
import { pathToFileURL, fileURLToPath } from 'node:url';
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
import { backupData, restoreData } from './backup';
import { changeDataDir } from './dataDir';
import { applyCorrectionToLines, applyCorrectionToText } from './correction';
import { buildExport, exportFilters } from './exporters';

function failure<T>(error: unknown): Result<T> {
  return { ok: false, error: (error as Error)?.message || String(error) };
}

// 任务记录是旁路能力：写库失败不能把总结/转录本身带崩。
function trackJob(action: () => void): void {
  try {
    action();
  } catch (error) {
    console.warn('[jobs] 记录失败:', (error as Error).message);
  }
}

function withStartParam(url: string, seconds: number): string {
  if (!url || !(seconds > 0)) return url;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return url;
    parsed.searchParams.set('t', String(Math.floor(seconds)));
    return parsed.toString();
  } catch {
    return url;
  }
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
  // 长任务结束时如果窗口不在前台，用系统通知提醒；点击回到任务中心。
  let trackedRunning = new Map<string, { title: string; createdAt: number }>();

  const showJobNotification = (job: JobRecord) => {
    try {
      if (!Notification.isSupported() || win.isFocused()) return;
      if (Date.now() - job.createdAt < 5000) return;
      const status =
        job.status === 'done' ? '完成' : job.status === 'cancelled' ? '已停止' : '失败';
      const body = [job.message, job.error].filter(Boolean).join(' · ').slice(0, 180);
      const notification = new Notification({
        title: `任务${status}：${job.title}`,
        body: body || '点击查看任务中心',
        silent: false
      });
      notification.on('click', () => {
        if (win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        send('app:tasks', null);
      });
      notification.show();
      console.log('[jobs] notified', job.id, job.status);
    } catch (error) {
      console.warn('[jobs] 通知失败:', (error as Error).message);
    }
  };

  setJobsListener(() => {
    const jobs = listJobs();
    send('jobs:changed', jobs);

    const nextRunning = new Map<string, { title: string; createdAt: number }>();
    for (const job of jobs) {
      if (job.status === 'running' || job.status === 'paused') {
        nextRunning.set(job.id, { title: job.title, createdAt: job.createdAt });
      }
    }
    if (!win.isFocused()) {
      for (const [id, previous] of trackedRunning) {
        if (nextRunning.has(id)) continue;
        const job = jobs.find((item) => item.id === id);
        if (!job || (job.status !== 'done' && job.status !== 'failed')) continue;
        if (Date.now() - previous.createdAt < 5000) continue;
        showJobNotification(job);
      }
    }
    trackedRunning = nextRunning;
  });

  const markJobUnfinished = (
    jobId: string,
    status: 'skipped' | 'failed',
    message: string,
    error?: string
  ) => {
    const job = getJob(jobId);
    if (!job) return;
    for (const item of job.items) {
      if (item.status === 'pending' || item.status === 'running') {
        trackJob(() =>
          updateJobItem(jobId, item.targetId, {
            status,
            message,
            error: error == null ? undefined : error
          })
        );
      }
    }
  };

  const markJobCancelled = (jobId: string) => {
    markJobUnfinished(jobId, 'skipped', '已取消');
  };

  const startBatchSummary = (
    inputIds: number[],
    requestIdInput?: string,
    concurrencyInput?: number
  ): Result<{ requestId: string }> => {
    const ids = [
      ...new Set(
        (Array.isArray(inputIds) ? inputIds : []).filter((id) => Number.isFinite(id) && id > 0)
      )
    ];
    if (!ids.length) return { ok: false, error: '没有选择视频' };
    const concurrency = Math.min(4, Math.max(1, Math.round(Number(concurrencyInput) || 1)));

    const requestId = requestIdInput || randomUUID();
    const controller = new AbortController();
    batchControllers.set(requestId, controller);
    const control: BatchControl = { paused: false, removed: new Set() };
    batchControls.set(requestId, control);

    const titles = new Map(listLibrary().videos.map((video) => [video.id, video.title]));
    trackJob(() =>
      createJob({
        id: requestId,
        type: 'batch-summary',
        title: `批量总结 · ${ids.length} 个视频`,
        meta: { concurrency }
      })
    );
    for (const id of ids) {
      trackJob(() => createJobItem(requestId, String(id), titles.get(id) || `#${id}`));
    }

    void (async () => {
      try {
        const result = await batchSummarize(
          ids,
          (percent, message) => {
            trackJob(() => updateJob(requestId, { progress: percent, message }));
            send('batch:progress', {
              requestId,
              percent,
              message
            } satisfies BatchProgressEvent);
          },
          controller.signal,
          control,
          {
            onItemStart: (videoId, title) =>
              trackJob(() =>
                updateJobItem(requestId, String(videoId), {
                  title,
                  status: 'running',
                  message: '总结中…'
                })
              ),
            onItemDone: (videoId) =>
              trackJob(() =>
                updateJobItem(requestId, String(videoId), {
                  status: 'done',
                  progress: 100,
                  message: '完成',
                  error: null
                })
              ),
            onItemFail: (videoId, _title, error) =>
              trackJob(() =>
                updateJobItem(requestId, String(videoId), {
                  status: 'failed',
                  progress: 100,
                  message: '失败',
                  error
                })
              ),
            onItemSkip: (videoId) =>
              trackJob(() =>
                updateJobItem(requestId, String(videoId), {
                  status: 'skipped',
                  message: '已移除'
                })
              )
          },
          { concurrency }
        );

        if (result.cancelled) {
          markJobCancelled(requestId);
          trackJob(() =>
            finishJob(
              requestId,
              'cancelled',
              null,
              `已停止：成功 ${result.succeeded}，失败 ${result.failed.length}`
            )
          );
        } else if (!result.succeeded && result.failed.length) {
          trackJob(() =>
            finishJob(
              requestId,
              'failed',
              result.failed[0]?.error || null,
              `全部失败（${result.failed.length} 项）`
            )
          );
        } else {
          trackJob(() =>
            finishJob(
              requestId,
              'done',
              null,
              `成功 ${result.succeeded}，失败 ${result.failed.length}`
            )
          );
        }
        send('batch:done', { requestId, ...result } satisfies BatchDoneEvent);
        send('library:changed', null);
      } catch (error) {
        const message = controller.signal.aborted
          ? '已终止'
          : (error as Error)?.message || String(error);
        console.warn('[batch] failed:', message);
        markJobUnfinished(
          requestId,
          controller.signal.aborted ? 'skipped' : 'failed',
          controller.signal.aborted ? '已取消' : '任务中断',
          controller.signal.aborted ? undefined : message
        );
        trackJob(() =>
          finishJob(requestId, controller.signal.aborted ? 'cancelled' : 'failed', message)
        );
        send('batch:error', { requestId, error: message } satisfies BatchErrorEvent);
      } finally {
        batchControllers.delete(requestId);
        batchControls.delete(requestId);
      }
    })();

    return { ok: true, data: { requestId } };
  };

  const startUrlBatch = (
    rawUrls: string[],
    withSummary: boolean,
    requestIdInput?: string
  ): Result<{ requestId: string }> => {
    const urls = parseVideoUrls((Array.isArray(rawUrls) ? rawUrls : []).join('\n'));
    if (!urls.length) return { ok: false, error: '没有解析到 B 站视频链接' };

    const requestId = requestIdInput || randomUUID();
    const controller = new AbortController();
    urlBatchControllers.set(requestId, controller);
    trackJob(() =>
      createJob({
        id: requestId,
        type: 'url-batch',
        title: `链接批量 · ${urls.length} 个`,
        meta: { summarize: withSummary }
      })
    );
    for (const url of urls) {
      trackJob(() => createJobItem(requestId, url, url));
    }

    void (async () => {
      try {
        const result = await batchUrls(
          tabs,
          urls,
          withSummary,
          (index, total, url, title, stage, percent) => {
            const overall = total > 0 ? ((index + percent / 100) / total) * 100 : 0;
            trackJob(() =>
              updateJob(requestId, {
                progress: overall,
                message: `${stage}${title ? ` · ${title}` : ''}`
              })
            );
            if (title) {
              trackJob(() =>
                updateJobItem(requestId, url, { title, status: 'running', message: stage })
              );
            }
            send('urlbatch:progress', {
              requestId,
              index,
              total,
              url,
              title,
              stage,
              percent
            } satisfies UrlBatchProgressEvent);
          },
          controller.signal,
          {
            onItemStart: (url, title) =>
              trackJob(() =>
                updateJobItem(requestId, url, {
                  status: 'running',
                  message: '开始',
                  ...(title ? { title } : {})
                })
              ),
            onItemDone: (url, title) =>
              trackJob(() =>
                updateJobItem(requestId, url, {
                  title: title || undefined,
                  status: 'done',
                  progress: 100,
                  message: '完成',
                  error: null
                })
              ),
            onItemFail: (url, title, error) =>
              trackJob(() =>
                updateJobItem(requestId, url, {
                  title: title || undefined,
                  status: 'failed',
                  progress: 100,
                  message: '失败',
                  error
                })
              )
          }
        );

        if (result.cancelled) {
          markJobCancelled(requestId);
          trackJob(() =>
            finishJob(
              requestId,
              'cancelled',
              null,
              `已停止：成功 ${result.succeeded}，失败 ${result.failed.length}`
            )
          );
        } else if (!result.succeeded && result.failed.length) {
          trackJob(() =>
            finishJob(
              requestId,
              'failed',
              result.failed[0]?.error || null,
              `全部失败（${result.failed.length} 项）`
            )
          );
        } else {
          trackJob(() =>
            finishJob(
              requestId,
              'done',
              null,
              `成功 ${result.succeeded}，失败 ${result.failed.length}`
            )
          );
        }
        send('urlbatch:done', { requestId, ...result } satisfies UrlBatchDoneEvent);
        send('library:changed', null);
      } catch (error) {
        const message = controller.signal.aborted
          ? '已终止'
          : (error as Error)?.message || String(error);
        console.warn('[urlbatch] failed:', message);
        markJobUnfinished(
          requestId,
          controller.signal.aborted ? 'skipped' : 'failed',
          controller.signal.aborted ? '已取消' : '任务中断',
          controller.signal.aborted ? undefined : message
        );
        trackJob(() =>
          finishJob(requestId, controller.signal.aborted ? 'cancelled' : 'failed', message)
        );
        send('urlbatch:error', { requestId, error: message } satisfies UrlBatchErrorEvent);
      } finally {
        urlBatchControllers.delete(requestId);
      }
    })();

    return { ok: true, data: { requestId } };
  };

  ipcMain.handle('jobs:list', (): Result<ReturnType<typeof listJobs>> => {
    try {
      return { ok: true, data: listJobs() };
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle('jobs:get', (_event, id: string) => {
    try {
      return { ok: true, data: getJob(String(id)) };
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle('jobs:cancel', (_event, id: string) => {
    const key = String(id || '');
    const controller =
      aiControllers.get(key) ||
      asrControllers.get(key) ||
      translateControllers.get(key) ||
      optimizeControllers.get(key) ||
      batchControllers.get(key) ||
      urlBatchControllers.get(key);
    controller?.abort();
    const job = getJob(key);
    if (job && (job.status === 'running' || job.status === 'paused')) {
      trackJob(() => updateJob(key, { status: 'cancelled', message: '正在停止…' }));
    }
  });
  ipcMain.handle('jobs:retry', (_event, id: string): Result<{ requestId: string }> => {
    const job = getJob(String(id));
    if (!job) return { ok: false, error: '任务不存在' };
    const failed = job.items
      .filter((item) => item.status === 'failed')
      .map((item) => item.targetId);
    if (!failed.length) return { ok: false, error: '没有失败项' };
    if (job.type === 'batch-summary') {
      let concurrency = 1;
      try {
        concurrency = Number(JSON.parse(job.metaJson || '{}').concurrency) || 1;
      } catch {
        // 旧任务没有 meta，按串行重试
      }
      return startBatchSummary(failed.map(Number), undefined, concurrency);
    }
    if (job.type === 'url-batch') {
      let summarize = true;
      try {
        summarize = JSON.parse(job.metaJson || '{}').summarize !== false;
      } catch {
        // 旧任务没有 meta，按默认处理
      }
      return startUrlBatch(failed, summarize);
    }
    return { ok: false, error: '这类任务暂不支持重试' };
  });
  ipcMain.handle('jobs:clear-finished', () => {
    try {
      return { ok: true, data: { removed: clearFinishedJobs() } };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('tabs:list', () => tabs.list());
  ipcMain.handle('tab:new', (_event, url?: string) => tabs.create(url));
  ipcMain.handle('tab:open', async (_event, url: string, start?: number) => {
    const time = Number(start);
    const safeTime = Number.isFinite(time) && time > 0 ? Math.floor(time) : 0;
    // 新标签靠 URL 的 t 参数落点；复用标签不会被重新导航，下面再补 seek。
    const target = withStartParam(String(url || ''), safeTime);
    const result = await tabs.openOrActivate(target);
    if (result.reused && result.ready && safeTime > 0) {
      const wc = tabs.webContentsOf(result.id);
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
  ipcMain.handle(
    'tab:find',
    (_event, query: string, options?: { forward?: boolean; findNext?: boolean }) => {
      tabs.findInPage(query, options || {});
    }
  );
  ipcMain.handle('tab:stop-find', () => {
    tabs.stopFind();
  });
  ipcMain.handle('tab:reopen-closed', async (): Promise<string | null> => tabs.reopenClosed());

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
    tabs.setLayout(rect);
  });

  ipcMain.handle('page:context', async () => {
    try {
      const context = await readPageContext(tabs.activeWebContents());
      return { ok: true as const, data: pageContextSummary(context) };
    } catch (error) {
      return failure(error);
    }
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

  ipcMain.handle(
    'source:resolve-collection',
    async (_event, input: string): Promise<Result<CollectionResolveResult>> => {
      try {
        return { ok: true, data: await resolveBilibiliCollection(String(input || '')) };
      } catch (error) {
        return failure<CollectionResolveResult>(error);
      }
    }
  );

  ipcMain.handle(
    'page:subtitles',
    async (_event, expectSignature?: string): Promise<Result<SubtitleBundle>> => {
      const wc = tabs.activeWebContents();
      if (!wc) return { ok: false, error: '没有打开的页面' };
      try {
        const bundle = await getSubtitles(wc, String(expectSignature || '') || undefined);
        console.log(
          '[m2] subtitles',
          `tracks=${bundle.tracks.length}`,
          `needLogin=${bundle.needLogin}`,
          `sources=${bundle.sources.join(',')}`
        );
        console.log(
          '[m2] tracks',
          bundle.tracks
            .map((track) => `${track.lan}/${track.lanDoc}#${track.url.slice(-10)}`)
            .join(' ')
        );
        return { ok: true, data: bundle };
      } catch (error) {
        console.warn('[m2] subtitles failed:', (error as Error).message);
        return failure<SubtitleBundle>(error);
      }
    }
  );

  ipcMain.handle('page:trigger-subtitle', async (): Promise<Result<boolean>> => {
    const wc = tabs.activeWebContents();
    if (!wc) return { ok: false, error: '没有打开的页面' };
    try {
      await triggerSubtitleMenu(wc);
      return { ok: true, data: true };
    } catch (error) {
      return failure<boolean>(error);
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

  ipcMain.handle(
    'page:time',
    async (): Promise<Result<{ currentTime: number; duration: number }>> => {
      const wc = tabs.activeWebContents();
      if (!wc) return { ok: false, error: '没有打开的页面' };
      try {
        return { ok: true, data: await getTime(wc) };
      } catch (error) {
        return failure<{ currentTime: number; duration: number }>(error);
      }
    }
  );

  ipcMain.handle('page:seek', async (_event, time: number): Promise<void> => {
    const wc = tabs.activeWebContents();
    if (!wc) return;
    try {
      await seek(wc, time);
    } catch (error) {
      console.warn('[m2] seek failed:', (error as Error).message);
    }
  });

  ipcMain.handle(
    'library:ingest',
    async (_event, payload: LibraryIngestPayload): Promise<Result<LibraryIngestResult>> => {
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
    }
  );

  ipcMain.handle('library:list', async (_event, sort?: string): Promise<Result<LibraryList>> => {
    try {
      return { ok: true, data: listLibrary(sort as LibrarySort) };
    } catch (error) {
      return failure<LibraryList>(error);
    }
  });

  ipcMain.handle('library:get', async (_event, id: number): Promise<Result<LibraryDetail>> => {
    try {
      return { ok: true, data: getLibraryDetail(Number(id)) };
    } catch (error) {
      return failure<LibraryDetail>(error);
    }
  });

  ipcMain.handle('library:note', (_event, videoId: number): Result<LibraryNote | null> => {
    try {
      return { ok: true, data: getNote(Number(videoId)) };
    } catch (error) {
      return failure<LibraryNote | null>(error);
    }
  });

  ipcMain.handle(
    'library:note-save',
    (_event, payload: { videoId: number; content: string }): Result<LibraryNote | null> => {
      try {
        return {
          ok: true,
          data: saveNote(Number(payload?.videoId), String(payload?.content || ''))
        };
      } catch (error) {
        return failure<LibraryNote | null>(error);
      }
    }
  );

  ipcMain.handle('library:note-versions', (_event, videoId: number): Result<NoteVersionMeta[]> => {
    try {
      return { ok: true, data: listNoteVersions(Number(videoId)) };
    } catch (error) {
      return failure<NoteVersionMeta[]>(error);
    }
  });

  ipcMain.handle('library:note-version', (_event, id: number): Result<NoteVersion | null> => {
    try {
      return { ok: true, data: getNoteVersion(Number(id)) };
    } catch (error) {
      return failure<NoteVersion | null>(error);
    }
  });

  ipcMain.handle(
    'library:search',
    async (_event, query: string): Promise<Result<LibrarySearchResult>> => {
      try {
        return { ok: true, data: searchLibrary(query) };
      } catch (error) {
        return failure<LibrarySearchResult>(error);
      }
    }
  );

  ipcMain.handle('search:global', (_event, query: string): Result<GlobalSearchResult> => {
    try {
      return { ok: true, data: globalSearch(String(query || '')) };
    } catch (error) {
      return failure<GlobalSearchResult>(error);
    }
  });

  ipcMain.handle(
    'library:remove',
    async (_event, id: number): Promise<Result<{ removed: boolean }>> => {
      try {
        const removed = removeVideo(id);
        if (removed && !win.isDestroyed()) win.webContents.send('library:changed');
        return { ok: true, data: { removed } };
      } catch (error) {
        return failure<{ removed: boolean }>(error);
      }
    }
  );

  ipcMain.handle(
    'library:save-page-summary',
    (
      _event,
      payload: { title: string; url: string; content: string; model?: string }
    ): Result<{ videoId: number; created: boolean }> => {
      try {
        const url = String(payload?.url || '').trim();
        const content = String(payload?.content || '').trim();
        if (!/^https?:\/\//i.test(url)) return { ok: false, error: '只能保存网页地址' };
        if (!content) return { ok: false, error: '总结内容为空' };
        const info: PageInfo = {
          kind: 'page',
          bvid: null,
          aid: null,
          cid: null,
          epId: null,
          seasonId: null,
          page: 1,
          partTitle: '',
          parts: [],
          title: String(payload?.title || url).slice(0, 300),
          owner: '',
          desc: '',
          duration: 0,
          url,
          signature: `u:${url}`
        };
        const saved = saveSummary(info, content, String(payload?.model || 'AI'));
        send('library:changed', null);
        return { ok: true, data: { videoId: saved.videoId, created: !saved.updated } };
      } catch (error) {
        return failure<{ videoId: number; created: boolean }>(error);
      }
    }
  );

  ipcMain.handle('library:open-source', async (_event, id: number): Promise<Result<boolean>> => {
    try {
      const detail = getLibraryDetail(Number(id));
      const url = detail.video.url;
      if (/^https?:\/\//i.test(url)) {
        await shell.openExternal(url);
        return { ok: true, data: true };
      }
      if (!/^file:\/\//i.test(url)) return { ok: false, error: '这个条目没有可打开的来源' };
      const file = fileURLToPath(url);
      if (!fs.existsSync(file)) return { ok: false, error: '本地文件已被移动或删除' };
      const error = await shell.openPath(file);
      return error ? { ok: false, error } : { ok: true, data: true };
    } catch (error) {
      return failure<boolean>(error);
    }
  });

  ipcMain.handle('library:tags', (): Result<LibraryTag[]> => {
    try {
      return { ok: true, data: listTags() };
    } catch (error) {
      return failure<LibraryTag[]>(error);
    }
  });

  ipcMain.handle(
    'library:set-tags',
    (_event, payload: { videoId: number; tags: string[] }): Result<{ tags: string[] }> => {
      try {
        const tags = setVideoTags(Number(payload?.videoId), payload?.tags || []);
        send('library:changed', null);
        return { ok: true, data: { tags } };
      } catch (error) {
        return failure<{ tags: string[] }>(error);
      }
    }
  );

  ipcMain.handle(
    'library:tag-rename',
    (_event, payload: { name: string; newName: string }): Result<{ renamed: boolean }> => {
      try {
        renameTag(String(payload?.name || ''), String(payload?.newName || ''));
        send('library:changed', null);
        return { ok: true, data: { renamed: true } };
      } catch (error) {
        return failure<{ renamed: boolean }>(error);
      }
    }
  );

  ipcMain.handle('library:tag-delete', (_event, name: string): Result<{ removed: boolean }> => {
    try {
      const removed = deleteTag(String(name || ''));
      send('library:changed', null);
      return { ok: true, data: { removed } };
    } catch (error) {
      return failure<{ removed: boolean }>(error);
    }
  });

  ipcMain.handle(
    'library:bulk-tag',
    (_event, payload: { videoIds: number[]; name: string }): Result<{ linked: number }> => {
      try {
        const linked = addTagToVideos(payload?.videoIds || [], String(payload?.name || ''));
        send('library:changed', null);
        return { ok: true, data: { linked } };
      } catch (error) {
        return failure<{ linked: number }>(error);
      }
    }
  );

  ipcMain.handle(
    'library:bulk-collection',
    (_event, payload: { videoIds: number[]; name: string }): Result<{ linked: number }> => {
      try {
        const linked = addCollectionToVideos(payload?.videoIds || [], String(payload?.name || ''));
        send('library:changed', null);
        return { ok: true, data: { linked } };
      } catch (error) {
        return failure<{ linked: number }>(error);
      }
    }
  );

  ipcMain.handle(
    'library:bulk-remove',
    (_event, payload: { videoIds: number[] }): Result<{ removed: number }> => {
      try {
        const removed = removeVideos(payload?.videoIds || []);
        if (removed) send('library:changed', null);
        return { ok: true, data: { removed } };
      } catch (error) {
        return failure<{ removed: number }>(error);
      }
    }
  );

  ipcMain.handle('trash:list', (): Result<ReturnType<typeof listTrash>> => {
    try {
      return { ok: true, data: listTrash() };
    } catch (error) {
      return failure<ReturnType<typeof listTrash>>(error);
    }
  });

  ipcMain.handle('trash:restore', (_event, id: number): Result<{ videoId: number }> => {
    try {
      const restored = restoreTrash(Number(id));
      send('library:changed', null);
      return { ok: true, data: restored };
    } catch (error) {
      return failure<{ videoId: number }>(error);
    }
  });

  ipcMain.handle('trash:delete', (_event, id: number): Result<{ removed: boolean }> => {
    try {
      return { ok: true, data: { removed: deleteTrash(Number(id)) } };
    } catch (error) {
      return failure<{ removed: boolean }>(error);
    }
  });

  ipcMain.handle('trash:clear', (): Result<{ removed: number }> => {
    try {
      return { ok: true, data: { removed: clearTrash() } };
    } catch (error) {
      return failure<{ removed: number }>(error);
    }
  });

  ipcMain.handle('library:vacuum', (): Result<{ before: number; after: number }> => {
    try {
      return { ok: true, data: vacuumLibrary() };
    } catch (error) {
      return failure<{ before: number; after: number }>(error);
    }
  });

  ipcMain.handle('library:collections', (): Result<LibraryCollection[]> => {
    try {
      return { ok: true, data: listCollections() };
    } catch (error) {
      return failure<LibraryCollection[]>(error);
    }
  });

  ipcMain.handle(
    'library:collection-add',
    (_event, payload: { videoId: number; name: string }): Result<{ collections: string[] }> => {
      try {
        const collections = addVideoToCollection(
          Number(payload?.videoId),
          String(payload?.name || '')
        );
        send('library:changed', null);
        return { ok: true, data: { collections } };
      } catch (error) {
        return failure<{ collections: string[] }>(error);
      }
    }
  );

  ipcMain.handle(
    'library:collection-remove',
    (_event, payload: { videoId: number; name: string }): Result<{ collections: string[] }> => {
      try {
        const collections = removeVideoFromCollection(
          Number(payload?.videoId),
          String(payload?.name || '')
        );
        send('library:changed', null);
        return { ok: true, data: { collections } };
      } catch (error) {
        return failure<{ collections: string[] }>(error);
      }
    }
  );

  ipcMain.handle(
    'library:collection-rename',
    (_event, payload: { id: number; name: string }): Result<{ renamed: boolean }> => {
      try {
        renameCollection(Number(payload?.id), String(payload?.name || ''));
        send('library:changed', null);
        return { ok: true, data: { renamed: true } };
      } catch (error) {
        return failure<{ renamed: boolean }>(error);
      }
    }
  );

  ipcMain.handle(
    'library:collection-delete',
    (_event, id: number): Result<{ removed: boolean }> => {
      try {
        const removed = deleteCollection(Number(id));
        send('library:changed', null);
        return { ok: true, data: { removed } };
      } catch (error) {
        return failure<{ removed: boolean }>(error);
      }
    }
  );

  ipcMain.handle('library:collection-create', (_event, name: string): Result<LibraryCollection> => {
    try {
      const collection = createCollection(String(name || ''));
      send('library:changed', null);
      return { ok: true, data: collection };
    } catch (error) {
      return failure<LibraryCollection>(error);
    }
  });

  ipcMain.handle(
    'collection:summary',
    (_event, collectionId: number): Result<CollectionSummary | null> => {
      try {
        return { ok: true, data: getCollectionSummary(Number(collectionId)) };
      } catch (error) {
        return failure<CollectionSummary | null>(error);
      }
    }
  );

  ipcMain.handle(
    'collection:summarize',
    async (_event, collectionId: number): Promise<Result<{ requestId: string }>> => {
      try {
        const id = Number(collectionId);
        const collection = listCollections().find((item) => item.id === id);
        if (!collection) return { ok: false, error: '合集不存在' };
        if (!collection.count) return { ok: false, error: '合集里还没有视频' };

        const requestId = randomUUID();
        const controller = new AbortController();
        aiControllers.set(requestId, controller);
        trackJob(() =>
          createJob({
            id: requestId,
            type: 'collection-summary',
            title: `合集对比 · ${collection.name}`,
            meta: { collectionId: id }
          })
        );

        void (async () => {
          try {
            const summary = await summarizeCollection(id, controller.signal, (status) => {
              trackJob(() => updateJob(requestId, { message: status }));
            });
            trackJob(() =>
              finishJob(
                requestId,
                'done',
                null,
                `完成 · ${summary.content.length.toLocaleString('zh-CN')} 字`
              )
            );
            send('collection:summary-done', { collectionId: id, summary });
          } catch (error) {
            const message = controller.signal.aborted
              ? '已取消'
              : (error as Error)?.message || String(error);
            console.warn('[collection-summary] failed:', message);
            trackJob(() =>
              finishJob(requestId, controller.signal.aborted ? 'cancelled' : 'failed', message)
            );
            send('collection:summary-error', { collectionId: id, error: message });
          } finally {
            aiControllers.delete(requestId);
          }
        })();

        return { ok: true, data: { requestId } };
      } catch (error) {
        return failure<{ requestId: string }>(error);
      }
    }
  );

  ipcMain.handle(
    'collection:summary-versions',
    (_event, collectionId: number): Result<CollectionSummaryVersionMeta[]> => {
      try {
        return { ok: true, data: listCollectionSummaryVersions(Number(collectionId)) };
      } catch (error) {
        return failure<CollectionSummaryVersionMeta[]>(error);
      }
    }
  );

  ipcMain.handle(
    'collection:summary-version',
    (_event, id: number): Result<CollectionSummaryVersion | null> => {
      try {
        return { ok: true, data: getCollectionSummaryVersion(Number(id)) };
      } catch (error) {
        return failure<CollectionSummaryVersion | null>(error);
      }
    }
  );

  ipcMain.handle('collection:summary-restore', (_event, id: number): Result<CollectionSummary> => {
    try {
      return { ok: true, data: restoreCollectionSummaryVersion(Number(id)) };
    } catch (error) {
      return failure<CollectionSummary>(error);
    }
  });

  ipcMain.handle(
    'library:get-summary',
    async (_event, ref: SummaryRef): Promise<Result<StoredSummary | null>> => {
      try {
        return { ok: true, data: getSummaryFor(ref) };
      } catch (error) {
        return failure<StoredSummary | null>(error);
      }
    }
  );

  ipcMain.handle(
    'library:summary-versions',
    (_event, videoId: number): Result<SummaryVersionMeta[]> => {
      try {
        return { ok: true, data: listSummaryVersions(Number(videoId)) };
      } catch (error) {
        return failure<SummaryVersionMeta[]>(error);
      }
    }
  );

  ipcMain.handle('library:summary-version', (_event, id: number): Result<SummaryVersion | null> => {
    try {
      return { ok: true, data: getSummaryVersion(Number(id)) };
    } catch (error) {
      return failure<SummaryVersion | null>(error);
    }
  });

  ipcMain.handle('library:restore-version', (_event, id: number): Result<StoredSummary> => {
    try {
      const summary = restoreSummaryVersion(Number(id));
      send('library:changed', null);
      return { ok: true, data: summary };
    } catch (error) {
      return failure<StoredSummary>(error);
    }
  });

  ipcMain.handle('settings:get', (): Result<ReturnType<typeof settingsSnapshot>> => {
    try {
      return { ok: true, data: settingsSnapshot() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'settings:set',
    async (_event, next: AppSettings): Promise<Result<ReturnType<typeof settingsSnapshot>>> => {
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
    }
  );

  ipcMain.handle(
    'settings:wizard',
    async (_event, done: boolean): Promise<Result<ReturnType<typeof settingsSnapshot>>> => {
      try {
        const settings = loadSettings();
        settings.general.wizardDone = done === true;
        saveSettings(settings);
        const snapshot = settingsSnapshot();
        send('settings:changed', snapshot);
        return { ok: true, data: snapshot };
      } catch (error) {
        return failure(error);
      }
    }
  );

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
        // 导出的设置不含 API Key / 桥 Token；重新导入时保留本机原值。
        fs.writeFileSync(result.filePath, JSON.stringify(settingsForExport(), null, 2), 'utf8');
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

  ipcMain.handle(
    'bridge:install-extension',
    async (): Promise<Result<{ path: string; browser: string; opened: boolean }>> => {
      try {
        return { ok: true, data: await installBrowserExtension(win) };
      } catch (error) {
        return failure<{ path: string; browser: string; opened: boolean }>(error);
      }
    }
  );

  ipcMain.handle('system:open-external', async (_event, url: string) => {
    const value = String(url || '');
    if (!/^https?:\/\//i.test(value)) throw new Error('只允许打开 http/https 链接');
    await shell.openExternal(value);
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

  ipcMain.handle('update:skip', (_event, version: string) => {
    return { ok: true, data: skipUpdate(version) };
  });

  ipcMain.handle('update:open-releases', async () => {
    await shell.openExternal(
      'https://github.com/Universe366/bilibili-subtitle-assistant/releases/latest'
    );
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
    (_event, patch: { width?: number; position?: 'left' | 'right'; collapsed?: boolean }) => {
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

  let dragRestoreTimer: NodeJS.Timeout | null = null;
  let dragActive = false;

  ipcMain.handle('browser:begin-drag', async () => {
    try {
      if (dragRestoreTimer) clearTimeout(dragRestoreTimer);
      dragActive = true;
      const snapshot = await tabs.captureActiveView();
      if (!dragActive) {
        tabs.setActiveViewVisible(true);
        return { ok: true, data: null };
      }
      tabs.setActiveViewVisible(false);
      dragRestoreTimer = setTimeout(() => {
        dragActive = false;
        tabs.setActiveViewVisible(true);
        dragRestoreTimer = null;
      }, 12000);
      return { ok: true, data: snapshot };
    } catch (error) {
      dragActive = false;
      tabs.setActiveViewVisible(true);
      return failure(error);
    }
  });

  ipcMain.handle('browser:end-drag', () => {
    dragActive = false;
    if (dragRestoreTimer) {
      clearTimeout(dragRestoreTimer);
      dragRestoreTimer = null;
    }
    tabs.setActiveViewVisible(true);
  });

  ipcMain.handle('browser:set-visible', (_event, visible: boolean) => {
    tabs.setActiveViewVisible(visible === true);
  });

  ipcMain.handle('data:backup', async () => {
    try {
      return { ok: true, data: await backupData() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('data:restore', async () => {
    try {
      return { ok: true, data: await restoreData() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('data:change-dir', async () => {
    try {
      const result = await changeDataDir();
      if (result.canceled || !result.target) {
        return { ok: true, data: result };
      }
      await dialog.showMessageBox({
        type: 'info',
        title: '迁移完成',
        message: '数据已迁移到新位置',
        detail: `应用现在会重启，之后将从以下目录读写数据：\n${result.target}${
          result.failed ? `\n\n有 ${result.failed} 个缓存/锁定文件未复制，不影响设置与字幕库。` : ''
        }\n\n旧数据目录会在新进程启动后自动删除。`
      });
      app.relaunch();
      app.exit(0);
      return { ok: true, data: result };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('diagnostics:get', () => {
    try {
      const dataDir = app.getPath('userData');
      const logs = ['startup.log', 'fatal.log']
        .map((name) => {
          const file = path.join(dataDir, name);
          try {
            const stat = fs.statSync(file);
            return { name, size: stat.size, modified: stat.mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((item): item is { name: string; size: number; modified: number } => Boolean(item));
      return {
        ok: true,
        data: {
          version: app.getVersion(),
          electron: process.versions.electron || '',
          chrome: process.versions.chrome || '',
          node: process.versions.node || '',
          platform: process.platform,
          arch: process.arch,
          dataDir,
          settingsPath: path.join(dataDir, 'settings.json'),
          dbPath: path.join(dataDir, 'library.db'),
          logs,
          library: listLibrary().stats
        }
      };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('permissions:clear', (): Result<{ removed: number }> => {
    try {
      return { ok: true, data: { removed: clearSitePermissions() } };
    } catch (error) {
      return failure<{ removed: number }>(error);
    }
  });

  ipcMain.handle(
    'diagnostics:export',
    async (): Promise<Result<{ canceled: boolean; path?: string }>> => {
      try {
        return { ok: true, data: await exportDiagnostics() };
      } catch (error) {
        return failure<{ canceled: boolean; path?: string }>(error);
      }
    }
  );

  ipcMain.handle('settings:open-data', async () => {
    await shell.openPath(app.getPath('userData'));
  });

  ipcMain.handle(
    'ai:summarize',
    async (_event, payload: SummarizeRequest): Promise<Result<{ requestId: string }>> => {
      if (
        !payload ||
        !payload.info ||
        !Array.isArray(payload.lines) ||
        payload.lines.length === 0
      ) {
        return { ok: false, error: '没有可用的字幕内容' };
      }

      const requestId = payload.requestId || randomUUID();
      const controller = new AbortController();
      aiControllers.set(requestId, controller);
      trackJob(() =>
        createJob({
          id: requestId,
          type: 'summary',
          title: `总结 · ${payload.info.title || '当前视频'}`
        })
      );

      void (async () => {
        try {
          const result = await summarize({
            info: payload.info,
            lines: payload.lines,
            skipProofread: payload.skipProofread === true,
            signal: controller.signal,
            onDelta: (delta) => send('ai:delta', { requestId, delta } satisfies AiDeltaEvent),
            onStatus: (status) => {
              trackJob(() => updateJob(requestId, { message: status }));
              send('ai:status', { requestId, status } satisfies AiStatusEvent);
            },
            onReasoning: (delta) =>
              send('ai:reasoning', { requestId, delta } satisfies AiReasoningEvent)
          });
          const saved = saveSummary(payload.info, result.text, result.model);
          console.log(
            '[m4] verification',
            result.verification
              ? `${result.verification.attempted}/${result.verification.references.length}` +
                  (result.verification.judged
                    ? ` judged dropped=${result.verification.dropped} supplements=${result.verification.supplements.length}`
                    : ' judged=false')
              : 'none'
          );
          send('ai:done', {
            requestId,
            text: result.text,
            model: result.model,
            verification: result.verification
          } satisfies AiDoneEvent);
          trackJob(() =>
            finishJob(
              requestId,
              'done',
              null,
              `完成 · ${result.text.length.toLocaleString('zh-CN')} 字`
            )
          );
          send('library:changed', null);
          console.log('[m4] summary saved', saved.id, `chars=${result.text.length}`);
        } catch (error) {
          const message = controller.signal.aborted
            ? '已取消'
            : (error as Error)?.message || String(error);
          console.warn('[m4] summary failed:', message);
          trackJob(() =>
            finishJob(requestId, controller.signal.aborted ? 'cancelled' : 'failed', message)
          );
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

  ipcMain.handle(
    'chat:send',
    async (_event, payload: ChatRequest): Promise<Result<{ requestId: string }>> => {
      if (!payload || !payload.info) {
        return { ok: false, error: '没有可用的页面信息' };
      }
      if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
        return { ok: false, error: '没有对话内容' };
      }

      const requestId = payload.requestId || randomUUID();
      const controller = new AbortController();
      chatControllers.set(requestId, controller);
      const page =
        payload.includePage === false ? null : await readPageContext(tabs.activeWebContents());
      const lines = Array.isArray(payload.lines) ? payload.lines : [];

      void (async () => {
        try {
          const result = await chat({
            info: payload.info,
            lines,
            messages: payload.messages,
            skillIds: payload.skillIds,
            page,
            signal: controller.signal,
            onDelta: (delta) => send('chat:delta', { requestId, delta } satisfies ChatDeltaEvent),
            onReasoning: (reasoning) =>
              send('chat:delta', { requestId, delta: '', reasoning } satisfies ChatDeltaEvent)
          });
          send('chat:done', {
            requestId,
            text: result.text,
            model: result.model,
            reasoning: result.reasoning
          } satisfies ChatDoneEvent);
        } catch (error) {
          const message = controller.signal.aborted
            ? '已取消'
            : (error as Error)?.message || String(error);
          console.warn('[chat] failed:', message);
          send('chat:error', { requestId, error: message } satisfies ChatErrorEvent);
        } finally {
          chatControllers.delete(requestId);
        }
      })();

      return { ok: true, data: { requestId } };
    }
  );

  ipcMain.handle('chat:cancel', (_event, requestId: string) => {
    chatControllers.get(requestId)?.abort();
  });

  ipcMain.handle(
    'asr:transcribe',
    async (_event, payload: { requestId: string }): Promise<Result<{ requestId: string }>> => {
      const wc = tabs.activeWebContents();
      if (!wc) return { ok: false, error: '当前没有活动页面' };
      const requestId = payload?.requestId || randomUUID();
      const controller = new AbortController();
      asrControllers.set(requestId, controller);
      trackJob(() => createJob({ id: requestId, type: 'asr', title: '语音转录' }));

      void (async () => {
        try {
          const info = await getPageInfo(wc);
          trackJob(() => updateJob(requestId, { title: `语音转录 · ${info.title || '当前视频'}` }));
          const result = await transcribe(
            wc,
            info,
            (stage, percent, message) => {
              trackJob(() => updateJob(requestId, { progress: percent, message }));
              send('asr:progress', {
                requestId,
                stage,
                percent,
                message
              } satisfies AsrProgressEvent);
            },
            controller.signal
          );
          send('asr:done', {
            requestId,
            lines: result.lines,
            model: result.model,
            duration: result.duration
          } satisfies AsrDoneEvent);
          trackJob(() => finishJob(requestId, 'done', null, `完成 · ${result.lines.length} 行`));
        } catch (error) {
          const message = controller.signal.aborted
            ? '已终止'
            : (error as Error)?.message || String(error);
          console.warn('[asr] failed:', message);
          trackJob(() =>
            finishJob(requestId, controller.signal.aborted ? 'cancelled' : 'failed', message)
          );
          send('asr:error', { requestId, error: message } satisfies AsrErrorEvent);
        } finally {
          asrControllers.delete(requestId);
        }
      })();

      return { ok: true, data: { requestId } };
    }
  );

  ipcMain.handle(
    'local:import',
    async (): Promise<Result<{ canceled: boolean; requestId?: string; filename?: string }>> => {
      try {
        const directFile = String(process.env.BSUB_LOCAL_MEDIA || '').trim();
        const picked = directFile
          ? { canceled: false, filePaths: [directFile] }
          : await dialog.showOpenDialog(win, {
              title: '选择本地音视频',
              properties: ['openFile'],
              filters: [
                {
                  name: '音视频',
                  extensions: [
                    'mp4',
                    'mkv',
                    'mov',
                    'webm',
                    'flv',
                    'mp3',
                    'm4a',
                    'wav',
                    'aac',
                    'flac',
                    'ogg'
                  ]
                }
              ]
            });
        if (picked.canceled || !picked.filePaths[0]) {
          return { ok: true, data: { canceled: true } };
        }
        const file = picked.filePaths[0];
        const filename = path.basename(file);
        const requestId = randomUUID();
        const controller = new AbortController();
        asrControllers.set(requestId, controller);
        trackJob(() => createJob({ id: requestId, type: 'asr', title: `本地文件：${filename}` }));

        void (async () => {
          try {
            const duration = await probeDuration(file);
            const info: PageInfo = {
              kind: 'local',
              bvid: null,
              aid: null,
              cid: null,
              epId: null,
              seasonId: null,
              page: 1,
              partTitle: '',
              parts: [],
              title: filename,
              owner: '本地文件',
              desc: '',
              duration,
              url: pathToFileURL(file).toString(),
              signature: `local:${file}`
            };
            const result = await transcribeFile(
              file,
              info,
              (_stage, percent, message) => {
                trackJob(() =>
                  updateJob(requestId, {
                    progress: Math.min(99, Math.max(0, Math.round(percent))),
                    message
                  })
                );
              },
              controller.signal
            );
            if (controller.signal.aborted) throw new Error('已取消');
            const ingested = ingestVideo({
              info,
              track: {
                lan: 'zh-CN',
                lanDoc: '中文',
                url: `local:${file}`,
                isAi: false,
                aiStatus: null,
                source: 'local'
              },
              lines: result.lines
            });
            trackJob(() => updateJob(requestId, { progress: 100, message: '已入库' }));
            trackJob(() =>
              finishJob(requestId, 'done', null, `已入库 ${result.lines.length} 行字幕`)
            );
            send('library:changed', null);
            send('local:done', {
              requestId,
              videoId: ingested.videoId,
              title: filename,
              lineCount: result.lines.length
            });
          } catch (error) {
            const message = controller.signal.aborted
              ? '已取消'
              : (error as Error)?.message || String(error);
            trackJob(() =>
              finishJob(requestId, controller.signal.aborted ? 'cancelled' : 'failed', message)
            );
            send('local:error', { requestId, error: message });
          } finally {
            asrControllers.delete(requestId);
          }
        })();

        return { ok: true, data: { canceled: false, requestId, filename } };
      } catch (error) {
        return failure<{ canceled: boolean; requestId?: string; filename?: string }>(error);
      }
    }
  );

  ipcMain.handle('podcast:preview', async (_event, url: string) => {
    try {
      return { ok: true as const, data: await loadPodcastFeed(String(url || '')) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'podcast:import',
    async (
      _event,
      payload: { audioUrl: string; title: string; pageUrl?: string; duration?: number }
    ): Promise<Result<{ requestId: string }>> => {
      try {
        const audioUrl = String(payload?.audioUrl || '');
        if (!/^https?:\/\//i.test(audioUrl)) return { ok: false, error: '音频地址无效' };
        const title = String(payload?.title || '播客单集').slice(0, 200);
        const requestId = randomUUID();
        const controller = new AbortController();
        asrControllers.set(requestId, controller);
        trackJob(() => createJob({ id: requestId, type: 'asr', title: `播客：${title}` }));
        const workDir = path.join(app.getPath('temp'), `bsub-podcast-${requestId}`);

        void (async () => {
          try {
            trackJob(() => updateJob(requestId, { progress: 2, message: '下载音频…' }));
            const file = await downloadPodcastAudio(audioUrl, workDir, controller.signal);
            const duration = Number(payload?.duration) || (await probeDuration(file));
            const info: PageInfo = {
              kind: 'podcast',
              bvid: null,
              aid: null,
              cid: null,
              epId: null,
              seasonId: null,
              page: 1,
              partTitle: '',
              parts: [],
              title,
              owner: '播客',
              desc: '',
              duration,
              url: String(payload?.pageUrl || audioUrl),
              signature: `podcast:${audioUrl}`
            };
            const result = await transcribeFile(
              file,
              info,
              (_stage, percent, message) => {
                trackJob(() =>
                  updateJob(requestId, {
                    progress: Math.min(99, Math.max(0, Math.round(percent))),
                    message
                  })
                );
              },
              controller.signal
            );
            if (controller.signal.aborted) throw new Error('已取消');
            const ingested = ingestVideo({
              info,
              track: {
                lan: 'zh-CN',
                lanDoc: '中文',
                url: `podcast:${audioUrl}`,
                isAi: false,
                aiStatus: null,
                source: 'podcast'
              },
              lines: result.lines
            });
            trackJob(() => updateJob(requestId, { progress: 100, message: '已入库' }));
            trackJob(() =>
              finishJob(requestId, 'done', null, `已入库 ${result.lines.length} 行字幕`)
            );
            send('library:changed', null);
            send('podcast:done', {
              requestId,
              videoId: ingested.videoId,
              title,
              lineCount: result.lines.length
            });
          } catch (error) {
            const message = controller.signal.aborted
              ? '已取消'
              : (error as Error)?.message || String(error);
            trackJob(() =>
              finishJob(requestId, controller.signal.aborted ? 'cancelled' : 'failed', message)
            );
            send('podcast:error', { requestId, error: message });
          } finally {
            asrControllers.delete(requestId);
            try {
              fs.rmSync(workDir, { recursive: true, force: true });
            } catch {
              // ignore
            }
          }
        })();

        return { ok: true, data: { requestId } };
      } catch (error) {
        return failure<{ requestId: string }>(error);
      }
    }
  );

  ipcMain.handle('asr:cancel', (_event, requestId: string) => {
    asrControllers.get(requestId)?.abort();
  });

  ipcMain.handle(
    'translate:start',
    async (_event, payload: TranslateRequest): Promise<Result<{ requestId: string }>> => {
      if (!payload || !Array.isArray(payload.lines) || payload.lines.length === 0) {
        return { ok: false, error: '没有可翻译的字幕' };
      }
      const requestId = payload.requestId || randomUUID();
      const controller = new AbortController();
      translateControllers.set(requestId, controller);
      trackJob(() =>
        createJob({
          id: requestId,
          type: 'translate',
          title: `翻译 · ${String(payload.target || '中文')}`
        })
      );

      void (async () => {
        try {
          const result = await translateLines(
            payload.lines,
            String(payload.target || '中文'),
            (percent, message) => {
              trackJob(() => updateJob(requestId, { progress: percent, message }));
              send('translate:progress', {
                requestId,
                percent,
                message
              } satisfies TranslateProgressEvent);
            },
            controller.signal
          );
          send('translate:done', {
            requestId,
            lines: result.lines,
            language: result.language
          } satisfies TranslateDoneEvent);
          trackJob(() => finishJob(requestId, 'done', null, `完成 · ${result.lines.length} 行`));
        } catch (error) {
          const message = controller.signal.aborted
            ? '已终止'
            : (error as Error)?.message || String(error);
          console.warn('[translate] failed:', message);
          trackJob(() =>
            finishJob(requestId, controller.signal.aborted ? 'cancelled' : 'failed', message)
          );
          send('translate:error', { requestId, error: message } satisfies TranslateErrorEvent);
        } finally {
          translateControllers.delete(requestId);
        }
      })();

      return { ok: true, data: { requestId } };
    }
  );

  ipcMain.handle('translate:cancel', (_event, requestId: string) => {
    translateControllers.get(requestId)?.abort();
  });

  ipcMain.handle(
    'optimize:start',
    async (
      _event,
      payload: { requestId: string; lines: SubtitleLine[] }
    ): Promise<Result<{ requestId: string }>> => {
      if (!payload || !Array.isArray(payload.lines) || payload.lines.length === 0) {
        return { ok: false, error: '没有可优化的字幕' };
      }
      const requestId = payload.requestId || randomUUID();
      const controller = new AbortController();
      optimizeControllers.set(requestId, controller);
      trackJob(() => createJob({ id: requestId, type: 'optimize', title: 'AI 校对' }));

      void (async () => {
        try {
          const suggestions = await optimizeLines(
            payload.lines,
            (percent, message) => {
              trackJob(() => updateJob(requestId, { progress: percent, message }));
              send('optimize:progress', {
                requestId,
                percent,
                message
              } satisfies OptimizeProgressEvent);
            },
            controller.signal
          );
          send('optimize:done', {
            requestId,
            suggestions
          } satisfies OptimizeDoneEvent);
          trackJob(() => finishJob(requestId, 'done', null, `完成 · ${suggestions.length} 条建议`));
        } catch (error) {
          const message = controller.signal.aborted
            ? '已终止'
            : (error as Error)?.message || String(error);
          console.warn('[optimize] failed:', message);
          trackJob(() =>
            finishJob(requestId, controller.signal.aborted ? 'cancelled' : 'failed', message)
          );
          send('optimize:error', { requestId, error: message } satisfies OptimizeErrorEvent);
        } finally {
          optimizeControllers.delete(requestId);
        }
      })();

      return { ok: true, data: { requestId } };
    }
  );

  ipcMain.handle('optimize:cancel', (_event, requestId: string) => {
    optimizeControllers.get(requestId)?.abort();
  });

  ipcMain.handle(
    'batch:summarize',
    async (_event, payload: { requestId: string; videoIds: number[]; concurrency?: number }) =>
      startBatchSummary(payload?.videoIds || [], payload?.requestId, payload?.concurrency)
  );

  ipcMain.handle('batch:pause', (_event, requestId: string) => {
    const control = batchControls.get(requestId);
    if (control) control.paused = true;
    trackJob(() => updateJob(requestId, { status: 'paused', message: '已暂停' }));
  });

  ipcMain.handle('batch:resume', (_event, requestId: string) => {
    const control = batchControls.get(requestId);
    if (control) control.paused = false;
    trackJob(() => updateJob(requestId, { status: 'running', message: '继续' }));
  });

  ipcMain.handle('batch:remove', (_event, payload: { requestId: string; videoId: number }) => {
    const control = batchControls.get(payload.requestId);
    if (control) control.removed.add(Number(payload.videoId));
    trackJob(() =>
      updateJobItem(payload.requestId, String(payload.videoId), {
        status: 'skipped',
        message: '已移除'
      })
    );
  });

  ipcMain.handle('batch:cancel', (_event, requestId: string) => {
    batchControllers.get(requestId)?.abort();
  });

  ipcMain.handle(
    'urlbatch:start',
    async (_event, payload: { requestId: string; urls: string[]; summarize: boolean }) =>
      startUrlBatch(payload?.urls || [], payload?.summarize !== false, payload?.requestId)
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

  ipcMain.handle('exports:list', (): Result<ExportRecord[]> => {
    try {
      return { ok: true, data: listExports() };
    } catch (error) {
      return failure<ExportRecord[]>(error);
    }
  });

  ipcMain.handle('exports:clear', (): Result<{ removed: number }> => {
    try {
      return { ok: true, data: { removed: clearExports() } };
    } catch (error) {
      return failure<{ removed: number }>(error);
    }
  });

  ipcMain.handle('exports:delete', (_event, id: number): Result<{ removed: boolean }> => {
    try {
      return { ok: true, data: { removed: deleteExport(Number(id)) } };
    } catch (error) {
      return failure<{ removed: boolean }>(error);
    }
  });

  ipcMain.handle('exports:open', async (_event, filePath: string) => {
    try {
      const message = await shell.openPath(String(filePath || ''));
      return message ? { ok: false as const, error: message } : { ok: true as const, data: true };
    } catch (error) {
      return failure<boolean>(error);
    }
  });

  ipcMain.handle('exports:reveal', (_event, filePath: string): Result<boolean> => {
    try {
      shell.showItemInFolder(String(filePath || ''));
      return { ok: true, data: true };
    } catch (error) {
      return failure<boolean>(error);
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
        return {
          ok: true,
          data: await callMcpTool(payload.server, payload.name, payload.args || {})
        };
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
    async (
      _event,
      payload: { info: PageInfo; lines: SubtitleLine[] }
    ): Promise<Result<Chapter[]>> => {
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
        defaultPath: `${String(group?.name || '字幕规则组').replace(/[\\/:*?"<>|]/g, '_')}.json`,
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
      const rows = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.groups)
          ? parsed.groups
          : [];
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

  ipcMain.handle(
    'correction:preview',
    (_event, text: string, settings?: AppSettings): Result<string> => {
      try {
        return {
          ok: true,
          data: applyCorrectionToText(String(text || ''), settings || loadSettings())
        };
      } catch (error) {
        return failure<string>(error);
      }
    }
  );

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
          estimateTimestamps: payload.estimateTimestamps ?? settings.export.estimateTimestamps
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
        addExportRecord(
          target,
          '字幕',
          `${payload.info?.title || '未命名视频'} · ${payload.format}`
        );
        console.log('[m4] exported', payload.format, target, `chars=${built.content.length}`);
        return { ok: true, data: { path: target } };
      } catch (error) {
        return failure<{ path: string } | { canceled: true }>(error);
      }
    }
  );

  ipcMain.handle(
    'file:save-text',
    async (
      _event,
      payload: { content: string; filename?: string; savePath?: string }
    ): Promise<Result<{ path: string } | { canceled: true }>> => {
      try {
        const content = String(payload?.content || '');
        if (!content.trim()) throw new Error('导出内容为空');
        if (content.length > 50 * 1024 * 1024) throw new Error('导出内容过大');
        let target = String(payload?.savePath || '');
        if (!target) {
          const picked = await dialog.showSaveDialog(win, {
            title: '导出',
            defaultPath: path.join(
              app.getPath('documents'),
              String(payload?.filename || 'export.md')
            ),
            filters: [
              { name: 'Markdown', extensions: ['md'] },
              { name: '文本', extensions: ['txt'] },
              { name: '所有文件', extensions: ['*'] }
            ]
          });
          if (picked.canceled || !picked.filePath) {
            return { ok: true, data: { canceled: true } };
          }
          target = picked.filePath;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf8');
        addExportRecord(target, '文本', String(payload?.filename || path.basename(target)));
        console.log('[export] text saved', target, `chars=${content.length}`);
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
