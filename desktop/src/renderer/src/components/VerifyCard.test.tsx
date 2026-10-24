// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { VerificationSummary } from '../../../shared/types';
import { VerifyCard } from './VerifyCard';

const ref = (overrides: Record<string, unknown> = {}) => ({
  title: '证据标题',
  url: 'https://example.com/a',
  snippet: '摘要',
  ...overrides
});

function summary(overrides: Partial<VerificationSummary> = {}): VerificationSummary {
  return {
    items: [
      {
        label: '3nm',
        query: '3nm 工艺',
        line: '台积电 3nm 量产',
        references: [ref({ verdict: 'support' }), ref({ title: '另一条', url: 'https://example.com/b' })]
      }
    ],
    references: [ref(), ref()],
    supplements: [],
    attempted: 1,
    failed: 0,
    judged: true,
    dropped: 1,
    ...overrides
  } as VerificationSummary;
}

describe('VerifyCard', () => {
  afterEach(cleanup);

  it('判定完成时展示支持/未判定徽标与统计', () => {
    render(<VerifyCard verification={summary()} />);
    expect(screen.getByText('支持')).toBeTruthy();
    expect(screen.getAllByText('未判定').length).toBeGreaterThan(0);
    expect(screen.getByText(/丢弃 1/)).toBeTruthy();
    expect(screen.getByText(/字幕：台积电 3nm 量产/)).toBeTruthy();
  });

  it('未判定时仍然逐条展示，并给出「只按词面粗标」提示', () => {
    const data = summary({ judged: false, dropped: 0 });
    render(<VerifyCard verification={data} />);
    expect(screen.getByText('证据标题')).toBeTruthy();
    expect(screen.getByText('另一条')).toBeTruthy();
    expect(screen.getByText(/本次未完成语义判定/)).toBeTruthy();
    expect(screen.getAllByText(/未判定/).length).toBeGreaterThan(1);
  });

  it('没有任何证据时给出空状态，但保留补充', () => {
    render(
      <VerifyCard
        verification={summary({
          items: [],
          references: [],
          supplements: ['外部补充一句'],
          attempted: 2,
          judged: false
        })}
      />
    );
    expect(screen.getByText(/本次没有取得可用证据/)).toBeTruthy();
    expect(screen.getByText(/外部补充一句/)).toBeTruthy();
  });

  it('点击证据用外部浏览器打开', () => {
    const openExternal = vi.fn(async () => undefined);
    Object.defineProperty(window, 'bsub', { configurable: true, value: { openExternal } });
    render(<VerifyCard verification={summary()} />);
    fireEvent.click(screen.getByText('证据标题').closest('button') as HTMLButtonElement);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/a');
  });

  it('核对失败时展示错误', () => {
    render(<VerifyCard verification={summary({ error: '检索超时' })} />);
    expect(screen.getByText(/核对失败：检索超时/)).toBeTruthy();
  });
});
