// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LibraryList, LibraryVideo } from '../../../shared/types';
import { LibraryPanel } from './LibraryPanel';

function makeVideo(id: number): LibraryVideo {
  return {
    id,
    bvid: `BV${id}`,
    cid: 1,
    title: `视频 ${id}`,
    owner: 'UP',
    duration: 60,
    cover: null,
    url: `https://www.bilibili.com/video/BV${id}`,
    kind: 'video',
    source: 'bilibili',
    createdAt: id,
    updatedAt: id,
    summaryUpdatedAt: null,
    tags: [],
    collections: [],
    trackCount: 1,
    lineCount: 10,
    chars: 100
  };
}

const list = {
  videos: Array.from({ length: 300 }, (_, index) => makeVideo(index + 1)),
  stats: { videos: 300, tracks: 300, segments: 3000, bytes: 0 },
  total: 300
} as LibraryList;

function installBsub() {
  const api = {
    listLibrary: vi.fn(async () => ({ ok: true as const, data: list })),
    listTags: vi.fn(async () => ({ ok: true as const, data: [] })),
    listCollections: vi.fn(async () => ({ ok: true as const, data: [] })),
    listTrash: vi.fn(async () => ({ ok: true as const, data: [] })),
    onLibraryChanged: vi.fn(() => () => {})
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
}

describe('LibraryPanel 列表窗口化', () => {
  afterEach(cleanup);

  it('300 条只渲染前 80 条，滚动后追加', async () => {
    installBsub();
    const { container } = render(<LibraryPanel />);
    await screen.findByText('视频 1');

    const rows = () => container.querySelectorAll('.lib-video');
    expect(rows().length).toBe(80);

    const scroller = container.querySelector('.lib-videos') as HTMLDivElement;
    fireEvent.scroll(scroller);
    await waitFor(() => expect(rows().length).toBe(160));

    fireEvent.scroll(scroller);
    await waitFor(() => expect(rows().length).toBe(240));
  });

  it('列表只渲染可见条数时仍可打开详情', async () => {
    installBsub();
    render(<LibraryPanel />);
    fireEvent.click(await screen.findByText('视频 1'));
    expect(await screen.findByText(/第一句|没有入库字幕|读取中/)).toBeTruthy();
  });
});
