// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppSettings, UpdateStatus } from '../../../../shared/types';
import { UpdateSection } from './UpdateSection';

const value = {
  autoCheck: true,
  autoDownload: false,
  feedUrl: '',
  mirrorUrl: '',
  autoFallback: true,
  skippedVersion: ''
} as AppSettings['update'];

function props(overrides: Record<string, unknown> = {}) {
  return {
    version: '0.37.2',
    status: { state: 'idle', version: '', progress: 0 } as unknown as UpdateStatus,
    statusText: '尚未检查',
    value,
    onChange: vi.fn(),
    onCheck: vi.fn(),
    onDownload: vi.fn(),
    onSkip: vi.fn(),
    onInstall: vi.fn(),
    onOpenReleases: vi.fn(),
    ...overrides
  };
}

describe('UpdateSection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('展示当前版本与状态文案', () => {
    render(<UpdateSection {...props()} />);
    expect(screen.getByText('v0.37.2')).toBeTruthy();
    expect(screen.getByText('尚未检查')).toBeTruthy();
  });

  it('可以填写镜像地址并切换自动测速', () => {
    const p = props();
    render(<UpdateSection {...p} />);
    fireEvent.change(screen.getByPlaceholderText(/gitee\.com/), {
      target: { value: 'https://gitee.com/u/r/releases/download/v1' }
    });
    expect(p.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ mirrorUrl: 'https://gitee.com/u/r/releases/download/v1' })
    );
    fireEvent.click(screen.getByLabelText(/自动测速/));
    expect(p.onChange).toHaveBeenCalledWith(expect.objectContaining({ autoFallback: false }));
  });

  it('显示本次实际使用的更新源', () => {
    render(
      <UpdateSection
        {...props({
          status: { state: 'checking', source: 'mirror' } as UpdateStatus,
          statusText: '检查中'
        })}
      />
    );
    expect(screen.getByText(/源：镜像/)).toBeTruthy();
  });

  it('有新版本时可下载与跳过', () => {
    const p = props({
      status: { state: 'available', version: '0.37.3', notes: '修复内容' } as UpdateStatus,
      statusText: '发现新版本 v0.37.3'
    });
    render(<UpdateSection {...p} />);
    const download = screen
      .getAllByRole('button')
      .find((button) => button.className.includes('primary') && button.textContent?.includes('下载'));
    fireEvent.click(download as HTMLButtonElement);
    fireEvent.click(screen.getByText('跳过此版本'));
    expect(p.onDownload).toHaveBeenCalled();
    expect(p.onSkip).toHaveBeenCalled();
    expect(screen.getByText('修复内容')).toBeTruthy();
  });

  it('已下载时提供重启安装，检查按钮禁用条件', () => {
    const p = props({
      status: { state: 'downloaded', version: '0.37.3' } as UpdateStatus,
      statusText: '已下载'
    });
    const { rerender } = render(<UpdateSection {...p} />);
    fireEvent.click(screen.getByText('重启安装'));
    expect(p.onInstall).toHaveBeenCalled();

    rerender(
      <UpdateSection {...props({ status: { state: 'checking' } as UpdateStatus, statusText: '检查中' })} />
    );
    const check = screen.getAllByRole('button').find((button) => button.textContent?.includes('检查'));
    expect((check as HTMLButtonElement).disabled).toBe(true);
  });

  it('自动检查开关与更新源输入回调', () => {
    const p = props();
    render(<UpdateSection {...p} />);
    fireEvent.click(screen.getByLabelText('启动后自动检查'));
    expect(p.onChange).toHaveBeenCalledWith({ ...value, autoCheck: false });
    fireEvent.change(screen.getByPlaceholderText(/GitHub Releases/), {
      target: { value: 'https://example.com/feed' }
    });
    expect(p.onChange).toHaveBeenCalledWith({ ...value, feedUrl: 'https://example.com/feed' });
  });
});
