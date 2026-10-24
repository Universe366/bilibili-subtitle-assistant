import { describe, expect, it } from 'vitest';
import type { LibraryVideo } from '../../../shared/types';
import { SORTS, kindLabel, metaLine, safeFilename } from './libraryView';

const video: LibraryVideo = {
  id: 1,
  bvid: null,
  cid: null,
  title: '标题',
  owner: 'UP 主',
  duration: 3725,
  cover: null,
  url: 'https://example.com/a',
  kind: 'video',
  source: 'bilibili',
  createdAt: 0,
  updatedAt: 0,
  summaryUpdatedAt: null,
  tags: [],
  collections: [],
  trackCount: 1,
  lineCount: 1234,
  chars: 100
};

describe('libraryView', () => {
  it('kindLabel 映射已知类型，未知返回空串', () => {
    expect(kindLabel(video)).toBe('视频');
    expect(kindLabel({ ...video, kind: 'podcast' })).toBe('播客');
    expect(kindLabel({ ...video, kind: 'unknown-kind' })).toBe('');
  });

  it('metaLine 组合类型 / UP / 时长 / 行数', () => {
    expect(metaLine(video)).toBe('视频 · UP 主 · 1:02:05 · 1,234 行');
  });

  it('metaLine 缺字段时降级', () => {
    const bare = { ...video, owner: '', duration: 0, lineCount: 0 };
    expect(metaLine(bare)).toBe('视频 · 未知 UP');
    const page = { ...bare, kind: 'page' };
    expect(metaLine(page)).toBe('网页 · 网页');
  });

  it('safeFilename 去掉非法字符并兜底', () => {
    expect(safeFilename('a/b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i');
    expect(safeFilename('   ')).toBe('笔记');
    expect(safeFilename('x'.repeat(80))).toHaveLength(60);
  });

  it('SORTS 覆盖四种排序', () => {
    expect(SORTS.map((item) => item.id)).toEqual(['updated', 'created', 'title', 'duration']);
  });
});
