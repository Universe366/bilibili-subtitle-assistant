// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SubtitleTrack, SubtitleTrackCheck } from '../../../shared/types';
import { SubtitleTrackPicker } from './SubtitleTrackPicker';

const tracks = [
  { url: 'u1', lan: 'zh-CN', lanDoc: '中文（自动生成）', isAi: true, source: 'api' },
  { url: 'u2', lan: 'en-US', lanDoc: 'English', isAi: false, source: 'api' }
] as unknown as SubtitleTrack[];

const checks = [
  { url: 'u2', ok: false, reason: '覆盖不足' }
] as unknown as SubtitleTrackCheck[];

describe('SubtitleTrackPicker', () => {
  afterEach(cleanup);

  it('渲染语言与 AI 标记', () => {
    render(<SubtitleTrackPicker tracks={tracks} activeUrl="u1" checks={[]} onPick={() => {}} />);
    expect(screen.getByText(/中文（自动生成）/)).toBeTruthy();
    expect(screen.getByText('AI')).toBeTruthy();
    expect(screen.getByText('English')).toBeTruthy();
  });

  it('当前轨高亮，点击切换', () => {
    const onPick = vi.fn();
    render(<SubtitleTrackPicker tracks={tracks} activeUrl="u1" checks={[]} onPick={onPick} />);
    const first = screen.getByText(/中文（自动生成）/).closest('button') as HTMLButtonElement;
    expect(first.className).toContain('is-active');
    fireEvent.click(screen.getByText('English'));
    expect(onPick).toHaveBeenCalledWith(tracks[1]);
  });

  it('校验失败的轨禁用并标注不可用', () => {
    const onPick = vi.fn();
    render(<SubtitleTrackPicker tracks={tracks} activeUrl="" checks={checks} onPick={onPick} />);
    const disabled = screen.getByText('English').closest('button') as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);
    expect(disabled.className).toContain('is-invalid');
    expect(screen.getByText('不可用')).toBeTruthy();
    fireEvent.click(disabled);
    expect(onPick).not.toHaveBeenCalled();
  });
});
