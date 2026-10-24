import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { app, dialog, ipcMain } from 'electron';
import type { PageInfo, SubtitleLine } from '../../shared/types';
import {
  createJob,
  createJobItem,
  finishJob,
  getJob,
  ingestVideo,
  listLibrary,
  saveSummary,
  updateJob,
  updateJobItem
} from '../library';
import { batchSummarize } from '../batch';
import { batchUrls, parseVideoUrls } from '../urlbatch';
import { summarize } from '../ai';
import { readPageContext } from '../pageContext';
import { chat } from '../chat';
import { getPageInfo } from '../page';
import { transcribe, transcribeFile } from '../asr';
import { probeDuration } from '../media';
import { downloadPodcastAudio, loadPodcastFeed } from '../podcast';
import { translateLines } from '../translate';
import { optimizeLines } from '../optimize';
import type {
  AiDeltaEvent,
  AiDoneEvent,
  AiErrorEvent,
  AiReasoningEvent,
  AiStatusEvent,
  AsrDoneEvent,
  AsrErrorEvent,
  AsrProgressEvent,
  BatchDoneEvent,
  BatchErrorEvent,
  BatchProgressEvent,
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatRequest,
  OptimizeDoneEvent,
  OptimizeErrorEvent,
  OptimizeProgressEvent,
  Result,
  SummarizeRequest,
  TranslateDoneEvent,
  TranslateErrorEvent,
  TranslateProgressEvent,
  TranslateRequest,
  UrlBatchDoneEvent,
  UrlBatchErrorEvent,
  UrlBatchProgressEvent
} from '../../shared/types';
import type { BatchControl } from '../batch';
import { abortControllers, failure, trackJob, type IpcContext } from './shared';

const { ai: aiControllers, chat: chatControllers, asr: asrControllers } = abortControllers;
const { translate: translateControllers, optimize: optimizeControllers } = abortControllers;
const { batch: batchControllers, urlBatch: urlBatchControllers } = abortControllers;
const batchControls = new Map<string, BatchControl>();

/** AI 总结 / 对话 / ASR / 翻译 / 优化 / 批量任务 相关 IPC。 */
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

export const startBatchSummary = (
  ctx: IpcContext,
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
          ctx.send('batch:progress', {
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
      ctx.send('batch:done', { requestId, ...result } satisfies BatchDoneEvent);
      ctx.send('library:changed', null);
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
      ctx.send('batch:error', { requestId, error: message } satisfies BatchErrorEvent);
    } finally {
      batchControllers.delete(requestId);
      batchControls.delete(requestId);
    }
  })();

  return { ok: true, data: { requestId } };
};

export const startUrlBatch = (
  ctx: IpcContext,
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
        ctx.tabs,
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
          ctx.send('urlbatch:progress', {
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
      ctx.send('urlbatch:done', { requestId, ...result } satisfies UrlBatchDoneEvent);
      ctx.send('library:changed', null);
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
      ctx.send('urlbatch:error', { requestId, error: message } satisfies UrlBatchErrorEvent);
    } finally {
      urlBatchControllers.delete(requestId);
    }
  })();

  return { ok: true, data: { requestId } };
};

export function registerMediaIpc(ctx: IpcContext): void {
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
            onDelta: (delta) => ctx.send('ai:delta', { requestId, delta } satisfies AiDeltaEvent),
            onStatus: (status) => {
              trackJob(() => updateJob(requestId, { message: status }));
              ctx.send('ai:status', { requestId, status } satisfies AiStatusEvent);
            },
            onReasoning: (delta) =>
              ctx.send('ai:reasoning', { requestId, delta } satisfies AiReasoningEvent)
          });
          const saved = saveSummary(payload.info, result.text, result.model, result.verification);
          console.log(
            '[m4] verification',
            result.verification
              ? `${result.verification.attempted}/${result.verification.references.length}` +
                  (result.verification.judged
                    ? ` judged dropped=${result.verification.dropped} supplements=${result.verification.supplements.length}`
                    : ' judged=false')
              : 'none'
          );
          ctx.send('ai:done', {
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
          ctx.send('library:changed', null);
          console.log('[m4] summary saved', saved.id, `chars=${result.text.length}`);
        } catch (error) {
          const message = controller.signal.aborted
            ? '已取消'
            : (error as Error)?.message || String(error);
          console.warn('[m4] summary failed:', message);
          trackJob(() =>
            finishJob(requestId, controller.signal.aborted ? 'cancelled' : 'failed', message)
          );
          ctx.send('ai:error', { requestId, error: message } satisfies AiErrorEvent);
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
    async (event, payload: ChatRequest): Promise<Result<{ requestId: string }>> => {
      // 事件必须回到发起请求的窗口：桌宠/未来多窗口不能只往主窗口发。
      const sender = event.sender;
      const sendToSender = (channel: string, data: unknown) => {
        if (!sender.isDestroyed()) sender.send(channel, data);
      };
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
        payload.includePage === false ? null : await readPageContext(ctx.tabs.activeWebContents());
      const lines = Array.isArray(payload.lines) ? payload.lines : [];

      void (async () => {
        try {
          const result = await chat({
            info: payload.info,
            lines,
            messages: payload.messages,
            skillIds: payload.skillIds,
            web: payload.web === true,
            page,
            signal: controller.signal,
            onDelta: (delta) =>
              sendToSender('chat:delta', { requestId, delta } satisfies ChatDeltaEvent),
            onReasoning: (reasoning) =>
              sendToSender('chat:delta', { requestId, delta: '', reasoning } satisfies ChatDeltaEvent)
          });
          sendToSender('chat:done', {
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
          sendToSender('chat:error', { requestId, error: message } satisfies ChatErrorEvent);
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
      const wc = ctx.tabs.activeWebContents();
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
              ctx.send('asr:progress', {
                requestId,
                stage,
                percent,
                message
              } satisfies AsrProgressEvent);
            },
            controller.signal
          );
          ctx.send('asr:done', {
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
          ctx.send('asr:error', { requestId, error: message } satisfies AsrErrorEvent);
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
          : await dialog.showOpenDialog(ctx.win, {
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
            ctx.send('library:changed', null);
            ctx.send('local:done', {
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
            ctx.send('local:error', { requestId, error: message });
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
            ctx.send('library:changed', null);
            ctx.send('podcast:done', {
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
            ctx.send('podcast:error', { requestId, error: message });
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
              ctx.send('translate:progress', {
                requestId,
                percent,
                message
              } satisfies TranslateProgressEvent);
            },
            controller.signal
          );
          ctx.send('translate:done', {
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
          ctx.send('translate:error', { requestId, error: message } satisfies TranslateErrorEvent);
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
              ctx.send('optimize:progress', {
                requestId,
                percent,
                message
              } satisfies OptimizeProgressEvent);
            },
            controller.signal
          );
          ctx.send('optimize:done', {
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
          ctx.send('optimize:error', { requestId, error: message } satisfies OptimizeErrorEvent);
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
      startBatchSummary(ctx, payload?.videoIds || [], payload?.requestId, payload?.concurrency)
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
      startUrlBatch(ctx, payload?.urls || [], payload?.summarize !== false, payload?.requestId)
  );

  ipcMain.handle('urlbatch:cancel', (_event, requestId: string) => {
    urlBatchControllers.get(requestId)?.abort();
  });
}
