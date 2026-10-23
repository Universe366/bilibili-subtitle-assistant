import type { PageInfo } from '../shared/types';
import { libraryVideoBundle, saveSummary } from './library';
import { summarize } from './ai';

export interface BatchControl {
  paused: boolean;
  removed: Set<number>;
}

export interface BatchHooks {
  onItemStart?: (videoId: number, title: string) => void;
  onItemDone?: (videoId: number, title: string) => void;
  onItemFail?: (videoId: number, title: string, error: string) => void;
  onItemSkip?: (videoId: number) => void;
}

export interface BatchOptions {
  /** 同时跑几个视频，1~4；默认 1（串行） */
  concurrency?: number;
}

export interface BatchResult {
  succeeded: number;
  failed: Array<{ videoId: number; title: string; error: string }>;
  /** 用户主动停止：succeeded / failed 仍然有效 */
  cancelled: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function batchSummarize(
  videoIds: number[],
  onProgress: (percent: number, message: string) => void,
  signal?: AbortSignal,
  control?: BatchControl,
  hooks?: BatchHooks,
  options?: BatchOptions
): Promise<BatchResult> {
  const ids = [...new Set(videoIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) throw new Error('没有选择视频');

  const total = ids.length;
  const concurrency = Math.min(4, Math.max(1, Math.round(options?.concurrency || 1)));
  let cursor = 0;
  let succeeded = 0;
  let completed = 0;
  let cancelled = false;
  const failed: BatchResult['failed'] = [];

  const reportItem = (videoId: number, title: string) => {
    // 并行时 completed 只是已完成数，进度条按“完成数 / 总数”走。
    onProgress(
      (completed / total) * 100,
      `正在总结 ${title.slice(0, 24)}（完成 ${completed}/${total}）`
    );
  };

  const nextIndex = (): number => {
    while (cursor < total) {
      const index = cursor;
      cursor += 1;
      const videoId = ids[index];
      if (control?.removed.has(videoId)) {
        hooks?.onItemSkip?.(videoId);
        completed += 1;
        onProgress(
          (completed / total) * 100,
          `已跳过，完成 ${completed}/${total}（成功 ${succeeded}，失败 ${failed.length}）`
        );
        continue;
      }
      return index;
    }
    return -1;
  };

  const worker = async () => {
    while (true) {
      if (signal?.aborted) {
        cancelled = true;
        return;
      }
      while (control?.paused) {
        if (signal?.aborted) {
          cancelled = true;
          return;
        }
        await sleep(300);
      }

      const index = nextIndex();
      if (index < 0) return;

      const videoId = ids[index];
      let title = `#${videoId}`;
      try {
        const bundle = libraryVideoBundle(videoId);
        title = bundle.info.title || title;
        hooks?.onItemStart?.(videoId, title);
        reportItem(videoId, title);

        const result = await summarize({
          info: bundle.info as PageInfo,
          lines: bundle.lines,
          signal
        });
        saveSummary(bundle.info, result.text, result.model);
        succeeded += 1;
        hooks?.onItemDone?.(videoId, title);
      } catch (error) {
        if (signal?.aborted) {
          cancelled = true;
          return;
        }
        const message = (error as Error)?.message || String(error);
        failed.push({ videoId, title, error: message });
        hooks?.onItemFail?.(videoId, title, message);
      } finally {
        completed += 1;
        onProgress(
          (completed / total) * 100,
          `已完成 ${completed}/${total}（成功 ${succeeded}，失败 ${failed.length}）`
        );
      }
    }
  };

  const workers = Math.min(concurrency, total);
  await Promise.all(Array.from({ length: workers }, () => worker()));

  onProgress(
    cancelled ? (completed / total) * 100 : 100,
    cancelled
      ? `已停止：成功 ${succeeded}，失败 ${failed.length}`
      : `批量完成：成功 ${succeeded}，失败 ${failed.length}`
  );
  return { succeeded, failed, cancelled };
}
