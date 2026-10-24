// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type {
  CollectionSummary,
  CollectionSummaryVersion,
  CollectionSummaryVersionMeta,
  LibraryCollection
} from '../../../shared/types';
import { LibraryCollectionSummaryDialog } from './LibraryCollectionSummaryDialog';

const collection = { id: 1, name: '合集A', count: 3 } as unknown as LibraryCollection;
const summary = {
  id: 1,
  collectionId: 1,
  content: '对比正文',
  model: 'deepseek',
  itemCount: 3,
  updatedAt: 0
} as CollectionSummary;
const preview = { ...summary, id: 2, content: '旧版本', createdAt: 0, chars: 3 } as unknown as CollectionSummaryVersion;
const versions = [
  { id: 2, model: 'deepseek', chars: 3, createdAt: 0 }
] as CollectionSummaryVersionMeta[];

function props(overrides: Record<string, unknown> = {}) {
  return {
    collection,
    summary,
    loading: false,
    error: '',
    preview: null,
    versions: [],
    versionsOpen: false,
    onClose: vi.fn(),
    onExitPreview: vi.fn(),
    onRestoreVersion: vi.fn(),
    onPreviewVersion: vi.fn(),
    onToggleVersions: vi.fn(),
    onGenerate: vi.fn(),
    onExport: vi.fn(),
    ...overrides
  };
}

describe('LibraryCollectionSummaryDialog', () => {
  afterEach(cleanup);

  it('未选择合集时不渲染', () => {
    const { container } = render(
      <LibraryCollectionSummaryDialog {...props({ collection: null })} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('渲染标题与对比正文', () => {
    render(<LibraryCollectionSummaryDialog {...props()} />);
    expect(screen.getByText(/合集对比 · 合集A/)).toBeTruthy();
    expect(screen.getByText('对比正文')).toBeTruthy();
    expect(screen.getByText(/3 个视频/)).toBeTruthy();
  });

  it('预览态显示横幅并可恢复/退出', () => {
    const p = props({ preview });
    render(<LibraryCollectionSummaryDialog {...p} />);
    expect(screen.getByText(/预览版本/)).toBeTruthy();
    fireEvent.click(screen.getByText('恢复此版本'));
    fireEvent.click(screen.getByText('退出预览'));
    expect(p.onRestoreVersion).toHaveBeenCalledWith(2);
    expect(p.onExitPreview).toHaveBeenCalled();
  });

  it('历史版本展开后预览与恢复', () => {
    const p = props({ versions, versionsOpen: true });
    render(<LibraryCollectionSummaryDialog {...p} />);
    fireEvent.click(screen.getByText('预览'));
    expect(p.onPreviewVersion).toHaveBeenCalledWith(versions[0]);
    fireEvent.click(screen.getByText('恢复'));
    expect(p.onRestoreVersion).toHaveBeenCalledWith(2);
  });

  it('生成中禁用主按钮，没有总结时导出禁用', () => {
    render(<LibraryCollectionSummaryDialog {...props({ loading: true })} />);
    expect((screen.getByText('生成中…') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(<LibraryCollectionSummaryDialog {...props({ summary: null })} />);
    expect((screen.getByText('导出') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('还没有对比总结')).toBeTruthy();
  });
});
