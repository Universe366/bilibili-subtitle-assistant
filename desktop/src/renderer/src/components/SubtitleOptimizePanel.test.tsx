// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { OptimizeSuggestion, QualityReport } from '../../../shared/types';
import { SubtitleOptimizePanel, SubtitleQualityCard } from './SubtitleOptimizePanel';

const quality = {
  stats: { lines: 120, coverage: 0.87, charsPerSecond: 3.4 },
  issues: [
    { code: 'short-line', severity: 'warn', message: '第 3 行过短', lineIndex: 2 },
    { code: 'gap', severity: 'info', message: '第 5 行与第 4 行间隔过大', start: 12.5 }
  ]
} as unknown as QualityReport;

const suggestions = [
  {
    index: 0,
    original: '原句一',
    suggestion: '改句一',
    verdict: 'support',
    sources: 2,
    consistency: 'multi',
    evidence: '证据一'
  },
  {
    index: 1,
    original: '原句二',
    suggestion: '改句二'
  }
] as unknown as OptimizeSuggestion[];

describe('SubtitleQualityCard', () => {
  afterEach(cleanup);

  it('展示统计与问题，点击问题回调', () => {
    const onJumpIssue = vi.fn();
    render(<SubtitleQualityCard quality={quality} onClose={() => {}} onJumpIssue={onJumpIssue} />);
    expect(screen.getByText(/120 行 · 覆盖 87%/)).toBeTruthy();
    expect(screen.getByText(/3\.4 字\/秒/)).toBeTruthy();
    fireEvent.click(screen.getByText('第 3 行过短'));
    expect(onJumpIssue).toHaveBeenCalledWith(quality.issues[0]);
  });

  it('没有问题时显示提示，关闭可点', () => {
    const onClose = vi.fn();
    render(
      <SubtitleQualityCard
        quality={{ ...quality, issues: [] }}
        onClose={onClose}
        onJumpIssue={() => {}}
      />
    );
    expect(screen.getByText('未发现明显问题')).toBeTruthy();
    fireEvent.click(screen.getByText('关闭'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('SubtitleOptimizePanel', () => {
  afterEach(cleanup);

  it('展示建议、证据与勾选状态', () => {
    const onToggle = vi.fn();
    render(
      <SubtitleOptimizePanel
        suggestions={suggestions}
        selected={new Set([1])}
        onToggle={onToggle}
        onApplyAll={() => {}}
        onApplySelected={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('AI 优化建议 · 2 处')).toBeTruthy();
    expect(screen.getByText(/证据支持/)).toBeTruthy();
    expect(screen.getByText(/证据：证据一/)).toBeTruthy();
    const boxes = document.querySelectorAll('input[type="checkbox"]');
    expect((boxes[1] as HTMLInputElement).checked).toBe(true);
    fireEvent.click(boxes[0]);
    expect(onToggle).toHaveBeenCalledWith(0);
  });

  it('选中为空时禁用「应用选中」', () => {
    render(
      <SubtitleOptimizePanel
        suggestions={suggestions}
        selected={new Set()}
        onToggle={() => {}}
        onApplyAll={() => {}}
        onApplySelected={() => {}}
        onClose={() => {}}
      />
    );
    expect((screen.getByText(/应用选中（0）/).closest('button') as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('全部应用与关闭回调', () => {
    const onApplyAll = vi.fn();
    const onClose = vi.fn();
    render(
      <SubtitleOptimizePanel
        suggestions={suggestions}
        selected={new Set()}
        onToggle={() => {}}
        onApplyAll={onApplyAll}
        onApplySelected={() => {}}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByText('全部应用'));
    fireEvent.click(screen.getByText('关闭'));
    expect(onApplyAll).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
