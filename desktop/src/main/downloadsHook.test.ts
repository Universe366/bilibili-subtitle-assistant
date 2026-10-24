import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDownloadHook } from './downloadsHook';

/** 下载钩子回归测试：假 electron session + 假 DownloadItem，锁住落盘路径、节流与状态映射。 */

const mocks = vi.hoisted(() => {
  type Handler = (...args: any[]) => void;
  const listeners: Record<string, Handler[]> = {};
  const defaultSession = {
    on(event: string, handler: Handler) {
      (listeners[event] ||= []).push(handler);
    },
    emit(event: string, ...args: any[]) {
      (listeners[event] || []).forEach((handler) => handler({}, ...args));
    },
    reset() {
      Object.keys(listeners).forEach((key) => delete listeners[key]);
    }
  };
  return {
    defaultSession,
    addDownload: vi.fn(),
    updateDownload: vi.fn(),
    registerDownloadItem: vi.fn(),
    unregisterDownloadItem: vi.fn(),
    getPath: vi.fn(() => 'C:/Users/me/Downloads')
  };
});

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
  session: { defaultSession: mocks.defaultSession }
}));

vi.mock('./library', () => ({
  addDownload: (...args: unknown[]) => mocks.addDownload(...args),
  updateDownload: (...args: unknown[]) => mocks.updateDownload(...args)
}));

vi.mock('./downloads', () => ({
  registerDownloadItem: (...args: unknown[]) => mocks.registerDownloadItem(...args),
  unregisterDownloadItem: (...args: unknown[]) => mocks.unregisterDownloadItem(...args)
}));

class FakeItem {
  handlers: Record<string, Array<(...args: any[]) => void>> = {};
  savedPath = '';
  dialogOptions: any = null;
  url = 'https://cdn.example/v.zip';
  filename = 'v.zip';
  total = 1000;
  received = 0;

  setSavePath(p: string) {
    this.savedPath = p;
  }
  setSaveDialogOptions(o: unknown) {
    this.dialogOptions = o;
  }
  getURL() {
    return this.url;
  }
  getFilename() {
    return this.filename;
  }
  getTotalBytes() {
    return this.total;
  }
  getReceivedBytes() {
    return this.received;
  }
  getSavePath() {
    return this.savedPath;
  }
  on(event: string, handler: (...args: any[]) => void) {
    (this.handlers[event] ||= []).push(handler);
  }
  fire(event: string, ...args: any[]) {
    (this.handlers[event] || []).forEach((handler) => handler({}, ...args));
  }
}

function windowStub() {
  const send = vi.fn();
  return { win: { isDestroyed: () => false, webContents: { send } } as any, send };
}

const originalDir = process.env.BSUB_DOWNLOAD_DIR;

describe('installDownloadHook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    mocks.defaultSession.reset();
    mocks.addDownload.mockReset().mockReturnValue(7);
    mocks.updateDownload.mockReset();
    mocks.registerDownloadItem.mockReset();
    mocks.unregisterDownloadItem.mockReset();
    mocks.getPath.mockClear();
    delete process.env.BSUB_DOWNLOAD_DIR;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalDir === undefined) delete process.env.BSUB_DOWNLOAD_DIR;
    else process.env.BSUB_DOWNLOAD_DIR = originalDir;
  });

  it('BSUB_DOWNLOAD_DIR 存在时直接落到该目录', () => {
    process.env.BSUB_DOWNLOAD_DIR = 'D:/tmp/dl';
    const { win } = windowStub();
    installDownloadHook(() => win);
    const item = new FakeItem();
    mocks.defaultSession.emit('will-download', item);
    expect(item.savedPath).toBe(path.join('D:/tmp/dl', 'v.zip'));
    expect(item.dialogOptions).toBeNull();
  });

  it('没有自动目录时弹保存对话框，默认落到下载目录', () => {
    const { win } = windowStub();
    installDownloadHook(() => win);
    const item = new FakeItem();
    mocks.defaultSession.emit('will-download', item);
    expect(mocks.getPath).toHaveBeenCalledWith('downloads');
    expect(item.dialogOptions).toMatchObject({ title: '保存文件' });
    expect(String(item.dialogOptions.defaultPath)).toContain('Downloads');
    expect(String(item.dialogOptions.defaultPath)).toContain('v.zip');
  });

  it('登记下载并通知界面', () => {
    const { win, send } = windowStub();
    installDownloadHook(() => win);
    const item = new FakeItem();
    mocks.defaultSession.emit('will-download', item);
    expect(mocks.addDownload).toHaveBeenCalledWith({
      url: 'https://cdn.example/v.zip',
      filename: 'v.zip',
      total: 1000
    });
    expect(mocks.registerDownloadItem).toHaveBeenCalledWith(7, item);
    expect(send).toHaveBeenCalledWith('downloads:changed');
  });

  it('进度按 500ms 节流，但完成时强制写一次', () => {
    const { win } = windowStub();
    installDownloadHook(() => win);
    const item = new FakeItem();
    mocks.defaultSession.emit('will-download', item);
    mocks.updateDownload.mockClear();

    item.received = 100;
    item.fire('updated', 'progressing');
    item.received = 200;
    item.fire('updated', 'progressing');
    expect(mocks.updateDownload).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(600);
    item.received = 300;
    item.fire('updated', 'progressing');
    expect(mocks.updateDownload).toHaveBeenCalledTimes(2);

    item.received = 1000;
    item.fire('done', 'completed');
    expect(mocks.updateDownload).toHaveBeenLastCalledWith(7, {
      state: 'completed',
      total: 1000,
      received: 1000,
      path: '',
      finished: true
    });
    expect(mocks.unregisterDownloadItem).toHaveBeenCalledWith(7);
  });

  it('done 的状态映射：cancelled / interrupted', () => {
    const { win } = windowStub();
    installDownloadHook(() => win);
    const item = new FakeItem();
    mocks.defaultSession.emit('will-download', item);
    mocks.updateDownload.mockClear();

    item.fire('done', 'cancelled');
    expect(mocks.updateDownload).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ state: 'cancelled', finished: true })
    );

    item.fire('done', 'interrupted');
    expect(mocks.updateDownload).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ state: 'interrupted', finished: true })
    );
  });

  it('登记失败时不抛错，也不注册句柄', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.addDownload.mockImplementationOnce(() => {
      throw new Error('db locked');
    });
    const { win } = windowStub();
    installDownloadHook(() => win);
    const item = new FakeItem();
    expect(() => mocks.defaultSession.emit('will-download', item)).not.toThrow();
    expect(mocks.registerDownloadItem).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('窗口已销毁时不同界面广播', () => {
    const send = vi.fn();
    installDownloadHook(() => ({ isDestroyed: () => true, webContents: { send } }) as any);
    const item = new FakeItem();
    mocks.defaultSession.emit('will-download', item);
    expect(send).not.toHaveBeenCalled();
  });
});
