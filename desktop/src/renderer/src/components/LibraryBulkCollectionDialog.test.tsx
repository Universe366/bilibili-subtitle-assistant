// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { LibraryCollection } from '../../../shared/types';
import { LibraryBulkCollectionDialog } from './LibraryBulkCollectionDialog';

const collections = [
  { id: 1, name: '合集A', count: 2 },
  { id: 2, name: '合集B', count: 0 }
] as unknown as LibraryCollection[];

function props(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    count: 3,
    collections,
    name: '',
    onName: vi.fn(),
    onPick: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };
}

describe('LibraryBulkCollectionDialog', () => {
  afterEach(cleanup);

  it('关闭时不渲染', () => {
    const { container } = render(<LibraryBulkCollectionDialog {...props({ open: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('显示数量与已有合集，点击即加入', () => {
    const p = props();
    render(<LibraryBulkCollectionDialog {...p} />);
    expect(screen.getByText(/把选中的 3 个视频加入合集/)).toBeTruthy();
    fireEvent.click(screen.getByText(/合集A（2）/));
    expect(p.onPick).toHaveBeenCalledWith('合集A');
  });

  it('没有合集时给提示', () => {
    render(<LibraryBulkCollectionDialog {...props({ collections: [] })} />);
    expect(screen.getByText(/还没有合集/)).toBeTruthy();
  });

  it('新建合集：空名禁用，回车提交', () => {
    const p = props({ name: '新合集' });
    render(<LibraryBulkCollectionDialog {...p} />);
    const input = screen.getByPlaceholderText('新建合集名称');
    fireEvent.change(input, { target: { value: '新合集2' } });
    expect(p.onName).toHaveBeenCalledWith('新合集2');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onPick).toHaveBeenCalledWith('新合集');
  });

  it('取消关闭', () => {
    const p = props();
    render(<LibraryBulkCollectionDialog {...p} />);
    fireEvent.click(screen.getByText('取消'));
    expect(p.onClose).toHaveBeenCalled();
  });
});
