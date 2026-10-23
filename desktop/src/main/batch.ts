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
  hooks?: BatchHooks
): Promise<BatchResult> {
  const ids = [...new Set(videoIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) throw new Error('没有选择视频');

  let succeeded = 0;
  let lastPercent = 0;
  let cancelled = false;
  const failed: BatchResult['failed'] = [];

  const report = (percent: number, message: string) => {
    lastPercent = percent;
    onProgress(percent, message);
  };

  for (let index = 0; index < ids.length; index += 1) {
    while (control?.paused) {
      if (signal?.aborted) {
        cancelled = true;
        break;
      }
      await sleep(300);
    }
    if (cancelled || signal?.aborted) {
      cancelled = true;
      break;
    }

    const videoId = ids[index];
    if (control?.removed.has(videoId)) {
      hooks?.onItemSkip?.(videoId);
      continue;
    }

    let title = `#${videoId}`;
    report((index / ids.length) * 100, `准备第 ${index + 1} / ${ids.length} 个视频…`);

    try {
      const bundle = libraryVideoBundle(videoId);
      title = bundle.info.title || title;
      hooks?.onItemStart?.(videoId, title);
      report(
        (index / ids.length) * 100,
        `正在总结 ${index + 1} / ${ids.length}：${title.slice(0, 24)}`
      );

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
        break;
      }
      const message = (error as Error)?.message || String(error);
      failed.push({ videoId, title, error: message });
      hooks?.onItemFail?.(videoId, title, message);
    }
  }

  report(
    cancelled ? lastPercent : 100,
    cancelled
      ? `已停止：成功 ${succeeded}，失败 ${failed.length}`
      : `批量完成：成功 ${succeeded}，失败 ${failed.length}`
  );
  return { succeeded, failed, cancelled };
}
