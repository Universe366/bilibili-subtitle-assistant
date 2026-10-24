import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabManager } from './tabs';
import { createSessionPersister } from './shell';

const saveSession = vi.fn();
vi.mock('./session', () => ({
  loadSession: vi.fn(),
  saveSession: (...args: unknown[]) => saveSession(...args)
}));

function manager(tabs: Array<{ url: string }> = [], activeUrl = '') {
  return {
    sessionSnapshot: () => ({ tabs, activeUrl })
  } as unknown as TabManager;
}

describe('createSessionPersister', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveSession.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('persist 写入快照', () => {
    const persister = createSessionPersister(() => manager([{ url: 'https://a.example' }], 'https://a.example'));
    persister.persist();
    expect(saveSession).toHaveBeenCalledWith([{ url: 'https://a.example' }], 'https://a.example');
  });

  it('schedule 合并多次调用，只写一次', () => {
    const persister = createSessionPersister(() => manager([{ url: 'https://a.example' }]), 1500);
    persister.schedule();
    persister.schedule();
    persister.schedule();
    expect(saveSession).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(saveSession).toHaveBeenCalledTimes(1);
  });

  it('没有标签时不写盘；管理器为空也不崩', () => {
    createSessionPersister(() => manager([])).persist();
    createSessionPersister(() => null).persist();
    expect(saveSession).not.toHaveBeenCalled();
  });

  it('dispose 取消待写入', () => {
    const persister = createSessionPersister(() => manager([{ url: 'u' }]), 1500);
    persister.schedule();
    persister.dispose();
    vi.advanceTimersByTime(2000);
    expect(saveSession).not.toHaveBeenCalled();
  });
});
