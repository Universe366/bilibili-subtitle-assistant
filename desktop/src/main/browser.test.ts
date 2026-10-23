import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: () => state.dir
  }
}));

import {
  addDownload,
  clearBrowseHistory,
  clearDownloads,
  closeLibrary,
  deleteDownload,
  ingestVideo,
  initLibrary,
  isBookmarked,
  listBookmarks,
  listBrowseHistory,
  listDownloads,
  recordHistory,
  saveSummary,
  getLibraryDetail,
  toggleBookmark,
  updateDownload
} from './library';
import { callAppTool } from './appTools';
import type { PageInfo, SubtitleTrack } from '../shared/types';

const info: PageInfo = {
  kind: 'video',
  bvid: 'BV1tool000001',
  aid: 1,
  cid: 1,
  epId: null,
  seasonId: null,
  page: 1,
  partTitle: '',
  parts: [],
  title: 'Transformer 入门',
  owner: '测试 UP',
  desc: '',
  duration: 10,
  url: 'https://www.bilibili.com/video/BV1tool000001',
  signature: 'v:BV1tool000001:1'
};

const track: SubtitleTrack = {
  lan: 'zh-CN',
  lanDoc: '中文',
  url: 'https://example.com/tool.json',
  isAi: false,
  aiStatus: null,
  source: 'official'
};

describe('浏览器数据（历史 / 书签 / 下载）', () => {
  beforeAll(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsub-browser-'));
    initLibrary();
  });

  afterAll(() => {
    closeLibrary();
    fs.rmSync(state.dir, { recursive: true, force: true });
  });

  it('同一 URL 60 秒内只保留一条历史，标题会更新', () => {
    recordHistory({ url: 'https://example.com/a', title: '初始标题' });
    recordHistory({ url: 'https://example.com/a', title: '更新后的标题' });
    const rows = listBrowseHistory();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('更新后的标题');
    expect(listBrowseHistory('更新后')).toHaveLength(1);
    expect(listBrowseHistory('不存在的词')).toHaveLength(0);
    expect(clearBrowseHistory()).toBe(1);
  });

  it('非 http 地址不入历史', () => {
    recordHistory({ url: 'file:///tmp/a.html', title: '本地文件' });
    expect(listBrowseHistory()).toHaveLength(0);
  });

  it('书签可以添加、检查和移除', () => {
    const url = 'https://example.com/bookmark';
    expect(isBookmarked(url)).toBe(false);
    expect(toggleBookmark({ url, title: '书签页' })).toEqual({ bookmarked: true });
    expect(isBookmarked(url)).toBe(true);
    expect(listBookmarks().some((item) => item.url === url)).toBe(true);
    expect(toggleBookmark({ url })).toEqual({ bookmarked: false });
    expect(listBookmarks().some((item) => item.url === url)).toBe(false);
  });

  it('下载记录能更新进度并删除', () => {
    const id = addDownload({
      url: 'https://example.com/file.zip',
      filename: 'file.zip',
      total: 1000
    });
    updateDownload(id, { state: 'progressing', received: 500 });
    let rows = listDownloads();
    expect(rows[0].state).toBe('progressing');
    expect(rows[0].received).toBe(500);

    updateDownload(id, { state: 'completed', received: 1000, finished: true });
    rows = listDownloads();
    expect(rows[0].state).toBe('completed');
    expect(rows[0].finishedAt).toBeTruthy();

    expect(deleteDownload(id)).toBe(true);
    expect(listDownloads()).toHaveLength(0);
    expect(clearDownloads()).toBe(0);
  });

  it('AI 本地工具能搜库并读条目', async () => {
    const ingested = ingestVideo({
      info,
      track,
      lines: [
        { start: 0, end: 2, text: 'Transformer 的核心是注意力机制' },
        { start: 2, end: 4, text: '训练需要大量数据' }
      ]
    });

    const search = await callAppTool('app__search_library', { query: '注意力' });
    expect(search).toContain('Transformer 入门');
    expect(search).toContain('注意力机制');

    const detail = await callAppTool('app__read_library_item', { id: ingested.videoId });
    expect(detail).toContain('Transformer 入门');
    expect(detail).toContain('注意力机制');

    const recent = await callAppTool('app__list_recent', { limit: 5 });
    expect(recent).toContain('Transformer 入门');
  });

  it('网页总结可以单独入库（没有字幕轨）', () => {
    const pageInfo: PageInfo = {
      kind: 'page',
      bvid: null,
      aid: null,
      cid: null,
      epId: null,
      seasonId: null,
      page: 1,
      partTitle: '',
      parts: [],
      title: '某篇网页文章',
      owner: '',
      desc: '',
      duration: 0,
      url: 'https://example.com/article',
      signature: 'u:https://example.com/article'
    };
    const saved = saveSummary(pageInfo, '网页总结正文', 'mock');
    const detail = getLibraryDetail(saved.videoId);
    expect(detail.video.title).toBe('某篇网页文章');
    expect(detail.video.url).toBe('https://example.com/article');
    expect(detail.video.kind).toBe('page');
    expect(detail.video.source).toBe('example.com');
    expect(detail.summary?.content).toBe('网页总结正文');
    expect(detail.bundle).toBeNull();
  });
});
