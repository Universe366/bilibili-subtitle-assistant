// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppSettings, SkillItem } from '../../../../shared/types';
import { SkillsSection } from './SkillsSection';

const skill = {
  id: 'skill-1',
  name: '大纲',
  description: '生成大纲',
  body: '正文',
  icon: '✨',
  enabled: true,
  source: 'manual'
} as SkillItem;

function props(overrides: Record<string, unknown> = {}) {
  return {
    value: { enabled: true, items: [skill] } as AppSettings['skills'],
    onToggle: vi.fn(),
    onImport: vi.fn(),
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onRemove: vi.fn(),
    ...overrides
  };
}

describe('SkillsSection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('渲染技能卡片与来源', () => {
    render(<SkillsSection {...props()} />);
    expect(screen.getByDisplayValue('大纲')).toBeTruthy();
    expect(screen.getByDisplayValue('正文')).toBeTruthy();
    expect(screen.getByText('来源：manual')).toBeTruthy();
  });

  it('总开关与单个技能开关回调', () => {
    const p = props();
    render(<SkillsSection {...p} />);
    fireEvent.click(screen.getByLabelText('启用技能提示词'));
    expect(p.onToggle).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByLabelText('启用'));
    expect(p.onUpdate).toHaveBeenCalledWith('skill-1', { enabled: false });
  });

  it('编辑名称/描述/正文都带技能 id', () => {
    const p = props();
    render(<SkillsSection {...p} />);
    fireEvent.change(screen.getByDisplayValue('大纲'), { target: { value: '新名字' } });
    expect(p.onUpdate).toHaveBeenCalledWith('skill-1', { name: '新名字' });
    fireEvent.change(screen.getByPlaceholderText('触发条件 / 描述'), {
      target: { value: '新描述' }
    });
    expect(p.onUpdate).toHaveBeenCalledWith('skill-1', { description: '新描述' });
  });

  it('导入 / 新建 / 删除回调', () => {
    const p = props();
    const { container } = render(<SkillsSection {...p} />);
    fireEvent.click(screen.getByText(/导入 SKILL.md/));
    fireEvent.click(screen.getByText(/新建技能/));
    fireEvent.click(container.querySelector('.skill-card .mini-btn') as HTMLButtonElement);
    expect(p.onImport).toHaveBeenCalled();
    expect(p.onCreate).toHaveBeenCalled();
    expect(p.onRemove).toHaveBeenCalledWith('skill-1');
  });
});
