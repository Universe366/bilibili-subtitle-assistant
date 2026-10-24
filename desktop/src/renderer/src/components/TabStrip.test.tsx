// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TabInfo } from '../../../shared/types';
import { TabStrip } from './TabStrip';

const tabs: TabInfo[] = [
  {
    id: 't1',
    title: 'B 站首页',
    url: 'https://www.bilibili.com/',
    loading: false,
    active: true,
    canGoBack: false,
    canGoForward: false,
    suspended: false,
    zoom: 1
  },
  {
    id: 't2',
    title: '',
    url: 'https://example.com',
    loading: false,
    active: false,
    canGoBack: false,
    canGoForward: false,
    suspended: true,
    zoom: 1
  }
];

function installBsub() {
  const api = { activateTab: vi.fn(async () => ({ ok: true })), closeTab: vi.fn(), newTab: vi.fn() };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

describe('TabStrip', () => {
  beforeEach(() => installBsub());
  afterEach(cleanup);

  it('渲染标签标题，空标题回退为「新标签页」', () => {
    render(<TabStrip tabs={tabs} />);
    expect(screen.getByText('B 站首页')).toBeTruthy();
    expect(screen.getByText('新标签页')).toBeTruthy();
  });

  it('点击标签激活，点关闭调用 closeTab 并阻止冒泡', () => {
    const api = installBsub();
    render(<TabStrip tabs={tabs} />);
    fireEvent.click(screen.getByText('B 站首页'));
    expect(api.activateTab).toHaveBeenCalledWith('t1');

    const closeButtons = screen.getAllByTitle('关闭标签页');
    fireEvent.click(closeButtons[1]);
    expect(api.closeTab).toHaveBeenCalledWith('t2');
    expect(api.activateTab).toHaveBeenCalledTimes(1);
  });

  it('休眠标签带提示，新建与搜索按钮可用', () => {
    const api = installBsub();
    const onSearch = vi.fn();
    render(<TabStrip tabs={tabs} onSearch={onSearch} />);
    expect(screen.getByTitle(/已休眠/)).toBeTruthy();
    fireEvent.click(screen.getByTitle('新建标签页'));
    expect(api.newTab).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle(/全局搜索/));
    expect(onSearch).toHaveBeenCalled();
  });
});
