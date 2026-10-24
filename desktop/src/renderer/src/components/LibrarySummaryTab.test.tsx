// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { StoredSummary, SummaryVersion, SummaryVersionMeta } from '../../../shared/types';
import { LibrarySummaryTab } from './LibrarySummaryTab';

const summary: StoredSummary = { content: '# 总结标题\n正文内容', model: 'deepseek', updatedAt: 0 };
const preview = {
  id: 9,
  content: '旧版本内容',
  model: 'deepseek',
  createdAt: 0
} as SummaryVersion;
const versions: SummaryVersionMeta[] = [
  { id: 9, model: 'deepseek', chars: 5, createdAt: 0 },
  { id: 10, model: 'deepseek', chars: 6, createdAt: 1 }
];

function props(overrides: Record<string, unknown> = {}) {
  return {
    summary,
    hasDetail: true,
    preview: null,
    diff: null,
    versions: [],
    versionsOpen: false,
    busyVersion: 0,
    onCompare: vi.fn(),
    onPreview: vi.fn(),
    onRestore: vi.fn(),
    onExitPreview: vi.fn(),
    onToggleVersions: vi.fn(),
    ...overrides
  };
}

describe('LibrarySummaryTab', () => {
  afterEach(cleanup);

  it('渲染总结正文', () => {
    render(<LibrarySummaryTab {...props()} />);
    expect(screen.getByText('总结标题')).toBeTruthy();
  });

  it('没有总结时显示空状态，详情未加载则什么都不渲染', () => {
    const { container, rerender } = render(<LibrarySummaryTab {...props({ summary: null })} />);
    expect(screen.getByText(/还没有总结/)).toBeTruthy();
    rerender(<LibrarySummaryTab {...props({ summary: null, hasDetail: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('预览时显示版本横幅并支持对比/退出', () => {
    const p = props({ preview });
    render(<LibrarySummaryTab {...p} />);
    expect(screen.getByText(/预览版本/)).toBeTruthy();
    fireEvent.click(screen.getByText('与当前对比'));
    fireEvent.click(screen.getByText('恢复此版本'));
    expect(p.onCompare).toHaveBeenCalled();
    expect(p.onRestore).toHaveBeenCalledWith(9);
  });

  it('展开历史版本后可以预览与恢复', () => {
    const p = props({ versions, versionsOpen: true });
    render(<LibrarySummaryTab {...p} />);
    expect(screen.getByText(/历史版本 2/)).toBeTruthy();
    fireEvent.click(screen.getAllByText('预览')[0]);
    expect(p.onPreview).toHaveBeenCalledWith(versions[0]);
    fireEvent.click(screen.getAllByText('恢复')[0]);
    expect(p.onRestore).toHaveBeenCalledWith(9);
  });

  it('切换历史版本展开状态', () => {
    const p = props({ versions, versionsOpen: false });
    render(<LibrarySummaryTab {...p} />);
    fireEvent.click(screen.getByText(/历史版本 2/));
    expect(p.onToggleVersions).toHaveBeenCalled();
  });
});
