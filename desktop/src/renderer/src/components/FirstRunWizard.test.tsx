// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SettingsSnapshot } from '../../../shared/types';
import { FirstRunWizard } from './FirstRunWizard';

function snapshot(overrides: { apiKey?: string; baseUrl?: string; name?: string } = {}) {
  return {
    version: '0.37.2',
    settings: {
      ai: {
        activeId: 'p1',
        platforms: [
          {
            id: 'p1',
            name: overrides.name ?? 'DeepSeek',
            baseUrl: overrides.baseUrl ?? 'https://api.example.com',
            apiKey: overrides.apiKey ?? '',
            model: 'deepseek-chat'
          }
        ]
      }
    }
  } as unknown as SettingsSnapshot;
}

describe('FirstRunWizard', () => {
  afterEach(cleanup);

  it('第一步展示欢迎信息', () => {
    render(<FirstRunWizard snapshot={snapshot()} onFinish={() => {}} />);
    expect(screen.getByText(/欢迎使用/)).toBeTruthy();
  });

  it('未配置 Key 时提示，下一步显示平台状态', () => {
    render(<FirstRunWizard snapshot={snapshot()} onFinish={() => {}} />);
    fireEvent.click(screen.getByText('下一步'));
    expect(screen.getByText(/还没有填 Key/)).toBeTruthy();
    expect(screen.getByText(/DeepSeek/)).toBeTruthy();
  });

  it('已配置 Key 时提示已配置', () => {
    render(<FirstRunWizard snapshot={snapshot({ apiKey: 'sk-real' })} onFinish={() => {}} />);
    fireEvent.click(screen.getByText('下一步'));
    expect(screen.getByText(/Key 已配置/)).toBeTruthy();
  });

  it('本地端点显示无需 Key', () => {
    render(
      <FirstRunWizard snapshot={snapshot({ baseUrl: 'http://127.0.0.1:11434/v1' })} onFinish={() => {}} />
    );
    fireEvent.click(screen.getByText('下一步'));
    expect(screen.getByText(/本地端点，无需 Key/)).toBeTruthy();
  });

  it('走完全部步骤后以「去设置」结束', () => {
    const onFinish = vi.fn();
    render(<FirstRunWizard snapshot={snapshot()} onFinish={onFinish} />);
    fireEvent.click(screen.getByText('下一步'));
    fireEvent.click(screen.getByText('去设置填写'));
    expect(onFinish).toHaveBeenCalledWith(true);
  });

  it('跳过直接结束', () => {
    const onFinish = vi.fn();
    render(<FirstRunWizard snapshot={snapshot()} onFinish={onFinish} />);
    fireEvent.click(screen.getByText('跳过引导'));
    expect(onFinish).toHaveBeenCalledWith(false);
  });
});
