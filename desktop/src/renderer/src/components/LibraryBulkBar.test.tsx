// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LibraryBulkBar } from './LibraryBulkBar';

function props(overrides: Record<string, unknown> = {}) {
  return {
    count: 2,
    visibleCount: 3,
    concurrency: 2,
    inputOpen: false,
    inputValue: '',
    inputKind: 'tag' as const,
    onConcurrency: vi.fn(),
    onSelectAll: vi.fn(),
    onSummarize: vi.fn(),
    onAddTag: vi.fn(),
    onAddCollection: vi.fn(),
    onDelete: vi.fn(),
    onCancel: vi.fn(),
    onInput: vi.fn(),
    onApply: vi.fn(),
    onCloseInput: vi.fn(),
    ...overrides
  };
}

describe('LibraryBulkBar', () => {
  afterEach(cleanup);

  it('显示已选数量，未选择时禁用总结与删除', () => {
    const { rerender } = render(<LibraryBulkBar {...props()} />);
    expect(screen.getByText('已选 2')).toBeTruthy();
    rerender(<LibraryBulkBar {...props({ count: 0 })} />);
    expect((screen.getByText('批量总结') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('删除') as HTMLButtonElement).disabled).toBe(true);
  });

  it('全选、批量操作与并发回调', () => {
    const p = props();
    render(<LibraryBulkBar {...p} />);
    fireEvent.click(screen.getByText('全选'));
    fireEvent.click(screen.getByText('批量总结'));
    fireEvent.click(screen.getByText('加标签'));
    fireEvent.click(screen.getByText('加合集'));
    fireEvent.change(screen.getByTitle('批量并发'), { target: { value: '4' } });
    expect(p.onSelectAll).toHaveBeenCalled();
    expect(p.onSummarize).toHaveBeenCalled();
    expect(p.onAddTag).toHaveBeenCalled();
    expect(p.onAddCollection).toHaveBeenCalled();
    expect(p.onConcurrency).toHaveBeenCalledWith(4);
  });

  it('输入行打开时按类型给占位符，回车应用', () => {
    const p = props({ inputOpen: true, inputValue: '新标签', inputKind: 'collection' });
    render(<LibraryBulkBar {...p} />);
    const input = screen.getByPlaceholderText('合集名称');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onApply).toHaveBeenCalled();
  });

  it('空输入时应用按钮禁用，取消关闭输入行', () => {
    const p = props({ inputOpen: true });
    render(<LibraryBulkBar {...p} />);
    expect((screen.getByText('应用') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('取消', { selector: '.bulk-input-row .mini-btn' }));
    expect(p.onCloseInput).toHaveBeenCalled();
  });
});
