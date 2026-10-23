import type { BrowserWindow } from 'electron';
import { app, dialog, ipcMain, Notification, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AiDeltaEvent,
  AiDoneEvent,
  AiErrorEvent,
  AiStatusEvent,
  AiReasoningEvent,
  AppSettings,
  CorrectionRuleGroup,
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
  OptimizeProgressEvent,
  OptimizeDoneEvent,
  OptimizeErrorEvent,
  ExportPayload,
  PageInfo,
  Result,
  SubtitleLine,
  SummarizeRequest,
  WebReference,
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
  ExportRecord,
  JobRecord
} from '../shared/types';
import type { TabManager } from './tabs';
import { getPageInfo } from './page';
import {
  addExportRecord,
  clearExports,
  clearFinishedJobs,
  clearHistory,
  createJob,
  createJobItem,
  deleteExport,
  deleteHistoryItem,
  finishJob,
  getJob,
  ingestVideo,
  listExports,
  listHistory,
  listJobs,
  listTranscriptions,
  listLibrary,
  saveSummary,
  setJobsListener,
  updateJob,
  updateJobItem
} from './library';

import { loadSettings } from './settings';

import { readPageContext } from './pageContext';

import { summarize } from './ai';
import { chat } from './chat';
import { transcribe, transcribeFile } from './asr';
import { probeDuration } from './media';
import { downloadPodcastAudio, loadPodcastFeed } from './podcast';
import { pathToFileURL } from 'node:url';
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

import { applyCorrectionToText } from './correction';
import { buildExport, exportFilters } from './exporters';
import { registerBrowserIpc } from './ipc/browser';
import { registerSettingsIpc } from './ipc/settings';
import { registerPageIpc } from './ipc/page';
import { registerLibraryIpc } from './ipc/library';
import { failure, trackJob } from './ipc/shared';

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

  registerBrowserIpc({ win, send, tabs, aiControllers });

  registerPageIpc({ win, send, tabs, aiControllers });

  registerLibraryIpc({ win, send, tabs, aiControllers });

  registerSettingsIpc({ win, send, tabs, aiControllers });

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
