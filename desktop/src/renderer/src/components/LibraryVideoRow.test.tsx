// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { LibraryVideo } from '../../../shared/types';
import { LibraryVideoRow } from './LibraryVideoRow';

const rowOf = () =>
  screen.getByText('行组件视频').closest('div[role="button"]') as HTMLElement;

const video: LibraryVideo = {
  id: 3,
  bvid: null,
  cid: null,
  title: '行组件视频',
  owner: 'UP',
  duration: 65,
  cover: null,
  url: 'https://example.com/v',
  kind: 'video',
  source: 'bilibili',
  createdAt: 0,
  updatedAt: 0,
  summaryUpdatedAt: null,
  tags: ['标签A'],
  collections: [],
  trackCount: 1,
  lineCount: 12,
  chars: 100
};

function props(overrides: Partial<Parameters<typeof LibraryVideoRow>[0]> = {}) {
  return {
    video,
    selectMode: false,
    selected: false,
    onToggleSelect: vi.fn(),
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    ...overrides
  };
}

describe('LibraryVideoRow', () => {
  afterEach(cleanup);

  it('渲染标题与元信息', () => {
    render(<LibraryVideoRow {...props()} />);
    expect(screen.getByText('行组件视频')).toBeTruthy();
    expect(screen.getByText(/标签A/)).toBeTruthy();
  });

  it('点击整行打开详情', () => {
    const p = props();
    render(<LibraryVideoRow {...p} />);
    fireEvent.click(rowOf());
    expect(p.onOpen).toHaveBeenCalledWith(video);
  });

  it('回车也能打开详情', () => {
    const p = props();
    render(<LibraryVideoRow {...p} />);
    fireEvent.keyDown(rowOf(), { key: 'Enter' });
    expect(p.onOpen).toHaveBeenCalledWith(video);
  });

  it('删除按钮只触发删除，不打开详情', () => {
    const p = props();
    render(<LibraryVideoRow {...p} />);
    fireEvent.click(screen.getByTitle('从库中删除'));
    expect(p.onDelete).toHaveBeenCalledWith(video);
    expect(p.onOpen).not.toHaveBeenCalled();
  });

  it('选择模式下点击切换选中，不打开详情', () => {
    const p = props({ selectMode: true });
    render(<LibraryVideoRow {...p} />);
    fireEvent.click(rowOf());
    expect(p.onToggleSelect).toHaveBeenCalledWith(3, false);
    expect(p.onOpen).not.toHaveBeenCalled();
  });
});
