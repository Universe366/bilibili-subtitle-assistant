// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PetWindow } from './PetWindow';

function installBsub() {
  const handlers: {
    delta?: (event: unknown) => void;
    done?: (event: unknown) => void;
    error?: (event: unknown) => void;
  } = {};
  const api = {
    getSettings: vi.fn(async () => ({
      ok: true as const,
      data: {
        settings: {
          general: {
            petSize: 96,
            petOpacity: 1,
            petSound: true,
            petIdleTalk: true,
            petAlwaysOnTop: true
          },
          ai: { preProofread: false },
          search: { verify: true }
        },
        version: '0.38.10'
      }
    })),
    getPageInfo: vi.fn(async () => ({
      ok: true as const,
      data: { title: '测试页', url: 'https://example.com', kind: 'video' }
    })),
    chat: vi.fn(async () => ({ ok: true as const, data: { requestId: 'pet-1' } })),
    cancelChat: vi.fn(async () => undefined),
    focusMain: vi.fn(async () => undefined),
    setPetEnabled: vi.fn(async () => undefined),
    setPetLayout: vi.fn(async () => undefined),
    setPetAlwaysOnTop: vi.fn(async (enabled: boolean) => enabled),
    toggleMedia: vi.fn(async () => ({ ok: true as const, data: { playing: false } })),
    resetPetPosition: vi.fn(async () => undefined),
    isMediaPlaying: vi.fn(async () => ({ ok: true as const, data: false })),
    petPosition: vi.fn(async () => ({ x: 100, y: 100 })),
    movePet: vi.fn(async () => undefined),
    dropPet: vi.fn(async () => ({ x: 10, y: 10 })),
    onChatDelta: vi.fn((cb: (event: unknown) => void) => {
      handlers.delta = cb;
      return () => {};
    }),
    onChatDone: vi.fn((cb: (event: unknown) => void) => {
      handlers.done = cb;
      return () => {};
    }),
    onChatError: vi.fn((cb: (event: unknown) => void) => {
      handlers.error = cb;
      return () => {};
    })
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return { api, handlers };
}

function openBubble() {
  fireEvent.click(screen.getByTitle(/点击聊天/));
}

describe('PetWindow', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('默认只有桌宠，点击展开气泡', () => {
    installBsub();
    render(<PetWindow />);
    expect(screen.queryByPlaceholderText(/输入问题/)).toBeNull();
    openBubble();
    expect(screen.getByPlaceholderText(/输入问题/)).toBeTruthy();
  });

  it('按内容切换窗口布局：compact → bubble → compact', () => {
    const { api } = installBsub();
    render(<PetWindow />);
    expect(api.setPetLayout).toHaveBeenLastCalledWith('compact');
    openBubble();
    expect(api.setPetLayout).toHaveBeenLastCalledWith('bubble');
    openBubble();
    expect(api.setPetLayout).toHaveBeenLastCalledWith('compact');
  });

  it('打开挂件时窗口变宽，挂件状态会记住', () => {
    const { api } = installBsub();
    const first = render(<PetWindow />);
    openBubble();
    fireEvent.click(screen.getByTitle(/桌面小挂件/));
    expect(api.setPetLayout).toHaveBeenLastCalledWith('bubble');
    expect(localStorage.getItem('pet-widget')).toBe('1');
    first.unmount();

    const second = installBsub();
    render(<PetWindow />);
    expect(screen.getByPlaceholderText(/加一条待办/)).toBeTruthy();
    expect(second.api.setPetLayout).toHaveBeenLastCalledWith('widget');
  });

  it('快捷动作直接发送预设提示词', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    openBubble();
    fireEvent.click(screen.getByText('总结这个页面'));
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    const payload = (api.chat.mock.calls[0] as unknown[])[0] as {
      messages: Array<{ content: string }>;
    };
    expect(payload.messages[0].content).toContain('总结当前页面');
  });

  it('发送问题后，完成事件显示回答', async () => {
    const { api, handlers } = installBsub();
    render(<PetWindow />);
    openBubble();
    const input = screen.getByPlaceholderText(/输入问题/);
    fireEvent.change(input, { target: { value: '这个视频讲了什么' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    const requestId = ((api.chat.mock.calls[0] as unknown[])[0] as { requestId: string }).requestId;
    handlers.done?.({ requestId, text: '它讲了三个要点', model: 'test' });
    expect(await screen.findByText('它讲了三个要点')).toBeTruthy();
  });

  it('生成中可点「停止」，会取消这次请求', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    openBubble();
    const input = screen.getByPlaceholderText(/输入问题/);
    fireEvent.change(input, { target: { value: '慢慢想' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    fireEvent.click(screen.getByTitle('停止生成'));
    expect(api.cancelChat).toHaveBeenCalled();
    expect(screen.queryByTitle('停止生成')).toBeNull();
  });

  it('回答可以复制到剪贴板', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    const { api, handlers } = installBsub();
    render(<PetWindow />);
    openBubble();
    const input = screen.getByPlaceholderText(/输入问题/);
    fireEvent.change(input, { target: { value: '要点' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    const requestId = ((api.chat.mock.calls[0] as unknown[])[0] as { requestId: string }).requestId;
    handlers.done?.({ requestId, text: '复制我', model: 'test' });
    expect(await screen.findByText('复制我')).toBeTruthy();

    fireEvent.click(screen.getByTitle('把回答复制到剪贴板'));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('复制我'));
    expect(await screen.findByText('已复制')).toBeTruthy();
  });

  it('右键菜单可切换置顶、控制播放', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    fireEvent.contextMenu(screen.getByTitle(/点击聊天/));
    expect(screen.getByText('打开主窗口')).toBeTruthy();
    expect(screen.getByText('继续播放')).toBeTruthy();

    fireEvent.click(screen.getByText('取消置顶'));
    await vi.waitFor(() => expect(api.setPetAlwaysOnTop).toHaveBeenCalledWith(false));

    fireEvent.contextMenu(screen.getByTitle(/点击聊天/));
    fireEvent.click(screen.getByText('继续播放'));
    await vi.waitFor(() => expect(api.toggleMedia).toHaveBeenCalled());
  });

  it('右键菜单可以重置位置和隐藏', () => {
    const { api } = installBsub();
    render(<PetWindow />);
    fireEvent.contextMenu(screen.getByTitle(/点击聊天/));
    fireEvent.click(screen.getByText('重置位置'));
    expect(api.resetPetPosition).toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByTitle(/点击聊天/));
    fireEvent.click(screen.getByText('隐藏桌宠'));
    expect(api.setPetEnabled).toHaveBeenCalledWith(false);
  });

  it('Esc 先关菜单，再关气泡', () => {
    installBsub();
    render(<PetWindow />);
    fireEvent.contextMenu(screen.getByTitle(/点击聊天/));
    expect(screen.getByText('打开主窗口')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('打开主窗口')).toBeNull();

    openBubble();
    expect(screen.getByPlaceholderText(/输入问题/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByPlaceholderText(/输入问题/)).toBeNull();
  });

  it('挂件显示时钟并可加待办', () => {
    installBsub();
    render(<PetWindow />);
    openBubble();
    fireEvent.click(screen.getByTitle(/桌面小挂件/));
    const input = screen.getByPlaceholderText(/加一条待办/);
    fireEvent.change(input, { target: { value: '写周报' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('写周报')).toBeTruthy();
  });

  it('双击桌宠打开主窗口', () => {
    const { api } = installBsub();
    render(<PetWindow />);
    fireEvent.doubleClick(screen.getByTitle(/点击聊天/));
    expect(api.focusMain).toHaveBeenCalled();
  });

  it('气泡里的隐藏按钮关闭桌宠', () => {
    const { api } = installBsub();
    render(<PetWindow />);
    openBubble();
    fireEvent.click(screen.getByTitle(/隐藏桌宠/));
    expect(api.setPetEnabled).toHaveBeenCalledWith(false);
  });
});
