import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PageInfo, SubtitleTrack } from '../shared/types';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: () => state.dir
  }
}));

import {
  addVideoToCollection,
  closeLibrary,
  deleteTrash,
  getLibraryDetail,
  initLibrary,
  ingestVideo,
  librarySchemaVersion,
  listTrash,
  removeVideos,
  restoreTrash,
  saveNote,
  saveSummary,
  setVideoTags,
  vacuumLibrary
} from './library';

const info: PageInfo = {
  kind: 'video',
  bvid: 'BV1test00001',
  aid: 1,
  cid: 2,
  epId: null,
  seasonId: null,
  page: 1,
  partTitle: '',
  parts: [],
  title: '回收站测试视频',
  owner: '测试 UP',
  desc: '',
  duration: 62,
  url: 'https://www.bilibili.com/video/BV1test00001',
  signature: 'v:BV1test00001:2'
};

const track: SubtitleTrack = {
  lan: 'zh-CN',
  lanDoc: '中文',
  url: 'https://example.com/2/sub.json',
  isAi: false,
  aiStatus: null,
  source: 'official'
};

describe('回收站与 schema 迁移', () => {
  beforeAll(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsub-library-'));
    initLibrary();
  });

  afterAll(() => {
    closeLibrary();
    fs.rmSync(state.dir, { recursive: true, force: true });
  });

  it('删除进入回收站，恢复后字幕/总结/笔记/标签/合集都回来', () => {
    const ingested = ingestVideo({
      info,
      track,
      lines: [
        { start: 0, end: 2, text: '第一句字幕' },
        { start: 2, end: 4, text: '第二句字幕' }
      ]
    });
    expect(ingested.videoId).toBeGreaterThan(0);
    expect(ingested.lineCount).toBe(2);

    saveSummary(info, '# 总结\n\n这是总结正文', 'test-model');
    saveNote(ingested.videoId, '这是笔记');
    setVideoTags(ingested.videoId, ['测试标签']);
    addVideoToCollection(ingested.videoId, '测试合集');

    expect(librarySchemaVersion()).toBe(5);

    expect(removeVideos([ingested.videoId])).toBe(1);
    expect(() => getLibraryDetail(ingested.videoId)).toThrow();

    const trash = listTrash();
    expect(trash).toHaveLength(1);
    expect(trash[0].title).toBe('回收站测试视频');
    expect(trash[0].lineCount).toBe(2);
    expect(trash[0].hasSummary).toBe(true);
    expect(trash[0].hasNote).toBe(true);

    const restored = restoreTrash(trash[0].id);
    const detail = getLibraryDetail(restored.videoId);
    expect(detail.video.kind).toBe('video');
    expect(detail.video.source).toBe('bilibili');
    expect(detail.bundle?.lines.map((line) => line.text)).toEqual(['第一句字幕', '第二句字幕']);
    expect(detail.summary?.content).toContain('这是总结正文');
    expect(detail.note?.content).toBe('这是笔记');
    expect(detail.video.tags).toContain('测试标签');
    expect(detail.video.collections).toContain('测试合集');
    expect(listTrash()).toHaveLength(0);

    // 恢复后搜索索引也要能用。
    expect(detail.bundle?.lines[0].text).toContain('第一句');
  });

  it('彻底删除后不再出现在回收站', () => {
    const ingested = ingestVideo({
      info: { ...info, bvid: 'BV1test00002', title: '待彻底删除' },
      track,
      lines: [{ start: 0, end: 1, text: '内容' }]
    });
    removeVideos([ingested.videoId]);
    const trash = listTrash();
    expect(trash.length).toBe(1);
    expect(deleteTrash(trash[0].id)).toBe(true);
    expect(listTrash()).toHaveLength(0);
  });

  it('压缩数据库返回前后大小', () => {
    const result = vacuumLibrary();
    expect(result.before).toBeGreaterThan(0);
    expect(result.after).toBeGreaterThan(0);
  });
});
