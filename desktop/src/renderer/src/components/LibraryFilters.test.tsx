// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LibraryFilters } from './LibraryFilters';

function props(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    sort: 'updated' as const,
    onSort: vi.fn(),
    tags: [{ name: '标签A', count: 2 }],
    tagFilter: '',
    onTagFilter: vi.fn(),
    collections: [{ id: 1, name: '合集A', count: 3, createdAt: 0 }],
    collectionFilter: '',
    onCollectionFilter: vi.fn(),
    onManage: vi.fn(),
    ...overrides
  };
}

describe('LibraryFilters', () => {
  afterEach(cleanup);

  it('展开时渲染排序与筛选项', () => {
    render(<LibraryFilters {...props()} />);
    expect(screen.getByTitle('排序')).toBeTruthy();
    expect(screen.getByTitle('按标签筛选')).toBeTruthy();
    expect(screen.getByTitle('按合集筛选')).toBeTruthy();
  });

  it('切换排序与筛选会回调', () => {
    const p = props();
    render(<LibraryFilters {...p} />);
    fireEvent.change(screen.getByTitle('排序'), { target: { value: 'title' } });
    expect(p.onSort).toHaveBeenCalledWith('title');
    fireEvent.change(screen.getByTitle('按标签筛选'), { target: { value: '标签A' } });
    expect(p.onTagFilter).toHaveBeenCalledWith('标签A');
    fireEvent.change(screen.getByTitle('按合集筛选'), { target: { value: '合集A' } });
    expect(p.onCollectionFilter).toHaveBeenCalledWith('合集A');
  });

  it('收起时只显示筛选摘要，清除会清空两个条件', () => {
    const p = props({ open: false, tagFilter: '标签A', collectionFilter: '合集A' });
    render(<LibraryFilters {...p} />);
    expect(screen.getByText('标签：标签A')).toBeTruthy();
    expect(screen.getByText('合集：合集A')).toBeTruthy();
    fireEvent.click(screen.getByText('清除'));
    expect(p.onTagFilter).toHaveBeenCalledWith('');
    expect(p.onCollectionFilter).toHaveBeenCalledWith('');
  });

  it('收起且无筛选时不渲染任何内容', () => {
    const { container } = render(<LibraryFilters {...props({ open: false })} />);
    expect(container.firstChild).toBeNull();
  });
});
