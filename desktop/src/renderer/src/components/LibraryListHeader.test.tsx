// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LibraryListHeader } from './LibraryListHeader';

function props(overrides: Record<string, unknown> = {}) {
  return {
    query: '',
    onQuery: vi.fn(),
    filtersOpen: false,
    filterActive: false,
    selectMode: false,
    canSelect: true,
    loading: false,
    onToggleFilters: vi.fn(),
    onNewCollection: vi.fn(),
    onImport: vi.fn(),
    onOpenTrash: vi.fn(),
    onToggleSelect: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides
  };
}

describe('LibraryListHeader', () => {
  afterEach(cleanup);

  it('搜索输入回调', () => {
    const p = props();
    render(<LibraryListHeader {...p} />);
    fireEvent.change(screen.getByPlaceholderText(/搜索标题/), { target: { value: '关键词' } });
    expect(p.onQuery).toHaveBeenCalledWith('关键词');
  });

  it('按钮分别回调', () => {
    const p = props();
    render(<LibraryListHeader {...p} />);
    fireEvent.click(screen.getByText('＋合集'));
    fireEvent.click(screen.getByText('导入链接'));
    fireEvent.click(screen.getByText('筛选'));
    fireEvent.click(screen.getByTitle('回收站'));
    fireEvent.click(screen.getByText('选择'));
    fireEvent.click(screen.getByTitle('刷新'));
    expect(p.onNewCollection).toHaveBeenCalled();
    expect(p.onImport).toHaveBeenCalled();
    expect(p.onToggleFilters).toHaveBeenCalled();
    expect(p.onOpenTrash).toHaveBeenCalled();
    expect(p.onToggleSelect).toHaveBeenCalled();
    expect(p.onRefresh).toHaveBeenCalled();
  });

  it('没有视频时选择禁用；选择模式显示「取消」', () => {
    const { rerender } = render(<LibraryListHeader {...props({ canSelect: false })} />);
    expect((screen.getByText('选择') as HTMLButtonElement).disabled).toBe(true);
    rerender(<LibraryListHeader {...props({ selectMode: true })} />);
    expect(screen.getByText('取消')).toBeTruthy();
  });

  it('筛选激活时按钮带 is-active', () => {
    render(<LibraryListHeader {...props({ filtersOpen: true })} />);
    expect((screen.getByText('筛选') as HTMLButtonElement).className).toContain('is-active');
  });
});
