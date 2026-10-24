// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { LibraryCollection, LibraryTag } from '../../../shared/types';
import { LibraryManageDialog } from './LibraryManageDialog';

const tags = [{ name: '标签A', count: 2 }] as LibraryTag[];
const collections = [
  { id: 1, name: '合集A', count: 3 },
  { id: 2, name: '空合集', count: 0 }
] as unknown as LibraryCollection[];

function props(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    tags,
    collections,
    tagRenameName: '',
    tagRenameDraft: '',
    collectionRenameId: 0,
    collectionRenameDraft: '',
    onTagRenameStart: vi.fn(),
    onTagRenameDraft: vi.fn(),
    onTagRenameSave: vi.fn(),
    onTagRenameCancel: vi.fn(),
    onTagDelete: vi.fn(),
    onCollectionRenameStart: vi.fn(),
    onCollectionRenameDraft: vi.fn(),
    onCollectionRenameSave: vi.fn(),
    onCollectionRenameCancel: vi.fn(),
    onCollectionDelete: vi.fn(),
    onCollectionCompare: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };
}

describe('LibraryManageDialog', () => {
  afterEach(cleanup);

  it('关闭时不渲染', () => {
    const { container } = render(<LibraryManageDialog {...props({ open: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('列出标签与合集，空合集禁用对比', () => {
    render(<LibraryManageDialog {...props()} />);
    expect(screen.getByText(/标签A/)).toBeTruthy();
    expect(screen.getByText(/合集A/)).toBeTruthy();
    const compareButtons = screen.getAllByText('对比');
    expect((compareButtons[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('重命名进入编辑态并可保存', () => {
    const p = props({ tagRenameName: '标签A', tagRenameDraft: '标签A' });
    render(<LibraryManageDialog {...p} />);
    const input = screen.getByDisplayValue('标签A') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '新标签' } });
    expect(p.onTagRenameDraft).toHaveBeenCalledWith('新标签');
    fireEvent.click(screen.getByText('保存'));
    expect(p.onTagRenameSave).toHaveBeenCalledWith(tags[0]);
  });

  it('删除标签与合集、进入重命名都回调', () => {
    const p = props();
    render(<LibraryManageDialog {...p} />);
    fireEvent.click(screen.getAllByText('重命名')[0]);
    expect(p.onTagRenameStart).toHaveBeenCalledWith('标签A');
    fireEvent.click(screen.getAllByText('删除')[0]);
    expect(p.onTagDelete).toHaveBeenCalledWith(tags[0]);
    fireEvent.click(screen.getAllByText('删除')[1]);
    expect(p.onCollectionDelete).toHaveBeenCalledWith(collections[0]);
  });

  it('空列表提示与关闭', () => {
    const p = props({ tags: [], collections: [] });
    render(<LibraryManageDialog {...p} />);
    expect(screen.getByText('还没有标签或合集')).toBeTruthy();
    fireEvent.click(screen.getByText('关闭'));
    expect(p.onClose).toHaveBeenCalled();
  });
});
