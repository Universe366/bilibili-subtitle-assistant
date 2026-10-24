// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { NoteVersionMeta } from '../../../shared/types';
import { LibraryNoteTab } from './LibraryNoteTab';

const versions: NoteVersionMeta[] = [
  { id: 1, chars: 10, createdAt: 0 },
  { id: 2, chars: 20, createdAt: 1000 }
];

function props(overrides: Record<string, unknown> = {}) {
  return {
    draft: '笔记内容',
    dirty: false,
    saving: false,
    preview: false,
    notice: '',
    autoSaving: false,
    versions: [],
    versionsOpen: false,
    savedAt: 1600000000000,
    onChange: vi.fn(),
    onTogglePreview: vi.fn(),
    onExport: vi.fn(),
    onSave: vi.fn(),
    onLoadVersion: vi.fn(),
    onToggleVersions: vi.fn(),
    ...overrides
  };
}

describe('LibraryNoteTab', () => {
  afterEach(cleanup);

  it('编辑态渲染 textarea 与字数', () => {
    render(<LibraryNoteTab {...props()} />);
    expect((screen.getByPlaceholderText(/写点笔记/) as HTMLTextAreaElement).value).toBe('笔记内容');
    expect(screen.getByText(/4 字/)).toBeTruthy();
  });

  it('输入回调与 Ctrl+S 保存', () => {
    const p = props();
    render(<LibraryNoteTab {...p} />);
    fireEvent.change(screen.getByPlaceholderText(/写点笔记/), { target: { value: '新内容' } });
    expect(p.onChange).toHaveBeenCalledWith('新内容');
    fireEvent.keyDown(screen.getByPlaceholderText(/写点笔记/), { key: 's', ctrlKey: true });
    expect(p.onSave).toHaveBeenCalled();
  });

  it('预览态渲染 Markdown，并显示未保存提示', () => {
    render(<LibraryNoteTab {...props({ preview: true, dirty: true })} />);
    expect(screen.queryByPlaceholderText(/写点笔记/)).toBeNull();
    expect(screen.getByText('笔记内容')).toBeTruthy();
    expect(screen.getByText(/未保存/)).toBeTruthy();
  });

  it('保存按钮在未修改或保存中时禁用', () => {
    const { rerender } = render(<LibraryNoteTab {...props()} />);
    expect((screen.getByText('保存') as HTMLButtonElement).disabled).toBe(true);
    rerender(<LibraryNoteTab {...props({ dirty: true, saving: true })} />);
    expect((screen.getByText('保存中…') as HTMLButtonElement).disabled).toBe(true);
  });

  it('历史版本展开后可以载入', () => {
    const p = props({ versions, versionsOpen: true });
    render(<LibraryNoteTab {...p} />);
    fireEvent.click(screen.getAllByText('载入')[0]);
    expect(p.onLoadVersion).toHaveBeenCalledWith(versions[0]);
  });
});
