// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { LibraryBundle } from '../../../shared/types';
import { LibrarySubtitlesTab } from './LibrarySubtitlesTab';

const bundle = {
  info: {} as never,
  track: {} as never,
  lines: [
    { start: 0, end: 1, text: '第一句' },
    { start: 65, end: 70, text: '第二句' }
  ]
} as LibraryBundle;

describe('LibrarySubtitlesTab', () => {
  afterEach(cleanup);

  it('渲染字幕行与时间轴', () => {
    render(
      <LibrarySubtitlesTab
        bundle={bundle}
        hasDetail
        lineLimit={400}
        onLoadMore={() => {}}
        onSeek={() => {}}
      />
    );
    expect(screen.getByText('第一句')).toBeTruthy();
    expect(screen.getByText('0:00')).toBeTruthy();
    expect(screen.getByText('1:05')).toBeTruthy();
  });

  it('点击行跳转到对应秒数', () => {
    const onSeek = vi.fn();
    render(
      <LibrarySubtitlesTab bundle={bundle} hasDetail lineLimit={400} onLoadMore={() => {}} onSeek={onSeek} />
    );
    fireEvent.click(screen.getByText('第二句'));
    expect(onSeek).toHaveBeenCalledWith(65);
  });

  it('超出上限时显示加载更多并回调', () => {
    const onLoadMore = vi.fn();
    render(
      <LibrarySubtitlesTab
        bundle={bundle}
        hasDetail
        lineLimit={1}
        onLoadMore={onLoadMore}
        onSeek={() => {}}
      />
    );
    expect(screen.queryByText('第二句')).toBeNull();
    fireEvent.click(screen.getByText(/加载更多/));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('只有总结没有字幕时给出提示', () => {
    render(
      <LibrarySubtitlesTab
        bundle={null}
        hasDetail
        lineLimit={400}
        onLoadMore={() => {}}
        onSeek={() => {}}
      />
    );
    expect(screen.getByText(/这条记录只有总结/)).toBeTruthy();
  });

  it('详情未加载时不渲染', () => {
    const { container } = render(
      <LibrarySubtitlesTab
        bundle={null}
        hasDetail={false}
        lineLimit={400}
        onLoadMore={() => {}}
        onSeek={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
