// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { LibraryDetail, LibraryVideo } from '../../../shared/types';
import { LibraryDetailHeader } from './LibraryDetailHeader';

const video: LibraryVideo = {
  id: 5,
  bvid: null,
  cid: null,
  title: '详情标题',
  owner: 'UP',
  duration: 30,
  cover: null,
  url: 'https://example.com/v',
  kind: 'video',
  source: 'bilibili',
  createdAt: 0,
  updatedAt: 0,
  summaryUpdatedAt: null,
  tags: ['旧标签'],
  collections: [],
  trackCount: 0,
  lineCount: 0,
  chars: 0
};

const detail = { video, bundle: null, summary: null, note: null } satisfies LibraryDetail;

function props(overrides: Record<string, unknown> = {}) {
  return {
    video,
    detail,
    tags: [{ name: '旧标签', count: 1 }],
    tagDraft: '',
    onTagDraft: vi.fn(),
    onAddTag: vi.fn(),
    onRemoveTag: vi.fn(),
    onBack: vi.fn(),
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    ...overrides
  };
}

describe('LibraryDetailHeader', () => {
  afterEach(cleanup);

  it('渲染标题、元信息与已有标签', () => {
    render(<LibraryDetailHeader {...props()} />);
    expect(screen.getByText('详情标题')).toBeTruthy();
    expect(screen.getByText('旧标签')).toBeTruthy();
  });

  it('返回 / 打开 / 删除分别回调', () => {
    const p = props();
    render(<LibraryDetailHeader {...p} />);
    fireEvent.click(screen.getByTitle('返回库'));
    fireEvent.click(screen.getByTitle('在网页打开'));
    fireEvent.click(screen.getByTitle('从库中删除'));
    expect(p.onBack).toHaveBeenCalled();
    expect(p.onOpen).toHaveBeenCalledWith(video);
    expect(p.onDelete).toHaveBeenCalledWith(video);
  });

  it('回车提交标签，点 × 移除标签', () => {
    const p = props({ tagDraft: '新标签' });
    render(<LibraryDetailHeader {...p} />);
    fireEvent.keyDown(screen.getByPlaceholderText('添加标签'), { key: 'Enter' });
    expect(p.onAddTag).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('移除标签'));
    expect(p.onRemoveTag).toHaveBeenCalledWith('旧标签');
  });

  it('没有 url 时禁用打开按钮', () => {
    render(<LibraryDetailHeader {...props({ video: { ...video, url: '' } })} />);
    expect((screen.getByTitle('在网页打开') as HTMLButtonElement).disabled).toBe(true);
  });
});
