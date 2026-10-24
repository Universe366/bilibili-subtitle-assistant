// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TrashItem } from '../../../shared/types';
import { LibraryTrashDialog } from './LibraryTrashDialog';

const item = {
  id: 1,
  videoId: 10,
  title: '被删视频',
  owner: 'UP',
  trackCount: 1,
  lineCount: 99,
  hasSummary: true,
  hasNote: false,
  deletedAt: 0
} as TrashItem;

function props(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    loading: false,
    items: [item],
    busyId: 0,
    onClose: vi.fn(),
    onRestore: vi.fn(),
    onPurge: vi.fn(),
    onClearAll: vi.fn(),
    ...overrides
  };
}

describe('LibraryTrashDialog', () => {
  afterEach(cleanup);

  it('关闭时不渲染', () => {
    const { container } = render(<LibraryTrashDialog {...props({ open: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('列出条目与元信息', () => {
    render(<LibraryTrashDialog {...props()} />);
    expect(screen.getByText('被删视频')).toBeTruthy();
    expect(screen.getByText(/含总结/)).toBeTruthy();
    expect(screen.getByText(/99 行/)).toBeTruthy();
  });

  it('恢复与彻底删除带条目回调', () => {
    const p = props();
    render(<LibraryTrashDialog {...p} />);
    fireEvent.click(screen.getByText('恢复'));
    fireEvent.click(screen.getByText('彻底删除'));
    expect(p.onRestore).toHaveBeenCalledWith(item);
    expect(p.onPurge).toHaveBeenCalledWith(item);
  });

  it('空回收站提示，清空按钮禁用', () => {
    render(<LibraryTrashDialog {...props({ items: [] })} />);
    expect(screen.getByText('回收站是空的')).toBeTruthy();
    expect((screen.getByText('清空回收站') as HTMLButtonElement).disabled).toBe(true);
  });

  it('读取中显示 loading', () => {
    render(<LibraryTrashDialog {...props({ loading: true })} />);
    expect(screen.getByText(/读取中/)).toBeTruthy();
  });
});
