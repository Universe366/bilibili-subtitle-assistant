// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LibraryEmptyState } from './LibraryEmptyState';

function props(overrides: Record<string, unknown> = {}) {
  return {
    quickLink: '',
    onQuickLink: vi.fn(),
    onQuickImport: vi.fn(),
    onOpenImport: vi.fn(),
    onOpenBilibili: vi.fn(),
    ...overrides
  };
}

describe('LibraryEmptyState', () => {
  afterEach(cleanup);

  it('空输入时「导入并总结」禁用', () => {
    render(<LibraryEmptyState {...props()} />);
    expect((screen.getByText('导入并总结') as HTMLButtonElement).disabled).toBe(true);
  });

  it('输入回调', () => {
    const p = props();
    render(<LibraryEmptyState {...p} />);
    fireEvent.change(screen.getByPlaceholderText(/粘贴视频链接/), {
      target: { value: 'BV1xx411c7mD' }
    });
    expect(p.onQuickLink).toHaveBeenCalledWith('BV1xx411c7mD');
  });

  it('回车与按钮都提交当前链接', () => {
    const p = props({ quickLink: 'BV1xx411c7mD' });
    render(<LibraryEmptyState {...p} />);
    fireEvent.keyDown(screen.getByPlaceholderText(/粘贴视频链接/), { key: 'Enter' });
    expect(p.onQuickImport).toHaveBeenCalledWith('BV1xx411c7mD');
    fireEvent.click(screen.getByText('导入并总结'));
    expect(p.onQuickImport).toHaveBeenCalledTimes(2);
  });

  it('打开 B 站与导入链接回调', () => {
    const p = props();
    render(<LibraryEmptyState {...p} />);
    fireEvent.click(screen.getByText('打开 B 站'));
    fireEvent.click(screen.getByText('导入链接'));
    expect(p.onOpenBilibili).toHaveBeenCalled();
    expect(p.onOpenImport).toHaveBeenCalled();
  });
});
