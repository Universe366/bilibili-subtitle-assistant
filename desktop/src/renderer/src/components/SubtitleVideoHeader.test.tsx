// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PageInfo } from '../../../shared/types';
import { SubtitleVideoHeader } from './SubtitleVideoHeader';

const info = {
  kind: 'video',
  bvid: 'BV1xx411c7mD',
  cid: 2,
  page: 3,
  title: '测试视频标题',
  owner: '测试UP',
  duration: 125,
  cover: '',
  stat: { view: 23456 }
} as unknown as PageInfo;

describe('SubtitleVideoHeader', () => {
  afterEach(cleanup);

  it('展示标题、UP、时长、分 P 与播放量', () => {
    render(<SubtitleVideoHeader info={info} error={null} onRetry={() => {}} />);
    expect(screen.getByText('测试视频标题')).toBeTruthy();
    expect(screen.getByText(/测试UP/)).toBeTruthy();
    expect(screen.getByText(/2:05/)).toBeTruthy();
    expect(screen.getByText('P3')).toBeTruthy();
    expect(screen.getByText('2.3万')).toBeTruthy();
  });

  it('没有封面时用标题首字兜底', () => {
    render(<SubtitleVideoHeader info={info} error={null} onRetry={() => {}} />);
    expect(screen.getByText('测')).toBeTruthy();
  });

  it('错误时显示读取失败并可重试', () => {
    const onRetry = vi.fn();
    render(<SubtitleVideoHeader info={null} error="接口 412" onRetry={onRetry} />);
    expect(screen.getByText('读取失败')).toBeTruthy();
    expect(screen.getByText('接口 412')).toBeTruthy();
    fireEvent.click(screen.getByText('重试'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('既无信息也无错误时不渲染内容', () => {
    const { container } = render(
      <SubtitleVideoHeader info={null} error={null} onRetry={() => {}} />
    );
    expect(container.textContent).toBe('');
  });
});
