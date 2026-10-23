import { ipcMain } from 'electron';
import type {
  CollectionResolveResult,
  PageInfo,
  Result,
  SubtitleBundle,
  TrackBody
} from '../../shared/types';
import {
  getPageInfo,
  getSubtitles,
  getTime,
  getTrackBody,
  seek,
  triggerSubtitleMenu
} from '../page';
import { pageContextSummary, readPageContext } from '../pageContext';
import { resolveBilibiliCollection } from '../biliCollection';
import { applyCorrectionToLines } from '../correction';
import { loadSettings } from '../settings';
import { failure, type IpcContext } from './shared';

/** 当前页面（正文 / 视频信息 / 字幕 / 播放进度）相关 IPC。 */
export function registerPageIpc(ctx: IpcContext): void {
  ipcMain.handle('page:document', async () => {
    try {
      const context = await readPageContext(ctx.tabs.activeWebContents(), 200000);
      if (!context || !context.text.trim()) {
        return { ok: false as const, error: '当前页面没有可提取的正文' };
      }
      return {
        ok: true as const,
        data: { title: context.title, url: context.url, text: context.text }
      };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('page:context', async () => {
    try {
      const context = await readPageContext(ctx.tabs.activeWebContents());
      return { ok: true as const, data: pageContextSummary(context) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('page:info', async (): Promise<Result<PageInfo>> => {
    const wc = ctx.tabs.activeWebContents();
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
      const wc = ctx.tabs.activeWebContents();
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
    const wc = ctx.tabs.activeWebContents();
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
      const wc = ctx.tabs.activeWebContents();
      if (!wc) return { ok: false, error: '没有打开的页面' };
      try {
        return { ok: true, data: await getTime(wc) };
      } catch (error) {
        return failure<{ currentTime: number; duration: number }>(error);
      }
    }
  );

  ipcMain.handle('page:seek', async (_event, time: number): Promise<void> => {
    const wc = ctx.tabs.activeWebContents();
    if (!wc) return;
    try {
      await seek(wc, time);
    } catch (error) {
      console.warn('[m2] seek failed:', (error as Error).message);
    }
  });
}
