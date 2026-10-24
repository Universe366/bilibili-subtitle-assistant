// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppSettings } from '../../../../shared/types';
import { ExportDefaultsSection } from './ExportDefaultsSection';

const value = {
  format: 'md',
  includeTimestamps: true,
  template: 'timestamped',
  assFontSize: 28,
  estimateTimestamps: true,
  filenamePattern: '{title}-{bvid}'
} as unknown as AppSettings['export'];

function props(overrides: Record<string, unknown> = {}) {
  return { value, onChange: vi.fn(), ...overrides };
}

describe('ExportDefaultsSection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('展示当前默认值', () => {
    render(<ExportDefaultsSection {...props()} />);
    expect((screen.getByDisplayValue('Markdown') as HTMLSelectElement).value).toBe('md');
    expect((screen.getByDisplayValue('{title}-{bvid}') as HTMLInputElement).value).toBe(
      '{title}-{bvid}'
    );
  });

  it('切换格式与模板会带出完整对象', () => {
    const p = props();
    render(<ExportDefaultsSection {...p} />);
    fireEvent.change(screen.getByDisplayValue('Markdown'), { target: { value: 'srt' } });
    expect(p.onChange).toHaveBeenCalledWith({ ...value, format: 'srt' });
    fireEvent.change(screen.getByDisplayValue('带时间戳'), { target: { value: 'notes' } });
    expect(p.onChange).toHaveBeenCalledWith({ ...value, template: 'notes' });
  });

  it('复选框与文件名模板', () => {
    const p = props();
    render(<ExportDefaultsSection {...p} />);
    fireEvent.click(screen.getByLabelText(/Markdown \/ TXT 保留时间戳/));
    expect(p.onChange).toHaveBeenCalledWith({ ...value, includeTimestamps: false });
    fireEvent.change(screen.getByPlaceholderText('{title}-{bvid}'), {
      target: { value: '{title}' }
    });
    expect(p.onChange).toHaveBeenCalledWith({ ...value, filenamePattern: '{title}' });
  });

  it('字号输入为空时回退 28', () => {
    const p = props();
    render(<ExportDefaultsSection {...p} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
    expect(p.onChange).toHaveBeenCalledWith({ ...value, assFontSize: 28 });
  });
});
