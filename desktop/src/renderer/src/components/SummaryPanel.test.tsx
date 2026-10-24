// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { PageInfo, TabInfo, VerificationSummary } from '../../../shared/types';
import { SummaryPanel } from './SummaryPanel';

const info = {
  kind: 'video',
  bvid: 'BV1xx411c7mD',
  aid: 1,
  cid: 2,
  epId: null,
  seasonId: null,
  page: 1,
  partTitle: '',
  parts: [],
  title: '测试视频',
  owner: 'UP',
  desc: '',
  duration: 60,
  url: 'https://www.bilibili.com/video/BV1xx411c7mD',
  signature: 'sig'
} as PageInfo;

const tab = {
  id: 't1',
  title: '测试视频',
  url: info.url,
  loading: false,
  active: true,
  canGoBack: false,
  canGoForward: false,
  suspended: false,
  zoom: 1
} as TabInfo;

type Handlers = { done?: (event: unknown) => void; error?: (event: unknown) => void };

function installBsub(options: { saved?: boolean; pageError?: string } = {}) {
  const handlers: Handlers = {};
  const api = {
    getPageInfo: vi.fn(async () =>
      options.pageError
        ? { ok: false as const, error: options.pageError }
        : { ok: true as const, data: info }
    ),
    getSummary: vi.fn(async () =>
      options.saved
        ? { ok: true as const, data: { content: '# 已保存的总结', model: 'deepseek', updatedAt: 0 } }
        : { ok: true as const, data: null }
    ),
    getSettings: vi.fn(async () => ({
      ok: true as const,
      data: {
        settings: {
          ai: { preProofread: false },
          search: { verify: true },
          export: { defaultFormat: 'md', format: 'md' }
        },
        version: '0.37.2'
      }
    })),
    onSettingsChanged: vi.fn(() => () => {}),
    onAiDelta: vi.fn(() => () => {}),
    onAiDone: vi.fn((cb: (event: unknown) => void) => {
      handlers.done = cb;
      return () => {};
    }),
    onAiError: vi.fn((cb: (event: unknown) => void) => {
      handlers.error = cb;
      return () => {};
    }),
    onAiStatus: vi.fn(() => () => {}),
    onAiReasoning: vi.fn(() => () => {}),
    cancelSummary: vi.fn(async () => undefined)
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return { api, handlers };
}

describe('SummaryPanel', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('加载已保存的总结并提示需要重新生成才有核对', async () => {
    installBsub({ saved: true });
    render(<SummaryPanel activeTab={tab} onOpenSettings={() => {}} />);
    expect(await screen.findByText('已保存的总结')).toBeTruthy();
    expect(screen.getByText(/重新生成会执行联网核对/)).toBeTruthy();
  });

  it('没有保存总结时展示空状态', async () => {
    installBsub();
    render(<SummaryPanel activeTab={tab} onOpenSettings={() => {}} />);
    expect(await screen.findByText('还没有总结')).toBeTruthy();
    expect(screen.getByText('生成总结')).toBeTruthy();
  });

  it('页面信息读取失败时显示错误', async () => {
    installBsub({ pageError: '需要登录' });
    render(<SummaryPanel activeTab={tab} onOpenSettings={() => {}} />);
    expect(await screen.findByText(/需要登录/, undefined, { timeout: 8000 })).toBeTruthy();
  });

  it('收到总结完成事件后渲染正文与核对卡片', async () => {
    const { handlers } = installBsub();
    render(<SummaryPanel activeTab={tab} onOpenSettings={() => {}} />);
    await screen.findByText('还没有总结');

    const verification = {
      items: [
        {
          label: '3nm',
          query: '3nm',
          line: '台积电 3nm 量产',
          references: [{ title: '证据标题', url: 'https://example.com/a', snippet: 's' }]
        }
      ],
      references: [{ title: '证据标题', url: 'https://example.com/a', snippet: 's' }],
      supplements: [],
      attempted: 1,
      failed: 0,
      judged: false,
      dropped: 0
    } as VerificationSummary;

    handlers.done?.({ requestId: '', text: '# 新总结', model: 'deepseek', verification });

    expect(await screen.findByText('新总结')).toBeTruthy();
    expect(screen.getByText(/本次未完成语义判定/)).toBeTruthy();
    expect(screen.getByText('证据标题')).toBeTruthy();
  });

  it('AI 失败事件显示错误', async () => {
    const { handlers } = installBsub();
    render(<SummaryPanel activeTab={tab} onOpenSettings={() => {}} />);
    await screen.findByText('还没有总结');
    handlers.error?.({ requestId: '', error: '模型超时' });
    expect(await screen.findByText(/模型超时/)).toBeTruthy();
  });
});
