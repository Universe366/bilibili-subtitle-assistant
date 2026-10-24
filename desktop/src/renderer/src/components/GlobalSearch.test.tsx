// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GlobalSearchResult } from '../../../shared/types';
import { GlobalSearch } from './GlobalSearch';

const video = {
  id: 7,
  bvid: 'BV7',
  cid: 1,
  title: '命中的视频',
  owner: 'UP',
  duration: 60,
  kind: 'video',
  createdAt: 1,
  updatedAt: 1,
  tags: [],
  collections: []
};

const result = {
  query: '命中',
  items: [video],
  total: 4,
  lines: [{ videoId: 7, bvid: 'BV7', title: '命中的视频', start: 12, text: '命中的字幕句子' }],
  summaries: [{ videoId: 7, bvid: 'BV7', title: '命中的视频', snippet: '总结片段' }],
  collections: [{ collectionId: 3, name: '命中的合集', snippet: '合集片段' }]
} as unknown as GlobalSearchResult;

const baseProps = {
  open: true,
  onClose: vi.fn(),
  onOpenItem: vi.fn(),
  onOpenLine: vi.fn(),
  onOpenCollection: vi.fn()
};

function installBsub() {
  const api = { globalSearch: vi.fn(async () => ({ ok: true as const, data: result })) };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

describe('GlobalSearch', () => {
  beforeEach(() => installBsub());
  afterEach(cleanup);

  it('关闭时不渲染', () => {
    const { container } = render(<GlobalSearch {...baseProps} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('输入后防抖调用 globalSearch 并展示结果', async () => {
    const api = installBsub();
    render(<GlobalSearch {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/搜索/), { target: { value: '命中' } });
    await waitFor(() => expect(api.globalSearch).toHaveBeenCalledWith('命中'), { timeout: 3000 });
    expect((await screen.findAllByText('命中的视频', undefined, { timeout: 3000 })).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/命中的合集/).length).toBeGreaterThan(0);
  });

  it('点击字幕行与合集回调对应打开方式', async () => {
    const props = { ...baseProps };
    installBsub();
    render(<GlobalSearch {...props} />);
    fireEvent.change(screen.getByPlaceholderText(/搜索/), { target: { value: '命中' } });
    fireEvent.click(await screen.findByText(/命中的字幕句子/, undefined, { timeout: 3000 }));
    expect(props.onOpenLine).toHaveBeenCalled();
    fireEvent.click(screen.getAllByText(/命中的合集/)[0]);
    expect(props.onOpenCollection).toHaveBeenCalledWith(3);
  });

  it('Esc 关闭', () => {
    const props = { ...baseProps };
    render(<GlobalSearch {...props} />);
    fireEvent.keyDown(screen.getByPlaceholderText(/搜索/), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
  });
});
