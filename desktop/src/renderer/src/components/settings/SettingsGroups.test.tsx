// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppSettings } from '../../../../shared/types';
import { AddressSearchGroup } from './AddressSearchGroup';
import { AppearanceGroup } from './AppearanceGroup';
import { EfficiencyGroup } from './EfficiencyGroup';
import { ReadingGroup } from './ReadingGroup';
import { SessionsGroup } from './SessionsGroup';

const value = {
  theme: 'system',
  closeToTray: true,
  suspendMinutes: 5,
  cacheSubtitles: true,
  subtitleCacheDays: 30,
  fontScale: 1,
  sidebarWidth: 320,
  sidebarPosition: 'left',
  sidebarCollapsed: false,
  autoFollow: true,
  wizardDone: false,
  restoreSession: true,
  selectionToolbar: true,
  searchEngine: 'bilibili',
  searchEngineCustom: '',
  verticalTabs: false,
  petEnabled: false,
  assistantEnabled: false,
  petX: 0,
  petY: 0
} as AppSettings['general'];

function props(overrides: Record<string, unknown> = {}) {
  return { value, onChange: vi.fn(), ...overrides };
}

function Groups({ value, onChange }: { value: AppSettings['general']; onChange: (patch: Partial<AppSettings['general']>) => void }) {
  return (
    <>
      <AppearanceGroup value={value} onChange={onChange} />
      <SessionsGroup value={value} onChange={onChange} />
      <AddressSearchGroup value={value} onChange={onChange} />
      <ReadingGroup value={value} onChange={onChange} />
      <EfficiencyGroup value={value} onChange={onChange} />
    </>
  );
}

describe('GeneralSection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('渲染主题与侧栏位置', () => {
    render(<Groups {...props()} />);
    expect((screen.getByDisplayValue('跟随系统') as HTMLSelectElement).value).toBe('system');
    expect((screen.getByDisplayValue('左侧') as HTMLSelectElement).value).toBe('left');
  });

  it('切换主题、侧栏位置与开关都回传局部补丁', () => {
    const p = props();
    render(<Groups {...p} />);
    fireEvent.change(screen.getByDisplayValue('跟随系统'), { target: { value: 'dark' } });
    expect(p.onChange).toHaveBeenCalledWith({ theme: 'dark' });
    fireEvent.click(screen.getByLabelText('关闭窗口时缩到托盘'));
    expect(p.onChange).toHaveBeenCalledWith({ closeToTray: false });
  });

  it('桌宠与悬浮球开关回传补丁', () => {
    const p = props();
    render(<Groups {...p} />);
    fireEvent.click(screen.getByLabelText(/AI 悬浮球/));
    expect(p.onChange).toHaveBeenCalledWith({ assistantEnabled: true });
    fireEvent.click(screen.getByLabelText(/桌面宠物/));
    expect(p.onChange).toHaveBeenCalledWith({ petEnabled: true });
  });

  it('垂直标签栏开关回传补丁', () => {
    const p = props();
    render(<Groups {...p} />);
    fireEvent.click(screen.getByLabelText(/垂直标签栏/));
    expect(p.onChange).toHaveBeenCalledWith({ verticalTabs: true });
  });

  it('侧栏宽度超范围时夹到 260–560', () => {
    const p = props();
    render(<Groups {...p} />);
    const width = screen.getByDisplayValue('320') as HTMLInputElement;
    fireEvent.change(width, { target: { value: '999' } });
    expect(p.onChange).toHaveBeenCalledWith({ sidebarWidth: 560 });
    fireEvent.change(width, { target: { value: '100' } });
    expect(p.onChange).toHaveBeenCalledWith({ sidebarWidth: 260 });
  });

  it('关闭字幕缓存后隐藏天数输入', () => {
    const p = props({ value: { ...value, cacheSubtitles: false } });
    render(<Groups {...p} />);
    expect(screen.queryByText(/字幕缓存天数/)).toBeNull();
  });

  it('字号滑杆显示百分比', () => {
    render(<Groups {...props({ value: { ...value, fontScale: 1.25 } })} />);
    expect(screen.getByText(/界面字号（125%）/)).toBeTruthy();
  });
});
