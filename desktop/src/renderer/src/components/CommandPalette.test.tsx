// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette, type CommandItem } from './CommandPalette';

const commands: CommandItem[] = [
  { id: 'a', label: '打开面板：字幕', hint: 'Ctrl+Shift+1', run: vi.fn() },
  { id: 'b', label: '打开面板：库', run: vi.fn() },
  { id: 'c', label: '新建标签页', hint: 'Ctrl+T', run: vi.fn() }
];

describe('CommandPalette', () => {
  afterEach(cleanup);

  it('关闭时不渲染', () => {
    const { container } = render(
      <CommandPalette open={false} commands={commands} onClose={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('输入过滤命令', () => {
    render(<CommandPalette open commands={commands} onClose={() => {}} />);
    expect(screen.getByText('打开面板：库')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/输入命令/), { target: { value: '标签' } });
    expect(screen.queryByText('打开面板：库')).toBeNull();
    expect(screen.getByText('新建标签页')).toBeTruthy();
  });

  it('方向键选择后回车执行', () => {
    const run = vi.fn();
    const list: CommandItem[] = [
      { id: 'a', label: '命令 A', run },
      { id: 'b', label: '命令 B', run }
    ];
    const onClose = vi.fn();
    render(<CommandPalette open commands={list} onClose={onClose} />);
    const input = screen.getByPlaceholderText(/输入命令/);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('没有匹配时提示，Esc 关闭', () => {
    const onClose = vi.fn();
    render(<CommandPalette open commands={commands} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText(/输入命令/), { target: { value: 'zzz' } });
    expect(screen.getByText('没有匹配的命令')).toBeTruthy();
    fireEvent.keyDown(screen.getByPlaceholderText(/输入命令/), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('点击命令执行', () => {
    const run = vi.fn();
    render(
      <CommandPalette open commands={[{ id: 'x', label: '点我', run }]} onClose={() => {}} />
    );
    fireEvent.click(screen.getByText('点我'));
    expect(run).toHaveBeenCalled();
  });
});
