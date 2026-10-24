// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppSettings } from '../../../../shared/types';
import { CorrectionSection } from './CorrectionSection';

const value = {
  enabled: true,
  groups: [
    {
      id: 'g1',
      name: '默认规则组',
      enabled: true,
      rules: [
        { id: 'r1', pattern: 'AI', replacement: '人工智能', regex: false, caseSensitive: true }
      ]
    }
  ],
  glossary: { enabled: true, terms: [{ id: 't1', from: 'GPU', to: '显卡', note: '' }] }
} as AppSettings['correction'];

function props(overrides: Record<string, unknown> = {}) {
  return {
    value,
    testText: '这是一段测试字幕',
    preview: '',
    testing: false,
    onToggle: vi.fn(),
    onAddGroup: vi.fn(),
    onImportGroups: vi.fn(),
    onUpdateGroup: vi.fn(),
    onExportGroup: vi.fn(),
    onRemoveGroup: vi.fn(),
    onAddRule: vi.fn(),
    onUpdateRule: vi.fn(),
    onRemoveRule: vi.fn(),
    onToggleGlossary: vi.fn(),
    onAddTerm: vi.fn(),
    onUpdateTerm: vi.fn(),
    onRemoveTerm: vi.fn(),
    onTestText: vi.fn(),
    onPreview: vi.fn(),
    ...overrides
  };
}

const button = (text: string) =>
  screen.getAllByRole('button').find((item) => item.textContent?.includes(text)) as HTMLButtonElement;

describe('CorrectionSection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('渲染规则组、规则与术语', () => {
    render(<CorrectionSection {...props()} />);
    expect(screen.getByDisplayValue('默认规则组')).toBeTruthy();
    expect(screen.getByDisplayValue('AI')).toBeTruthy();
    expect(screen.getByDisplayValue('GPU')).toBeTruthy();
  });

  it('编辑规则与原词都带 id', () => {
    const p = props();
    render(<CorrectionSection {...p} />);
    fireEvent.change(screen.getByDisplayValue('AI'), { target: { value: 'A.I.' } });
    expect(p.onUpdateRule).toHaveBeenCalledWith('g1', 'r1', { pattern: 'A.I.' });
    fireEvent.change(screen.getByDisplayValue('GPU'), { target: { value: 'GPU2' } });
    expect(p.onUpdateTerm).toHaveBeenCalledWith('t1', { from: 'GPU2' });
  });

  it('总开关、术语开关与新增按钮', () => {
    const p = props();
    render(<CorrectionSection {...p} />);
    fireEvent.click(screen.getByLabelText(/读取字幕 \/ 入库时应用规则/));
    expect(p.onToggle).toHaveBeenCalledWith(false);
    fireEvent.click(button('规则组'));
    expect(p.onAddGroup).toHaveBeenCalled();
    fireEvent.click(button('术语'));
    expect(p.onAddTerm).toHaveBeenCalled();
  });

  it('预览：预览中禁用，结果展示', () => {
    const p = props({ preview: '预览结果', testing: true });
    render(<CorrectionSection {...p} />);
    expect(screen.getAllByText('预览结果').length).toBeGreaterThan(0);
    expect(button('预览结果').disabled).toBe(true);
  });
});
