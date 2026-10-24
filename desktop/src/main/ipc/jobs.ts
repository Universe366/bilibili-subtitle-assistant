import { ipcMain, Notification } from 'electron';
import type { JobRecord, Result } from '../../shared/types';
import { clearFinishedJobs, getJob, listJobs, setJobsListener, updateJob } from '../library';
import { startBatchSummary, startUrlBatch } from './media';
import { failure, findAbortController, trackJob, type IpcContext } from './shared';

/** 任务中心：jobs:* 通道与“任务完成”系统通知。 */
export function registerJobsIpc(ctx: IpcContext): void {
  // 长任务结束时如果窗口不在前台，用系统通知提醒；点击回到任务中心。
  let trackedRunning = new Map<string, { title: string; createdAt: number }>();

  const showJobNotification = (job: JobRecord) => {
    try {
      if (!Notification.isSupported() || ctx.win.isFocused()) return;
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
        if (ctx.win.isDestroyed()) return;
        if (ctx.win.isMinimized()) ctx.win.restore();
        ctx.win.show();
        ctx.win.focus();
        ctx.send('app:tasks', null);
      });
      notification.show();
      console.log('[jobs] notified', job.id, job.status);
    } catch (error) {
      console.warn('[jobs] 通知失败:', (error as Error).message);
    }
  };

  setJobsListener(() => {
    const jobs = listJobs();
    ctx.send('jobs:changed', jobs);

    const nextRunning = new Map<string, { title: string; createdAt: number }>();
    for (const job of jobs) {
      if (job.status === 'running' || job.status === 'paused') {
        nextRunning.set(job.id, { title: job.title, createdAt: job.createdAt });
      }
    }
    if (!ctx.win.isFocused()) {
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
    const controller = findAbortController(key);
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
      return startBatchSummary(ctx, failed.map(Number), undefined, concurrency);
    }
    if (job.type === 'url-batch') {
      let summarize = true;
      try {
        summarize = JSON.parse(job.metaJson || '{}').summarize !== false;
      } catch {
        // 旧任务没有 meta，按默认处理
      }
      return startUrlBatch(ctx, failed, summarize);
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
}
