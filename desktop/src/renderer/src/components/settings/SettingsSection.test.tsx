// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ModelChips, SettingsSection } from './SettingsSection';

describe('SettingsSection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('渲染标题与内容', () => {
    render(
      <SettingsSection title="通用" defaultOpen>
        <span>内容区</span>
      </SettingsSection>
    );
    expect(screen.getByText('通用')).toBeTruthy();
    expect(screen.getByText('内容区')).toBeTruthy();
  });

  it('defaultOpen 控制初始展开', () => {
    const { container } = render(
      <SettingsSection title="关闭的" defaultOpen={false}>
        <span>内容区</span>
      </SettingsSection>
    );
    expect((container.querySelector('details') as HTMLDetailsElement).open).toBe(false);
  });

  it('展开状态写入 localStorage，并在重挂载时恢复', () => {
    const { container, unmount } = render(
      <SettingsSection title="记住我" defaultOpen={false}>
        <span>内容区</span>
      </SettingsSection>
    );
    const details = container.querySelector('details') as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(localStorage.getItem('bsub.settings.section.记住我')).toBe('1');
    unmount();

    const again = render(
      <SettingsSection title="记住我" defaultOpen={false}>
        <span>内容区</span>
      </SettingsSection>
    );
    expect((again.container.querySelector('details') as HTMLDetailsElement).open).toBe(true);
  });
});

describe('ModelChips', () => {
  afterEach(cleanup);

  it('模型多时可按关键字筛选并回调', () => {
    const models = Array.from({ length: 20 }, (_, index) => `model-${index}`);
    const onPick = vi.fn();
    render(<ModelChips models={models} current="model-1" probed onPick={onPick} />);
    fireEvent.change(screen.getByPlaceholderText(/筛选模型/), { target: { value: 'model-1' } });
    expect(screen.getByText(/匹配/)).toBeTruthy();
    fireEvent.click(screen.getByTitle('model-1'));
    expect(onPick).toHaveBeenCalledWith('model-1');
  });

  it('没有模型时不渲染；筛选无结果给提示', () => {
    const { container, rerender } = render(
      <ModelChips models={[]} current="" probed={false} onPick={() => {}} />
    );
    expect(container.firstChild).toBeNull();
    rerender(<ModelChips models={['a']} current="" probed={false} onPick={() => {}} />);
    expect(screen.getByText('a')).toBeTruthy();
  });
});
