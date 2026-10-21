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
        if (!/bilibili\.com$|b23\.tv$|bilivideo\./i.test(parsed.hostname)) continue;
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
  signal?: AbortSignal
): Promise<UrlBatchResult> {
  if (!urls.length) throw new Error('没有解析到 B 站视频链接');
  const settings = loadSettings();
  let succeeded = 0;
  const failed: UrlBatchResult['failed'] = [];

  for (let index = 0; index < urls.length; index += 1) {
    if (signal?.aborted) throw new Error('已终止');
    const url = urls[index];
    let tabId = '';
    let title = '';
    try {
      onProgress(index, urls.length, url, '', '打开页面', 0);
      tabId = await tabs.create(url, { activate: false, wait: true });
      const wc = tabs.webContentsOf(tabId);
      if (!wc) throw new Error('标签页创建失败');

      let info: PageInfo | null = null;
      let bundle: SubtitleBundle | null = null;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (signal?.aborted) throw new Error('已终止');
        onProgress(index, urls.length, url, title, '等待视频信息', (attempt / 30) * 100);
        try {
          const current = await getPageInfo(wc);
          if (current && current.title) {
            info = current;
            title = current.title;
          }
          bundle = await getSubtitles(wc);
          if (bundle.tracks.length || bundle.needLogin) break;
        } catch {
          // 页面还在加载，重试
        }
        await sleep(1000);
      }

      if (!info) throw new Error('读取视频信息失败');
      if (bundle?.needLogin) throw new Error('需要登录 B 站才能读取字幕');
      if (!bundle || !bundle.tracks.length) throw new Error('没有可用字幕');

      const track = chooseTrack(bundle, info);
      if (!track) throw new Error('没有可用字幕轨');
      onProgress(index, urls.length, url, title, '下载字幕', 40);
      const body = await getTrackBody(track.url);
      const lines: SubtitleLine[] = applyCorrectionToLines(body.lines, settings);
      if (!lines.length) throw new Error('字幕正文为空');

      onProgress(index, urls.length, url, title, '写入本地库', 65);
      ingestVideo({ info, track, lines });
      succeeded += 1;

      if (withSummary) {
        onProgress(index, urls.length, url, title, '生成总结', 80);
        try {
          const result = await summarize({ info, lines, signal });
          saveSummary(info, result.text, result.model);
        } catch (error) {
          failed.push({
            url,
            title,
            error: `已入库，总结失败：${(error as Error).message}`
          });
        }
      }
      onProgress(index, urls.length, url, title, '完成', 100);
    } catch (error) {
      if (signal?.aborted) throw new Error('已终止');
      failed.push({ url, title, error: (error as Error)?.message || String(error) });
    } finally {
      if (tabId) tabs.close(tabId);
    }
  }

  return { succeeded, failed };
}
