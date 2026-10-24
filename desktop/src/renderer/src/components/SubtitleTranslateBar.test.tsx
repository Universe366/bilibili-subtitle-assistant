// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SubtitleOptimizeProgress, SubtitleTranslateBar } from './SubtitleTranslateBar';

function translateProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    targetLang: '中文（简体）',
    customTarget: '',
    effectiveTarget: '中文（简体）',
    hasLines: true,
    translating: false,
    progress: 0,
    message: '',
    onTargetLang: vi.fn(),
    onCustomTarget: vi.fn(),
    onStart: vi.fn(),
    onStop: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };
}

describe('SubtitleTranslateBar', () => {
  afterEach(cleanup);

  it('关闭时不渲染', () => {
    const { container } = render(<SubtitleTranslateBar {...translateProps({ open: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('选择语言与自定义语言输入', () => {
    const p = translateProps({ targetLang: '__custom' });
    render(<SubtitleTranslateBar {...p} />);
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'English' } });
    expect(p.onTargetLang).toHaveBeenCalledWith('English');
    fireEvent.change(screen.getByPlaceholderText('目标语言'), { target: { value: 'Français' } });
    expect(p.onCustomTarget).toHaveBeenCalledWith('Français');
  });

  it('没有字幕或没有目标语言时禁用开始', () => {
    const { rerender } = render(<SubtitleTranslateBar {...translateProps({ hasLines: false })} />);
    expect((screen.getByText('开始翻译') as HTMLButtonElement).disabled).toBe(true);
    rerender(<SubtitleTranslateBar {...translateProps({ effectiveTarget: '' })} />);
    expect((screen.getByText('开始翻译') as HTMLButtonElement).disabled).toBe(true);
  });

  it('翻译中显示停止与进度', () => {
    const p = translateProps({ translating: true, progress: 42, message: '第 2/5 段' });
    render(<SubtitleTranslateBar {...p} />);
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText('第 2/5 段')).toBeTruthy();
    fireEvent.click(screen.getByText('停止'));
    expect(p.onStop).toHaveBeenCalled();
  });
});

describe('SubtitleOptimizeProgress', () => {
  afterEach(cleanup);

  it('未运行但有消息时只显示结果', () => {
    render(
      <SubtitleOptimizeProgress running={false} progress={0} message="已优化 3 处" onStop={() => {}} />
    );
    expect(screen.getByText('已优化 3 处')).toBeTruthy();
    expect(screen.queryByText('停止')).toBeNull();
  });

  it('运行时显示进度与停止', () => {
    const onStop = vi.fn();
    render(<SubtitleOptimizeProgress running progress={30} message="" onStop={onStop} />);
    expect(screen.getByText('30%')).toBeTruthy();
    fireEvent.click(screen.getByText('停止'));
    expect(onStop).toHaveBeenCalled();
  });

  it('既没运行也没消息时不渲染', () => {
    const { container } = render(
      <SubtitleOptimizeProgress running={false} progress={0} message="" onStop={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });
});
