// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Bookmark, DownloadRecord, HistoryEntry, TabInfo } from '../../../shared/types';
import { BrowserHub } from './BrowserHub';

const tabs: TabInfo[] = [
  {
    id: 't1',
    title: '视频页',
    url: 'https://www.bilibili.com/video/BV1',
    loading: false,
    active: true,
    canGoBack: false,
    canGoForward: false,
    suspended: false,
    zoom: 1
  }
];

const history: HistoryEntry[] = [
  { id: 1, url: 'https://a.example', title: '历史页面 A', visitedAt: 1, bvid: null }
] as unknown as HistoryEntry[];

const bookmarks: Bookmark[] = [
  { url: 'https://b.example', title: '书签 B', createdAt: 1 }
] as Bookmark[];

const downloads: DownloadRecord[] = [
  {
    id: 1,
    url: 'https://c.example/file.mp4',
    filename: 'file.mp4',
    state: 'completed',
    total: 2048,
    received: 2048,
    path: 'C:/tmp/file.mp4',
    createdAt: 1,
    finished: true
  }
] as unknown as DownloadRecord[];

function installBsub() {
  const api = {
    listBrowseHistory: vi.fn(async () => ({ ok: true as const, data: history })),
    listBookmarks: vi.fn(async () => ({ ok: true as const, data: bookmarks })),
    listDownloads: vi.fn(async () => ({ ok: true as const, data: downloads })),
    clearBrowseHistory: vi.fn(async () => ({ ok: true as const, data: null })),
    removeBookmark: vi.fn(async () => ({ ok: true as const, data: null })),
    clearDownloads: vi.fn(async () => ({ ok: true as const, data: null })),
    onDownloadsChanged: vi.fn(() => () => {})
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
  return api;
}

const baseProps = {
  open: true,
  initial: 'history' as const,
  tabs,
  onClose: vi.fn(),
  onOpenUrl: vi.fn(),
  onSelectTab: vi.fn()
};

describe('BrowserHub', () => {
  beforeEach(() => {
    installBsub();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('关闭时不渲染', () => {
    const { container } = render(<BrowserHub {...baseProps} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('历史分页加载后展示条目，点条目打开 URL', async () => {
    const props = { ...baseProps };
    render(<BrowserHub {...props} />);
    const entry = await screen.findByText('历史页面 A');
    fireEvent.click(entry);
    expect(props.onOpenUrl).toHaveBeenCalledWith('https://a.example');
  });

  it('切换到书签可删除单条', async () => {
    const api = installBsub();
    render(<BrowserHub {...baseProps} />);
    fireEvent.click(screen.getAllByText('书签')[0]);
    expect(await screen.findByText('书签 B')).toBeTruthy();
    const remove = screen.getByTitle('移除书签');
    fireEvent.click(remove);
    await waitFor(() => expect(api.removeBookmark).toHaveBeenCalledWith('https://b.example'));
    await waitFor(() => expect(screen.queryByText('书签 B')).toBeNull());
  });

  it('下载页展示文件与大小，清空需确认', async () => {
    const api = installBsub();
    render(<BrowserHub {...baseProps} />);
    fireEvent.click(screen.getAllByText('下载')[0]);
    expect(await screen.findByText('file.mp4')).toBeTruthy();
    expect(screen.getByText(/已完成 · 2 KB/)).toBeTruthy();
    fireEvent.click(screen.getByText('清空记录'));
    await waitFor(() => expect(api.clearDownloads).toHaveBeenCalled());
  });

  it('标签页列表可切换标签', async () => {
    const props = { ...baseProps };
    render(<BrowserHub {...props} />);
    fireEvent.click(screen.getByText(/^标签/));
    expect(await screen.findByText(/视频页/)).toBeTruthy();
    fireEvent.click(screen.getByText(/视频页/));
    expect(props.onSelectTab).toHaveBeenCalledWith('t1');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('历史加载失败时展示错误', async () => {
    Object.defineProperty(window, 'bsub', {
      configurable: true,
      value: new Proxy(
        { listBrowseHistory: vi.fn(async () => ({ ok: false as const, error: '数据库锁住' })) },
        {
          get(target, prop) {
            if (prop in target) return (target as Record<string, unknown>)[prop as string];
            if (typeof prop === 'string' && prop.startsWith('on')) return () => () => {};
            return vi.fn(async () => ({ ok: true as const, data: null }));
          }
        }
      )
    });
    render(<BrowserHub {...baseProps} />);
    expect(await screen.findByText(/数据库锁住/)).toBeTruthy();
  });
});
