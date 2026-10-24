// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DiagnosticsInfo } from '../../../../shared/types';
import { DiagnosticsSection } from './DiagnosticsSection';

const diagnostics = {
  version: '0.37.2',
  electron: '45.0.0',
  chrome: '156',
  node: '24',
  platform: 'win32',
  arch: 'x64',
  dataDir: 'C:\\data',
  settingsPath: 'C:\\data\\settings.json',
  dbPath: 'C:\\data\\library.db',
  library: { videos: 3, tracks: 4, segments: 50, bytes: 2 * 1024 * 1024 },
  logs: [{ name: 'main.log', size: 2048 }]
} as unknown as DiagnosticsInfo;

function props(overrides: Record<string, unknown> = {}) {
  return {
    diagnostics,
    fallbackVersion: '0.0.0',
    fallbackDataDir: 'D:\\fallback',
    onRefresh: vi.fn(),
    onCopy: vi.fn(),
    onExport: vi.fn(),
    ...overrides
  };
}

describe('DiagnosticsSection', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'bsub', {
      configurable: true,
      value: {
        openDataDir: vi.fn(async () => undefined),
        openExternal: vi.fn(async () => undefined),
        setWizardVisible: vi.fn(async () => ({ ok: true, data: null }))
      }
    });
  });
  afterEach(cleanup);

  it('展示版本、运行环境、库体积与日志', () => {
    render(<DiagnosticsSection {...props()} />);
    expect(screen.getByText('0.37.2')).toBeTruthy();
    expect(screen.getByText('45.0.0 / 156 / 24')).toBeTruthy();
    expect(screen.getAllByText(/3 视频/).length).toBeGreaterThan(0);
    expect(screen.getByText(/main.log 2.0 KB/)).toBeTruthy();
  });

  it('刷新 / 复制 / 导出回调', () => {
    const p = props();
    render(<DiagnosticsSection {...p} />);
    fireEvent.click(screen.getByText(/刷新/));
    fireEvent.click(screen.getByText('复制诊断'));
    fireEvent.click(screen.getByText(/导出诊断包/));
    expect(p.onRefresh).toHaveBeenCalled();
    expect(p.onCopy).toHaveBeenCalled();
    expect(p.onExport).toHaveBeenCalled();
  });

  it('没有诊断数据时用兜底版本并显示读取中', () => {
    render(<DiagnosticsSection {...props({ diagnostics: null, fallbackVersion: '9.9.9' })} />);
    expect(screen.getByText('9.9.9')).toBeTruthy();
    expect(screen.getAllByText('读取中').length).toBeGreaterThan(0);
  });
});
