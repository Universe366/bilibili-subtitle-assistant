// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TabInfo } from '../../../shared/types';
import { AddressBar } from './AddressBar';

const tab = {
  id: 't1',
  title: '视频页',
  url: 'https://www.bilibili.com/video/BV1',
  loading: false,
  active: true,
  canGoBack: true,
  canGoForward: false,
  suspended: false,
  zoom: 1.25
} as TabInfo;

function installBsub() {
  const api = {
    navigate: vi.fn(async () => ({ ok: true as const, data: null })),
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    zoomReset: vi.fn(),
    listBrowseHistory: vi.fn(async () => ({
      ok: true as const,
      data: [
        { id: 1, url: 'https://www.bilibili.com/video/BV1', title: '历史里的视频', visitedAt: 1 },
        { id: 2, url: 'https://example.com/post', title: '历史文章', visitedAt: 2 }
      ]
    })),
    newTab: vi.fn(),
    setPlaybackRate: vi.fn(async () => ({ ok: true as const, data: 1.5 }))
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    tab,
    bookmarked: false,
    onToggleBookmark: vi.fn(),
    onOpenHub: vi.fn(),
    onOpenReader: vi.fn(),
    onOpenStart: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides
  };
}

describe('AddressBar', () => {
  beforeEach(() => installBsub());
  afterEach(cleanup);

  it('展示 URL、缩放与书签状态', () => {
    render(<AddressBar {...props()} />);
    expect(screen.getByDisplayValue(tab.url)).toBeTruthy();
    fireEvent.click(screen.getByTitle('菜单'));
    expect(screen.getByText(/重置缩放（125%/)).toBeTruthy();
  });

  it('按前后退/刷新调用 IPC，无历史时禁用', () => {
    const api = installBsub();
    render(<AddressBar {...props()} />);
    expect((screen.getByTitle('后退') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTitle('前进') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTitle('后退'));
    fireEvent.click(screen.getByTitle('刷新'));
    expect(api.back).toHaveBeenCalled();
    expect(api.reload).toHaveBeenCalled();
  });

  it('输入地址回车导航，Esc 复原', () => {
    const api = installBsub();
    render(<AddressBar {...props()} />);
    const input = screen.getByDisplayValue(tab.url);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'BV1xx411c7mD' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(api.navigate).toHaveBeenCalledWith('BV1xx411c7mD');

    fireEvent.change(input, { target: { value: '临时输入' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByDisplayValue(tab.url)).toBeTruthy();
  });

  it('书签、起始页与菜单项回调', () => {
    const p = props({ bookmarked: true });
    render(<AddressBar {...p} />);

    fireEvent.click(screen.getByTitle(/取消书签/));
    expect(p.onToggleBookmark).toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('起始页'));
    expect(p.onOpenStart).toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('菜单'));
    fireEvent.click(screen.getByText('历史记录'));
    expect(p.onOpenHub).toHaveBeenCalledWith('history');

    fireEvent.click(screen.getByTitle('菜单'));
    fireEvent.click(screen.getByText(/阅读模式/));
    expect(p.onOpenReader).toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('设置'));
    expect(p.onOpenSettings).toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('菜单'));
    fireEvent.click(screen.getByText('倍速 1.5×'));
    expect(window.bsub.setPlaybackRate).toHaveBeenCalledWith(1.5);
  });

  it('没有标签页时阅读模式与书签禁用', () => {
    render(<AddressBar {...props({ tab: null, bookmarked: false })} />);
    expect((screen.getByTitle(/收藏此页/) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTitle('起始页')).toBeTruthy();
  });

  it('聚焦后给出历史建议，方向键与回车打开', async () => {
    const api = installBsub();
    render(<AddressBar {...props()} />);
    const input = screen.getByDisplayValue(tab.url);
    fireEvent.focus(input);

    const first = await screen.findByText('历史里的视频', undefined, { timeout: 2000 });
    expect(api.listBrowseHistory).toHaveBeenCalled();
    expect(screen.getByText('历史文章')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(api.navigate).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1' === tab.url ? tab.url : 'https://www.bilibili.com/video/BV1');
    expect(first).toBeTruthy();
  });

  it('没有建议时回车仍然按地址导航', () => {
    const api = installBsub();
    render(<AddressBar {...props()} />);
    const input = screen.getByDisplayValue(tab.url);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'example.org' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(api.navigate).toHaveBeenCalledWith('example.org');
  });
});

