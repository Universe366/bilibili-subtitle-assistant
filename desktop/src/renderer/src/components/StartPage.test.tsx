// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StartPage } from './StartPage';

function installBsub() {
  const api = {
    listLibrary: vi.fn(async () => ({
      ok: true as const,
      data: {
        videos: [
          { id: 1, title: '最近视频', owner: 'UP', url: 'https://www.bilibili.com/video/BV1' }
        ]
      }
    }))
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    onNavigate: vi.fn(),
    onOpenLibrary: vi.fn(),
    onOpenHistory: vi.fn(),
    onOpenTasks: vi.fn(),
    onOpenSettings: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };
}

describe('StartPage', () => {
  afterEach(cleanup);

  it('搜索框回车跳转并关闭', () => {
    installBsub();
    const p = props();
    render(<StartPage {...p} />);
    const input = screen.getByPlaceholderText(/搜索、输入网址/);
    fireEvent.change(input, { target: { value: 'BV1xx411c7mD' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onNavigate).toHaveBeenCalledWith('BV1xx411c7mD');
    expect(p.onClose).toHaveBeenCalled();
  });

  it('空输入不跳转', () => {
    installBsub();
    const p = props();
    render(<StartPage {...p} />);
    fireEvent.click(screen.getByText('打开'));
    expect(p.onNavigate).not.toHaveBeenCalled();
  });

  it('快捷入口分别回调', () => {
    installBsub();
    const p = props();
    render(<StartPage {...p} />);
    fireEvent.click(screen.getByText('字幕库'));
    fireEvent.click(screen.getByText('历史记录'));
    fireEvent.click(screen.getByText('任务中心'));
    fireEvent.click(screen.getByText('设置'));
    expect(p.onOpenLibrary).toHaveBeenCalled();
    expect(p.onOpenHistory).toHaveBeenCalled();
    expect(p.onOpenTasks).toHaveBeenCalled();
    expect(p.onOpenSettings).toHaveBeenCalled();
  });

  it('展示最近的库条目，点击打开', async () => {
    installBsub();
    const p = props();
    render(<StartPage {...p} />);
    const item = await screen.findByText('最近视频');
    fireEvent.click(item);
    expect(p.onNavigate).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1');
  });
});
