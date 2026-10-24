// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LibraryDetail, LibraryList, LibraryVideo } from '../../../shared/types';
import { LibraryPanel } from './LibraryPanel';

const video: LibraryVideo = {
  id: 7,
  bvid: 'BV1xx411c7mD',
  cid: 1,
  title: '组件测试视频',
  owner: '自检 UP',
  duration: 90,
  cover: null,
  url: 'https://www.bilibili.com/video/BV1xx411c7mD',
  kind: 'video',
  source: 'bilibili',
  createdAt: 1,
  updatedAt: 2,
  summaryUpdatedAt: null,
  tags: [],
  collections: [],
  trackCount: 1,
  lineCount: 3,
  chars: 30
};

const list: LibraryList = {
  videos: [video],
  stats: { videos: 1, tracks: 1, segments: 3, bytes: 1024 },
  total: 1
};

const detail: LibraryDetail = {
  video,
  bundle: {
    info: {
      kind: 'video',
      bvid: 'BV1xx411c7mD',
      aid: 1,
      cid: 1,
      epId: null,
      seasonId: null,
      page: 1,
      partTitle: '',
      parts: [],
      title: '组件测试视频',
      owner: '自检 UP',
      desc: '',
      duration: 90,
      url: video.url,
      signature: 'sig'
    },
    track: {
      lan: 'zh-CN',
      lanDoc: '中文',
      url: 'https://example.invalid/a.json',
      isAi: false,
      aiStatus: null,
      source: 'bilibili'
    },
    lines: [
      { start: 0, end: 1, text: '第一句' },
      { start: 1, end: 2, text: '第二句' },
      { start: 2, end: 3, text: '第三句' }
    ]
  },
  summary: null,
  note: null
};

function installBsub() {
  const getLibraryItem = vi.fn(async () => ({ ok: true as const, data: detail }));
  const listLibrary = vi.fn(async () => ({ ok: true as const, data: list }));
  const api = {
    listLibrary,
    listTags: vi.fn(async () => ({ ok: true as const, data: [] })),
    listCollections: vi.fn(async () => ({ ok: true as const, data: [] })),
    listTrash: vi.fn(async () => ({ ok: true as const, data: [] })),
    getLibraryItem,
    getSettings: vi.fn(async () => ({ ok: false as const, error: 'not in test' })),
    onLibraryChanged: vi.fn(() => () => {}),
    onCollectionSummaryDone: vi.fn(() => () => {}),
    onCollectionSummaryError: vi.fn(() => () => {})
  };
  Object.defineProperty(window, 'bsub', {
    configurable: true,
    value: new Proxy(api, {
      get(target, prop) {
        if (prop in target) return (target as Record<string, unknown>)[prop as string];
        if (typeof prop === 'string' && prop.startsWith('on')) return () => () => {};
        return vi.fn(async () => ({ ok: true as const, data: null }));
      }
    })
  });
  return { getLibraryItem, listLibrary };
}

describe('LibraryPanel', () => {
  beforeEach(() => {
    installBsub();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('加载后渲染库列表', async () => {
    render(<LibraryPanel />);
    expect(await screen.findByText('组件测试视频')).toBeTruthy();
    expect(screen.getByText(/自检 UP/)).toBeTruthy();
  });

  it('点击条目后打开详情并展示字幕', async () => {
    const { getLibraryItem } = installBsub();
    render(<LibraryPanel />);
    fireEvent.click(await screen.findByText('组件测试视频'));

    await waitFor(() => expect(getLibraryItem).toHaveBeenCalledWith(7));
    expect(await screen.findByText(/第一句/)).toBeTruthy();
  });
});
