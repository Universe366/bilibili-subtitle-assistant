// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppSettings, BridgeStatus } from '../../../../shared/types';
import { BridgeSection } from './BridgeSection';

const value = { enabled: true, port: 47821, token: 'token-123' } as AppSettings['bridge'];

function props(overrides: Record<string, unknown> = {}) {
  return {
    value,
    status: { running: true, port: 47821 } as BridgeStatus,
    installing: false,
    onChange: vi.fn(),
    onInstall: vi.fn(),
    ...overrides
  };
}

describe('BridgeSection', () => {
  const writeClipboard = vi.fn(async () => undefined);
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'bsub', {
      configurable: true,
      value: { writeClipboard }
    });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('显示端口、Token 与运行状态', () => {
    render(<BridgeSection {...props()} />);
    expect(screen.getByText('token-123')).toBeTruthy();
    expect(screen.getByText(/运行中 · 127.0.0.1:47821/)).toBeTruthy();
  });

  it('未运行时显示原因', () => {
    render(<BridgeSection {...props({ status: { running: false, error: '端口被占用' } })} />);
    expect(screen.getByText(/未启动：端口被占用/)).toBeTruthy();
  });

  it('开关与端口变更会回调', () => {
    const p = props();
    render(<BridgeSection {...p} />);
    fireEvent.click(screen.getByLabelText('启用本机接收'));
    expect(p.onChange).toHaveBeenCalledWith({ ...value, enabled: false });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50000' } });
    expect(p.onChange).toHaveBeenCalledWith({ ...value, port: 50000 });
  });

  it('安装按钮回调、安装中禁用；复制写入剪贴板', () => {
    const p = props({ installing: true });
    render(<BridgeSection {...p} />);
    expect((screen.getAllByRole('button')[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('复制'));
    expect(writeClipboard).toHaveBeenCalledWith('token-123');
  });
});
