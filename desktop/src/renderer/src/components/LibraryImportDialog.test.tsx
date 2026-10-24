// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CollectionResolveResult } from '../../../shared/types';
import { LibraryImportDialog } from './LibraryImportDialog';

const resolved = {
  kind: 'season',
  title: '测试合集',
  total: 7,
  items: [{ url: 'u', title: 'P1', bvid: 'BV1', cid: 1, page: null }]
} as unknown as CollectionResolveResult;

function props(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    text: '',
    summary: true,
    resolving: false,
    resolved: null,
    notice: '',
    onText: vi.fn(),
    onSummary: vi.fn(),
    onResolve: vi.fn(),
    onImportResolved: vi.fn(),
    onStart: vi.fn(),
    onClose: vi.fn(),
    onPodcast: vi.fn(),
    onLocalMedia: vi.fn(),
    ...overrides
  };
}

describe('LibraryImportDialog', () => {
  afterEach(cleanup);

  it('关闭时不渲染', () => {
    const { container } = render(<LibraryImportDialog {...props({ open: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('输入为空时识别与开始都禁用', () => {
    render(<LibraryImportDialog {...props()} />);
    expect((screen.getByText('识别合集 / 多 P') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('开始') as HTMLButtonElement).disabled).toBe(true);
  });

  it('输入文本与勾选总结走回调', () => {
    const p = props();
    render(<LibraryImportDialog {...p} />);
    fireEvent.change(screen.getByPlaceholderText(/BV1xx411c7mD/), {
      target: { value: 'BV1xx411c7mD' }
    });
    expect(p.onText).toHaveBeenCalledWith('BV1xx411c7mD');
    fireEvent.click(screen.getByLabelText(/入库后同时生成总结/));
    expect(p.onSummary).toHaveBeenCalledWith(false);
  });

  it('识别结果展示并可一键导入全部', () => {
    const p = props({ text: 'BV1', resolved });
    render(<LibraryImportDialog {...p} />);
    expect(screen.getByText(/测试合集/)).toBeTruthy();
    expect(screen.getByText(/UP 主合集/)).toBeTruthy();
    fireEvent.click(screen.getByText(/导入全部 7 个/));
    expect(p.onImportResolved).toHaveBeenCalled();
  });

  it('播客、本地音视频、取消与开始回调', () => {
    const p = props({ text: 'BV1' });
    render(<LibraryImportDialog {...p} />);
    fireEvent.click(screen.getByText('播客 / RSS'));
    fireEvent.click(screen.getByText('选择本地音视频'));
    fireEvent.click(screen.getByText('取消'));
    fireEvent.click(screen.getByText('开始'));
    expect(p.onPodcast).toHaveBeenCalled();
    expect(p.onLocalMedia).toHaveBeenCalled();
    expect(p.onClose).toHaveBeenCalled();
    expect(p.onStart).toHaveBeenCalled();
  });
});
