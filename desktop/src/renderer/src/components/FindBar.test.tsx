// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FindResult } from '../../../shared/types';
import { FindBar } from './FindBar';

const result = { activeMatchOrdinal: 2, matches: 5, finalUpdate: true } as FindResult;

function props(overrides: Record<string, unknown> = {}) {
  return {
    query: '关键词',
    result,
    onChange: vi.fn(),
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };
}

describe('FindBar', () => {
  afterEach(cleanup);

  it('展示命中进度', () => {
    render(<FindBar {...props()} />);
    expect(screen.getByDisplayValue('关键词')).toBeTruthy();
    expect(screen.getByText(/2\s*\/\s*5/)).toBeTruthy();
  });

  it('输入、上下一个、关闭都回调', () => {
    const p = props();
    render(<FindBar {...p} />);
    fireEvent.change(screen.getByDisplayValue('关键词'), { target: { value: '新词' } });
    expect(p.onChange).toHaveBeenCalledWith('新词');
    fireEvent.click(screen.getByTitle(/上一个/));
    fireEvent.click(screen.getByTitle(/下一个/));
    fireEvent.click(screen.getByTitle(/关闭/));
    expect(p.onPrev).toHaveBeenCalled();
    expect(p.onNext).toHaveBeenCalled();
    expect(p.onClose).toHaveBeenCalled();
  });

  it('没有结果时不显示计数', () => {
    render(<FindBar {...props({ result: { activeMatchOrdinal: 0, matches: 0, finalUpdate: true } })} />);
    expect(screen.getByText('0/0')).toBeTruthy();
  });

  it('回车与 Shift+回车切换上下一个', () => {
    const p = props();
    render(<FindBar {...p} />);
    const input = screen.getByDisplayValue('关键词');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onNext).toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(p.onPrev).toHaveBeenCalled();
  });
});
