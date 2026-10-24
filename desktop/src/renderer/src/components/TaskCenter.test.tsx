// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ExportRecord, JobRecord } from '../../../shared/types';
import { TaskCenter } from './TaskCenter';

const runningJob = {
  id: 'j1',
  type: 'batch-summary',
  status: 'running',
  title: '批量总结：合集 A',
  progress: 40,
  message: '正在处理第 2 个',
  createdAt: 1,
  updatedAt: 2,
  items: [
    { id: 'i1', title: '第一段', status: 'done' },
    { id: 'i2', title: '第二段', status: 'running' }
  ]
} as unknown as JobRecord;

const doneJob = {
  id: 'j2',
  type: 'summary',
  status: 'done',
  title: '总结：BV2',
  progress: 100,
  createdAt: 1,
  updatedAt: 2,
  items: []
} as unknown as JobRecord;

const exports: ExportRecord[] = [
  { id: 1, path: 'C:/tmp/out.md', format: 'md', title: '测试视频', createdAt: 1, bytes: 1024 }
] as unknown as ExportRecord[];

function installBsub() {
  const api = {
    listExports: vi.fn(async () => ({ ok: true as const, data: exports })),
    cancelJob: vi.fn(async () => ({ ok: true as const, data: null })),
    retryJob: vi.fn(async () => ({ ok: true as const, data: null })),
    pauseBatch: vi.fn(async () => ({ ok: true as const, data: null })),
    resumeBatch: vi.fn(async () => ({ ok: true as const, data: null })),
    clearFinishedJobs: vi.fn(async () => ({ ok: true as const, data: null })),
    openExport: vi.fn(async () => ({ ok: true as const, data: null })),
    revealExport: vi.fn(async () => ({ ok: true as const, data: null })),
    deleteExport: vi.fn(async () => ({ ok: true as const, data: null }))
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

describe('TaskCenter', () => {
  beforeEach(() => installBsub());
  afterEach(cleanup);

  it('关闭时不渲染', () => {
    const { container } = render(<TaskCenter open={false} jobs={[]} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('展示任务标题、进度与状态', () => {
    render(<TaskCenter open jobs={[runningJob, doneJob]} onClose={() => {}} />);
    expect(screen.getByText('批量总结：合集 A')).toBeTruthy();
    expect(screen.getByText('总结：BV2')).toBeTruthy();
    expect(screen.getByText(/40%/)).toBeTruthy();
    expect(screen.getAllByText('进行中').length).toBeGreaterThan(0);
    expect(screen.getByText('第一段')).toBeTruthy();
  });

  it('暂停与取消调用对应 IPC', async () => {
    const api = installBsub();
    render(<TaskCenter open jobs={[runningJob]} onClose={() => {}} />);
    fireEvent.click(screen.getByText('暂停'));
    await waitFor(() => expect(api.pauseBatch).toHaveBeenCalledWith('j1'));
    fireEvent.click(screen.getByText('取消'));
    await waitFor(() => expect(api.cancelJob).toHaveBeenCalledWith('j1'));
  });

  it('导出 tab 加载 listExports 并展示记录', async () => {
    const api = installBsub();
    render(<TaskCenter open jobs={[]} onClose={() => {}} />);
    fireEvent.click(screen.getByText('导出'));
    expect(await screen.findByText('测试视频')).toBeTruthy();
    expect(api.listExports).toHaveBeenCalled();
  });

  it('清除已完成任务调用 clearFinishedJobs', async () => {
    const api = installBsub();
    render(<TaskCenter open jobs={[doneJob]} onClose={() => {}} />);
    fireEvent.click(screen.getByTitle(/清除已完成/));
    await waitFor(() => expect(api.clearFinishedJobs).toHaveBeenCalled());
  });
});
