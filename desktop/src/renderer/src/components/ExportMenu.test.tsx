// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PageInfo, SubtitleLine, SubtitleTrack } from '../../../shared/types';
import { ExportMenu } from './ExportMenu';

const info = {
  kind: 'video',
  bvid: 'BV1xx411c7mD',
  cid: 2,
  title: '测试视频',
  duration: 60,
  url: 'https://www.bilibili.com/video/BV1xx411c7mD',
  signature: 'sig'
} as unknown as PageInfo;

const track = { id: 't1', lang: 'zh-CN', label: '中文', isAi: false } as unknown as SubtitleTrack;
const lines: SubtitleLine[] = [{ start: 0, end: 2, text: '第一句' }];

function installBsub() {
  const api = {
    getSettings: vi.fn(async () => ({
      ok: true as const,
      data: { settings: { export: { format: 'srt' } }, version: '0.37.2' }
    })),
    exportVideo: vi.fn(async () => ({ ok: true as const, data: { path: 'C:/tmp/out.srt' } })),
    revealPath: vi.fn(async () => ({ ok: true as const, data: null }))
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

describe('ExportMenu', () => {
  beforeEach(() => installBsub());
  afterEach(cleanup);

  it('默认格式来自设置，打开后菜单首项是它', async () => {
    render(<ExportMenu info={info} track={track} lines={lines} summary="总结正文" />);
    fireEvent.click(screen.getByText(/导出/));
    expect(await screen.findByText(/字幕 \(\.srt\)/)).toBeTruthy();
  });

  it('导出字幕调用 exportSubtitles 并显示路径', async () => {
    const api = installBsub();
    render(<ExportMenu info={info} track={track} lines={lines} />);
    fireEvent.click(screen.getByText(/导出/));
    fireEvent.click(await screen.findByText(/字幕 \(\.srt\)/));
    await waitFor(() => expect(api.exportVideo).toHaveBeenCalled());
    expect(await screen.findByText(/out\.srt|已导出/)).toBeTruthy();
  });

  it('没有 info 时导出按钮禁用', () => {
    render(<ExportMenu info={null} track={null} lines={[]} />);
    expect((screen.getByText(/导出/) as HTMLButtonElement).disabled).toBe(true);
  });
});
