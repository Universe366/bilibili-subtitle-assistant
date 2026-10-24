// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PageDocument } from '../../../shared/types';
import { ReaderMode } from './ReaderMode';

const doc = {
  title: '一篇文章',
  url: 'https://example.com/post',
  text: '第一段正文。\n第二段正文。'
} as PageDocument;

function installBsub(options: { doc?: PageDocument | null; error?: string } = {}) {
  const api = {
    getPageDocument: vi.fn(async () =>
      options.error
        ? { ok: false as const, error: options.error }
        : { ok: true as const, data: options.doc === undefined ? doc : options.doc }
    ),
    writeClipboard: vi.fn(async () => ({ ok: true as const, data: null })),
    saveTextFile: vi.fn(async () => ({ ok: true as const, data: { path: 'C:/tmp/a.md' } })),
    openExternal: vi.fn(async () => ({ ok: true as const, data: null }))
  };
  Object.defineProperty(window, 'bsub', {
    configurable: true,
    value: new Proxy(api, {
      get(target, prop) {
        if (prop in target) return (target as Record<string, unknown>)[prop as string];
        return vi.fn(async () => ({ ok: true as const, data: null }));
      }
    })
  });
  return api;
}

function props(overrides: Record<string, unknown> = {}) {
  return { open: true, onClose: vi.fn(), onAskAi: vi.fn(), ...overrides };
}

describe('ReaderMode', () => {
  beforeEach(() => installBsub());
  afterEach(cleanup);

  it('关闭时不渲染', () => {
    const { container } = render(<ReaderMode {...props({ open: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('加载正文并展示标题、域名与段落', async () => {
    render(<ReaderMode {...props()} />);
    expect(await screen.findByText('一篇文章')).toBeTruthy();
    expect(screen.getByText(/example\.com/)).toBeTruthy();
    expect(screen.getByText('第一段正文。')).toBeTruthy();
  });

  it('字号按钮调整百分比', async () => {
    render(<ReaderMode {...props()} />);
    await screen.findByText('一篇文章');
    fireEvent.click(screen.getByText('A+'));
    expect(screen.getByText('110%')).toBeTruthy();
    fireEvent.click(screen.getByText('A-'));
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('复制与保存走 IPC 并提示', async () => {
    const api = installBsub();
    render(<ReaderMode {...props()} />);
    await screen.findByText('一篇文章');
    fireEvent.click(screen.getByText(/复制/));
    expect(api.writeClipboard).toHaveBeenCalled();
    expect(await screen.findByText('已复制 Markdown')).toBeTruthy();
    fireEvent.click(screen.getByText(/保存/));
    expect(api.saveTextFile).toHaveBeenCalled();
  });

  it('AI 总结先关闭再回调', async () => {
    const p = props();
    render(<ReaderMode {...p} />);
    await screen.findByText('一篇文章');
    fireEvent.click(screen.getByText(/AI 总结/));
    expect(p.onClose).toHaveBeenCalled();
    expect(p.onAskAi).toHaveBeenCalled();
  });

  it('提取失败展示错误', async () => {
    installBsub({ error: '页面为空' });
    render(<ReaderMode {...props()} />);
    expect(await screen.findByText(/页面为空/)).toBeTruthy();
  });
});
