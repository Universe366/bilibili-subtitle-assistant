import { describe, expect, it, vi } from 'vitest';
import { restoreSession, type RestoreManager, type SavedSession } from './sessionRestore';

function fakeManager(behaviour: { failUrls?: string[] } = {}) {
  const created: Array<{ id: string; url: string; activate?: boolean }> = [];
  const activated: string[] = [];
  const manager: RestoreManager = {
    async create(url, options) {
      if (behaviour.failUrls && behaviour.failUrls.includes(url)) throw new Error('boom');
      const id = `tab-${created.length + 1}`;
      created.push({ id, url, activate: options?.activate });
      return id;
    },
    async activate(id) {
      activated.push(id);
    }
  };
  return { manager, created, activated };
}

const session = (tabs: string[], activeUrl: string): SavedSession => ({
  tabs: tabs.map((url) => ({ url })),
  activeUrl
});

describe('restoreSession', () => {
  it('没有保存的会话时打开起始页', async () => {
    const { manager, created } = fakeManager();
    const result = await restoreSession({ manager, saved: null, startUrl: 'https://start' });
    expect(result).toEqual({ restored: 0, usedStartUrl: true, activeUrl: 'https://start' });
    expect(created).toEqual([{ id: 'tab-1', url: 'https://start', activate: undefined }]);
  });

  it('保存的标签为空也退回起始页', async () => {
    const { manager, created } = fakeManager();
    const result = await restoreSession({ manager, saved: { tabs: [] }, startUrl: 'https://start' });
    expect(result.usedStartUrl).toBe(true);
    expect(created.map((item) => item.url)).toEqual(['https://start']);
  });

  it('逐个恢复且都不激活，最后激活 activeUrl 对应的标签', async () => {
    const { manager, created, activated } = fakeManager();
    const result = await restoreSession({
      manager,
      saved: session(['https://a', 'https://b', 'https://c'], 'https://b'),
      startUrl: 'https://start'
    });
    expect(created.map((item) => item.url)).toEqual(['https://a', 'https://b', 'https://c']);
    expect(created.every((item) => item.activate === false)).toBe(true);
    expect(activated).toEqual(['tab-2']);
    expect(result).toEqual({ restored: 3, usedStartUrl: false, activeUrl: 'https://b' });
  });

  it('activeUrl 找不到时激活最后一个', async () => {
    const { manager, activated } = fakeManager();
    const result = await restoreSession({
      manager,
      saved: session(['https://a', 'https://b'], 'https://gone'),
      startUrl: 'https://start'
    });
    expect(activated).toEqual(['tab-2']);
    expect(result.activeUrl).toBe('https://b');
  });

  it('单个标签失败只记日志，其余继续恢复', async () => {
    const { manager, activated } = fakeManager({ failUrls: ['https://bad'] });
    const warn = vi.fn();
    const result = await restoreSession({
      manager,
      saved: session(['https://a', 'https://bad', 'https://c'], 'https://c'),
      startUrl: 'https://start',
      warn
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toBe('https://bad');
    expect(result.restored).toBe(2);
    expect(activated).toEqual(['tab-2']);
  });

  it('全部失败时退回起始页', async () => {
    const { manager, created } = fakeManager({ failUrls: ['https://a'] });
    const result = await restoreSession({
      manager,
      saved: session(['https://a'], 'https://a'),
      startUrl: 'https://start'
    });
    expect(result.usedStartUrl).toBe(true);
    expect(created.map((item) => item.url)).toEqual(['https://start']);
  });
});
