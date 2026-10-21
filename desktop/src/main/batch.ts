import type { PageInfo } from '../shared/types';
import { libraryVideoBundle, saveSummary } from './library';
import { summarize } from './ai';

export interface BatchControl {
  paused: boolean;
  removed: Set<number>;
}

export interface BatchResult {
  succeeded: number;
  failed: Array<{ videoId: number; title: string; error: string }>;
}

export async function batchSummarize(
  videoIds: number[],
  onProgress: (percent: number, message: string) => void,
  signal?: AbortSignal,
  control?: BatchControl
): Promise<BatchResult> {
  const ids = [...new Set(videoIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) throw new Error('没有选择视频');

  let succeeded = 0;
  const failed: BatchResult['failed'] = [];

  for (let index = 0; index < ids.length; index += 1) {
    while (control?.paused) {
      if (signal?.aborted) throw new Error('已终止');
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (signal?.aborted) throw new Error('已终止');
    const videoId = ids[index];
    if (control?.removed.has(videoId)) continue;
    let title = `#${videoId}`;
    onProgress((index / ids.length) * 100, `准备第 ${index + 1} / ${ids.length} 个视频…`);

    try {
      const bundle = libraryVideoBundle(videoId);
      title = bundle.info.title || title;
      onProgress(
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
    } catch (error) {
      if (signal?.aborted) throw new Error('已终止');
      failed.push({ videoId, title, error: (error as Error)?.message || String(error) });
    }
  }

  onProgress(100, `批量完成：成功 ${succeeded}，失败 ${failed.length}`);
  return { succeeded, failed };
}
