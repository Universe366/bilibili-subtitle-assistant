// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SubtitleLine } from '../../../shared/types';
import { SubtitleLineRow } from './SubtitleLineRow';

const line: SubtitleLine = { start: 65, end: 70, text: '这是第一句字幕' };

function props(overrides: Record<string, unknown> = {}) {
  return {
    line,
    index: 0,
    active: false,
    editing: false,
    editingText: '',
    viewMode: 'original' as const,
    translatedText: '',
    query: '',
    onJump: vi.fn(),
    onEditStart: vi.fn(),
    onEditText: vi.fn(),
    onEditCommit: vi.fn(),
    onEditCancel: vi.fn(),
    onCopy: vi.fn(),
    ...overrides
  };
}

describe('SubtitleLineRow', () => {
  afterEach(cleanup);

  it('展示时间轴与原文，点击行跳转', () => {
    const p = props();
    render(<SubtitleLineRow {...p} />);
    expect(screen.getByText('1:05')).toBeTruthy();
    expect(screen.getByText('这是第一句字幕')).toBeTruthy();
    fireEvent.click(screen.getByText('这是第一句字幕'));
    expect(p.onJump).toHaveBeenCalledWith(line);
  });

  it('高亮搜索词', () => {
    const { container } = render(<SubtitleLineRow {...props({ query: '第一句' })} />);
    expect(container.querySelector('mark')?.textContent).toBe('第一句');
  });

  it('双语模式同时显示原文与译文', () => {
    render(
      <SubtitleLineRow
        {...props({ viewMode: 'bilingual', translatedText: 'This is the first line' })}
      />
    );
    expect(screen.getByText('这是第一句字幕')).toBeTruthy();
    expect(screen.getByText('This is the first line')).toBeTruthy();
  });

  it('译文模式只显示译文', () => {
    const { container } = render(
      <SubtitleLineRow {...props({ viewMode: 'translated', translatedText: '译文句子' })} />
    );
    expect(screen.getByText('译文句子')).toBeTruthy();
    expect(container.textContent).not.toContain('这是第一句字幕');
  });

  it('编辑态回车提交、Esc 取消', () => {
    const p = props({ editing: true, editingText: '改过的字幕' });
    render(<SubtitleLineRow {...p} />);
    const input = screen.getByDisplayValue('改过的字幕');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onEditCommit).toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(p.onEditCancel).toHaveBeenCalled();
  });

  it('编辑按钮与复制按钮分别回调', () => {
    const p = props();
    render(<SubtitleLineRow {...p} />);
    fireEvent.click(screen.getByTitle('编辑此行'));
    expect(p.onEditStart).toHaveBeenCalledWith(0, '这是第一句字幕');
    fireEvent.click(screen.getByTitle('复制此行'));
    expect(p.onCopy).toHaveBeenCalledWith('这是第一句字幕');
  });
});
