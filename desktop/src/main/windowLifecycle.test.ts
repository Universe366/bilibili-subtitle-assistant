import { describe, expect, it, vi } from 'vitest';
import { bootstrapRenderer, handleCloseRequest, type CloseFlowDeps } from './windowLifecycle';

type Settings = { general: { closeToTray?: boolean; theme?: string } };

function closeDeps(overrides: Partial<CloseFlowDeps<Settings>> = {}) {
  const saved: Settings[] = [];
  const deps: CloseFlowDeps<Settings> = {
    settings: { general: {} },
    hideWindow: vi.fn(),
    quit: vi.fn(),
    showMessageBox: vi.fn(async () => ({ response: 2 })),
    loadSettings: vi.fn(() => ({ general: {} })),
    saveSettings: vi.fn((settings) => saved.push(settings)),
    setChoicePending: vi.fn(),
    setQuitting: vi.fn(),
    windowTitle: '拾字',
    ...overrides
  };
  return { deps, saved };
}

const event = () => ({ preventDefault: vi.fn() });

describe('handleCloseRequest', () => {
  it('退出中 / 关掉关闭到托盘 时直接放行，不弹窗', () => {
    const quitting = closeDeps();
    const e1 = event();
    expect(handleCloseRequest(e1, { isQuitting: true, choicePending: false }, quitting.deps)).toBe('allowed');
    expect(e1.preventDefault).not.toHaveBeenCalled();

    const noTray = closeDeps({ settings: { general: { closeToTray: false } } });
    const e2 = event();
    expect(handleCloseRequest(e2, { isQuitting: false, choicePending: false }, noTray.deps)).toBe('allowed');
    expect(noTray.deps.showMessageBox).not.toHaveBeenCalled();
  });

  it('默认拦截并弹窗，按钮顺序与文案固定', async () => {
    const { deps } = closeDeps();
    const e = event();
    expect(handleCloseRequest(e, { isQuitting: false, choicePending: false }, deps)).toBe('asked');
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(deps.setChoicePending).toHaveBeenCalledWith(true);
    const options = (deps.showMessageBox as any).mock.calls[0][0];
    expect(options.buttons).toEqual(['最小化到托盘', '退出应用', '取消']);
    expect(options.cancelId).toBe(2);
    expect(options.checkboxLabel).toBe('记住我的选择');
  });

  it('选「最小化到托盘」时隐藏窗口，不退出', async () => {
    const { deps } = closeDeps({
      showMessageBox: vi.fn(async () => ({ response: 0, checkboxChecked: false }))
    });
    handleCloseRequest(event(), { isQuitting: false, choicePending: false }, deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.hideWindow).toHaveBeenCalledTimes(1);
    expect(deps.quit).not.toHaveBeenCalled();
    expect(deps.setChoicePending).toHaveBeenLastCalledWith(false);
  });

  it('选「退出应用」时标记退出并 quit', async () => {
    const { deps } = closeDeps({
      showMessageBox: vi.fn(async () => ({ response: 1, checkboxChecked: false }))
    });
    handleCloseRequest(event(), { isQuitting: false, choicePending: false }, deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.setQuitting).toHaveBeenCalledWith(true);
    expect(deps.quit).toHaveBeenCalledTimes(1);
    expect(deps.hideWindow).not.toHaveBeenCalled();
  });

  it('取消时什么都不做', async () => {
    const { deps } = closeDeps({
      showMessageBox: vi.fn(async () => ({ response: 2, checkboxChecked: false }))
    });
    handleCloseRequest(event(), { isQuitting: false, choicePending: false }, deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.quit).not.toHaveBeenCalled();
    expect(deps.hideWindow).not.toHaveBeenCalled();
  });

  it('勾选「记住」时写回设置', async () => {
    const { deps, saved } = closeDeps({
      showMessageBox: vi.fn(async () => ({ response: 0, checkboxChecked: true })),
      loadSettings: vi.fn(() => ({ general: { theme: 'dark' } }))
    });
    handleCloseRequest(event(), { isQuitting: false, choicePending: false }, deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(saved).toHaveLength(1);
    expect(saved[0].general).toEqual({ theme: 'dark', closeToTray: true });
  });

  it('对话框失败时复位 pending，不退出', async () => {
    const { deps } = closeDeps({
      showMessageBox: vi.fn(async () => {
        throw new Error('dialog broken');
      })
    });
    handleCloseRequest(event(), { isQuitting: false, choicePending: false }, deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.setChoicePending).toHaveBeenLastCalledWith(false);
    expect(deps.quit).not.toHaveBeenCalled();
  });
});

describe('bootstrapRenderer', () => {
  const manager = {
    create: vi.fn(async () => 'id'),
    activate: vi.fn(async () => {})
  };

  it('恢复上次会话', async () => {
    manager.create.mockClear();
    manager.activate.mockClear();
    const result = await bootstrapRenderer({
      loadSettings: () => ({ general: {} }),
      loadSession: () => ({ tabs: [{ url: 'https://a' }, { url: 'https://b' }], activeUrl: 'https://b' }),
      manager,
      startUrl: 'https://start',
      packaged: true,
      enableDevHooks: false,
      log: vi.fn()
    });
    expect(result).toEqual({ restored: 2, devHooks: false });
    expect(manager.activate).toHaveBeenCalledWith('id');
  });

  it('设置里关掉恢复时直接打开起始页', async () => {
    manager.create.mockClear();
    const result = await bootstrapRenderer({
      loadSettings: () => ({ general: { restoreSession: false } }),
      loadSession: () => ({ tabs: [{ url: 'https://a' }] }),
      manager,
      startUrl: 'https://start',
      packaged: true,
      enableDevHooks: false,
      log: vi.fn()
    });
    expect(result.restored).toBe(0);
    expect(manager.create).toHaveBeenCalledWith('https://start');
  });

  it('没有 manager 时什么都不做', async () => {
    const result = await bootstrapRenderer({
      loadSettings: () => ({ general: {} }),
      loadSession: () => ({ tabs: [{ url: 'https://a' }] }),
      manager: null,
      startUrl: 'https://start',
      packaged: true,
      enableDevHooks: false
    });
    expect(result).toEqual({ restored: 0, devHooks: false });
  });

  it('开发探针：打包后默认不跑，显式开启才跑', async () => {
    const runDevHooks = vi.fn();
    const base = {
      loadSettings: () => ({ general: { restoreSession: false } }),
      loadSession: () => null,
      manager,
      startUrl: 'https://start',
      log: vi.fn()
    };
    const packed = await bootstrapRenderer({ ...base, packaged: true, enableDevHooks: false, runDevHooks });
    expect(packed.devHooks).toBe(false);
    expect(runDevHooks).not.toHaveBeenCalled();

    const forced = await bootstrapRenderer({ ...base, packaged: true, enableDevHooks: true, runDevHooks });
    expect(forced.devHooks).toBe(true);
    expect(runDevHooks).toHaveBeenCalledTimes(1);
  });

  it('未打包时默认跑开发探针，失败不影响启动', async () => {
    const runDevHooks = vi.fn(async () => {
      throw new Error('probe failed');
    });
    const log = vi.fn();
    const result = await bootstrapRenderer({
      loadSettings: () => ({ general: { restoreSession: false } }),
      loadSession: () => null,
      manager,
      startUrl: 'https://start',
      packaged: false,
      enableDevHooks: false,
      runDevHooks,
      log
    });
    expect(result.devHooks).toBe(true);
    expect(log).toHaveBeenCalledWith('[dev] hooks failed', 'probe failed');
  });
});
