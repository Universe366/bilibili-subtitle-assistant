import type { PageInfo, SubtitleBundle, SubtitleLine, SubtitleTrack } from '../shared/types';
import type { TabManager } from './tabs';
import { getPageInfo, getSubtitles, getTrackBody } from './page';
import { applyCorrectionToLines } from './correction';
import { ingestVideo, saveSummary } from './library';
import { summarize } from './ai';
import { loadSettings } from './settings';

export interface UrlBatchResult {
  succeeded: number;
  failed: Array<{ url: string; title?: string; error: string }>;
  /** 用户主动停止：已入库的条目仍然有效 */
  cancelled: boolean;
}

export interface UrlBatchHooks {
  onItemStart?: (url: string, title: string) => void;
  onItemDone?: (url: string, title: string) => void;
  onItemFail?: (url: string, title: string, error: string) => void;
}

type Progress = (
  index: number,
  total: number,
  url: string,
  title: string,
  stage: string,
  percent: number
) => void;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function parseVideoUrls(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const bv = line.match(/BV[0-9A-Za-z]{10}/);
    let url = '';
    if (bv) {
      url = `https://www.bilibili.com/video/${bv[0]}`;
    } else if (/^https?:\/\//i.test(line)) {
      try {
        const parsed = new URL(line);
        if (!/bilibili\.com$|b23\.tv$/i.test(parsed.hostname)) continue;
        if (/bilibili\.com$/i.test(parsed.hostname) && !/^\/video\//.test(parsed.pathname)) continue;
        url = parsed.toString();
      } catch {
        continue;
      }
    } else {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= 20) break;
  }
  return urls;
}

function chooseTrack(bundle: SubtitleBundle, info: PageInfo): SubtitleTrack | null {
  const cid = info.cid == null ? '' : String(info.cid);
  const tracks = bundle.tracks.filter((track) => track.url);
  return (
    tracks.find((track) => cid && track.url.includes(cid)) ||
    tracks.find((track) => !track.isAi) ||
    tracks[0] ||
    null
  );
}

export async function batchUrls(
  tabs: TabManager,
  urls: string[],
  withSummary: boolean,
  onProgress: Progress,
  signal?: AbortSignal,
  hooks?: UrlBatchHooks
): Promise<UrlBatchResult> {
  if (!urls.length) throw new Error('没有解析到 B 站视频链接');
  const settings = loadSettings();
  let succeeded = 0;
  let cancelled = false;
  const failed: UrlBatchResult['failed'] = [];
  const targets: string[] = [];

  for (const item of urls) {
    let valid = false;
    try {
      const parsed = new URL(item);
      valid =
        /^https?:$/.test(parsed.protocol) &&
        ((/bilibili\.com$/i.test(parsed.hostname) && /^\/video\//.test(parsed.pathname)) ||
          /b23\.tv$/i.test(parsed.hostname));
    } catch {
      valid = false;
    }
    if (!valid) {
      failed.push({ url: item, error: '不是 B 站视频链接' });
      continue;
    }
    if (targets.includes(item)) continue;
    targets.push(item);
  }

  for (let index = 0; index < targets.length; index += 1) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }
    const url = targets[index];
    let tabId = '';
    let title = '';
    let itemError: string | null = null;
    try {
      hooks?.onItemStart?.(url, '');
      onProgress(index, targets.length, url, '', '打开页面', 0);
      tabId = await tabs.create(url, { activate: false, wait: true });
      const wc = tabs.webContentsOf(tabId);
      if (!wc) throw new Error('标签页创建失败');

      let info: PageInfo | null = null;
      let bundle: SubtitleBundle | null = null;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (signal?.aborted) throw new Error('已终止');
        onProgress(index, targets.length, url, title, '等待视频信息', (attempt / 30) * 100);
        try {
          const current = await getPageInfo(wc);
          if (current && current.title) {
            if (/出错啦|404|页面不存在|已失效/i.test(current.title)) {
              throw new Error('视频页面无效或已失效');
            }
            info = current;
            title = current.title;
            hooks?.onItemStart?.(url, title);
          }
          bundle = await getSubtitles(wc);
          if (bundle.tracks.length || bundle.needLogin) break;
          if (info && info.duration > 0 && !bundle.tracks.length && attempt >= 8) {
            throw new Error('没有可用字幕');
          }
        } catch (error) {
          const message = (error as Error)?.message || '';
          if (/视频页面无效|读取视频信息失败|没有可用字幕/.test(message)) throw error;
          // 页面还在加载，重试
        }
        if (!info && attempt >= 12) {
          throw new Error('读取视频信息失败（页面无响应或视频不存在）');
        }
        await sleep(1000);
      }

      if (!info) throw new Error('读取视频信息失败');
      if (bundle?.needLogin) throw new Error('需要登录 B 站才能读取字幕');
      if (!bundle || !bundle.tracks.length) throw new Error('没有可用字幕');

      const track = chooseTrack(bundle, info);
      if (!track) throw new Error('没有可用字幕轨');
      onProgress(index, targets.length, url, title, '下载字幕', 40);
      const body = await getTrackBody(track.url);
      const lines: SubtitleLine[] = applyCorrectionToLines(body.lines, settings);
      if (!lines.length) throw new Error('字幕正文为空');

      onProgress(index, targets.length, url, title, '写入本地库', 65);
      ingestVideo({ info, track, lines });
      succeeded += 1;

      if (withSummary) {
        onProgress(index, targets.length, url, title, '生成总结', 80);
        try {
          const result = await summarize({ info, lines, signal });
          saveSummary(info, result.text, result.model);
        } catch (error) {
          const message = `已入库，总结失败：${(error as Error).message}`;
          failed.push({ url, title, error: message });
          itemError = message;
        }
      }
      onProgress(index, targets.length, url, title, '完成', 100);
    } catch (error) {
      if (signal?.aborted) {
        cancelled = true;
        hooks?.onItemFail?.(url, title, '已取消');
        break;
      }
      const message = (error as Error)?.message || String(error);
      failed.push({ url, title, error: message });
      itemError = message;
    } finally {
      if (tabId) tabs.close(tabId);
    }

    if (itemError) hooks?.onItemFail?.(url, title, itemError);
    else hooks?.onItemDone?.(url, title);
  }

  return { succeeded, failed, cancelled };
}
