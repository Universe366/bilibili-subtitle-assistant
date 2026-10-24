// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SitePermissionsSection } from './SitePermissionsSection';

const items = [
  { origin: 'https://a.example', permission: 'media', decision: 'allow' as const },
  { origin: 'https://b.example', permission: 'notifications', decision: 'deny' as const }
];

function props(overrides: Record<string, unknown> = {}) {
  return {
    items,
    onRevoke: vi.fn(),
    onRefresh: vi.fn(),
    onClear: vi.fn(),
    ...overrides
  };
}

describe('SitePermissionsSection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('列出权限并翻译中文标签', () => {
    render(<SitePermissionsSection {...props()} />);
    expect(screen.getByText('https://a.example · 摄像头 / 麦克风')).toBeTruthy();
    expect(screen.getByText('允许')).toBeTruthy();
    expect(screen.getByText('拒绝')).toBeTruthy();
  });

  it('撤销单条权限', () => {
    const p = props();
    render(<SitePermissionsSection {...p} />);
    fireEvent.click(screen.getAllByText('撤销')[0]);
    expect(p.onRevoke).toHaveBeenCalledWith('https://a.example', 'media');
  });

  it('刷新与清除全部回调；空列表时清除禁用', () => {
    const p = props();
    const { rerender } = render(<SitePermissionsSection {...p} />);
    fireEvent.click(screen.getByText('刷新'));
    fireEvent.click(screen.getByText('清除全部'));
    expect(p.onRefresh).toHaveBeenCalled();
    expect(p.onClear).toHaveBeenCalled();

    rerender(<SitePermissionsSection {...props({ items: [] })} />);
    expect(screen.getByText('还没有记住任何站点权限。')).toBeTruthy();
    expect((screen.getByText('清除全部') as HTMLButtonElement).disabled).toBe(true);
  });
});
