// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LibraryCollectionRow } from './LibraryCollectionRow';

const allCollections = [
  { id: 1, name: '合集A', count: 2, createdAt: 0 },
  { id: 2, name: '合集B', count: 1, createdAt: 0 }
];

function props(overrides: Record<string, unknown> = {}) {
  return {
    collections: ['合集A'],
    allCollections,
    draft: '',
    onDraft: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    ...overrides
  };
}

describe('LibraryCollectionRow', () => {
  afterEach(cleanup);

  it('已有合集渲染为 chip，下拉里排除已加入的', () => {
    render(<LibraryCollectionRow {...props()} />);
    expect(screen.getByText('合集A')).toBeTruthy();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => option.value);
    expect(options).toContain('合集B');
    expect(options).not.toContain('合集A');
  });

  it('选择合集触发加入', () => {
    const p = props();
    render(<LibraryCollectionRow {...p} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '合集B' } });
    expect(p.onAdd).toHaveBeenCalledWith('合集B');
  });

  it('新建合集回车提交，输入走回调', () => {
    const p = props({ draft: '新合集' });
    render(<LibraryCollectionRow {...p} />);
    fireEvent.change(screen.getByPlaceholderText('新建合集'), { target: { value: '新合集2' } });
    expect(p.onDraft).toHaveBeenCalledWith('新合集2');
    fireEvent.keyDown(screen.getByPlaceholderText('新建合集'), { key: 'Enter' });
    expect(p.onAdd).toHaveBeenCalledWith('新合集');
  });

  it('点 × 移出合集', () => {
    const p = props();
    render(<LibraryCollectionRow {...p} />);
    fireEvent.click(screen.getByTitle('移出合集'));
    expect(p.onRemove).toHaveBeenCalledWith('合集A');
  });
});
