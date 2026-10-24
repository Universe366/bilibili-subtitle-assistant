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
    newTab: vi.fn()
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
    ...overrides
  };
}

describe('AddressBar', () => {
  beforeEach(() => installBsub());
  afterEach(cleanup);

  it('展示 URL、缩放与书签状态', () => {
    const { container } = render(<AddressBar {...props()} />);
    expect(screen.getByDisplayValue(tab.url)).toBeTruthy();
    expect(screen.getByText('125%')).toBeTruthy();
    expect((container.querySelector('.nav-btn.is-active') as HTMLElement) ?? null).toBeNull();
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

  it('书签、阅读模式、面板与首页按钮回调', () => {
    const p = props({ bookmarked: true });
    const api = installBsub();
    render(<AddressBar {...p} />);
    fireEvent.click(screen.getByTitle(/取消书签/));
    expect(p.onToggleBookmark).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle(/阅读模式/));
    expect(p.onOpenReader).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('历史 / 书签 / 下载'));
    expect(p.onOpenHub).toHaveBeenCalledWith('history');
    fireEvent.click(screen.getByTitle('打开 B 站首页'));
    expect(api.newTab).toHaveBeenCalledWith('https://www.bilibili.com/');
  });

  it('没有标签页时阅读模式与书签禁用', () => {
    render(<AddressBar {...props({ tab: null, bookmarked: false })} />);
    expect((screen.getByTitle(/阅读模式/) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle(/收藏此页/) as HTMLButtonElement).disabled).toBe(true);
  });
});
