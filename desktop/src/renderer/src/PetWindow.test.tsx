// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PetWindow } from './PetWindow';

const SHOT = 'data:image/png;base64,AAAA';

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
    capturePage: vi.fn(async () => ({ ok: true as const, data: { dataUrl: SHOT } })),
    readSelection: vi.fn(async () => ({
      ok: true as const,
      data: { title: '测试页', url: 'https://example.com', selection: '这段是被选中的文字' }
    })),
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

function lastChatPayload(api: ReturnType<typeof installBsub>['api']) {
  const calls = api.chat.mock.calls as unknown as Array<
    [{ includePage: boolean; web: boolean; messages: Array<{ content: string; images?: string[] }> }]
  >;
  return calls.at(-1)?.[0] as {
    includePage: boolean;
    web: boolean;
    messages: Array<{ content: string; images?: string[] }>;
  };
}

describe('PetWindow', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('默认只有桌宠，点击展开气泡', () => {
    installBsub();
    render(<PetWindow />);
    expect(screen.queryByPlaceholderText(/问点什么/)).toBeNull();
    openBubble();
    expect(screen.getByPlaceholderText(/问点什么/)).toBeTruthy();
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

  it('看屏幕：截图后带图提问，且不把整页正文塞进去', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    openBubble();
    fireEvent.click(screen.getByTitle('截取当前页面并提问（识图）'));

    await vi.waitFor(() => expect(api.capturePage).toHaveBeenCalled(), { timeout: 5000 });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    const payload = lastChatPayload(api);
    expect(payload.includePage).toBe(false);
    expect(payload.web).toBe(false);
    expect(payload.messages[0].images).toEqual([SHOT]);
    expect(payload.messages[0].content).toContain('截图');
  });

  it('联网开关会带 web:true，并记住状态', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    openBubble();
    fireEvent.click(screen.getByTitle('打开联网检索'));
    expect(localStorage.getItem('pet-web')).toBe('1');
    expect(screen.getByPlaceholderText(/本轮会联网/)).toBeTruthy();

    const input = screen.getByPlaceholderText(/本轮会联网/);
    fireEvent.change(input, { target: { value: '查一下 Electron 45 发布时间' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    expect(lastChatPayload(api).web).toBe(true);
  });

  it('解释选中：把选中文字作为上下文发出去', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    openBubble();
    fireEvent.click(screen.getByText('解释选中'));
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    const payload = lastChatPayload(api);
    expect(payload.messages[0].content).toContain('这段是被选中的文字');
    expect(payload.includePage).toBe(false);
  });

  it('没选中文字时给出提示，不发请求', async () => {
    const { api } = installBsub();
    api.readSelection.mockResolvedValueOnce({
      ok: true,
      data: { title: '测试页', url: 'https://example.com', selection: '' }
    } as never);
    render(<PetWindow />);
    openBubble();
    fireEvent.click(screen.getByText('解释选中'));
    await vi.waitFor(() => expect(screen.getByText('先在网页里选中一段文字')).toBeTruthy());
    expect(api.chat).not.toHaveBeenCalled();
  });

  it('截图后模型不支持图片时，提示去换视觉模型', async () => {
    const { api, handlers } = installBsub();
    api.chat.mockResolvedValueOnce({ ok: true, data: { requestId: 'pet-shot' } } as never);
    render(<PetWindow />);
    openBubble();
    fireEvent.click(screen.getByTitle('截取当前页面并提问（识图）'));
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    const first = (api.chat.mock.calls as unknown as Array<[{ requestId: string }]>)[0][0];
    handlers.error?.({ requestId: first.requestId, error: 'invalid content type for image' });
    expect(await screen.findByText(/不支持图片/)).toBeTruthy();
  });

  it('发送问题后，完成事件显示回答', async () => {
    const { api, handlers } = installBsub();
    render(<PetWindow />);
    openBubble();
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: '这个版本号什么时候发的' } });
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
    const input = screen.getByPlaceholderText(/问点什么/);
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
    const input = screen.getByPlaceholderText(/问点什么/);
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

  it('右键菜单可用「看屏幕」并切换置顶、控制播放', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    fireEvent.contextMenu(screen.getByTitle(/点击聊天/));
    expect(screen.getByText('看屏幕（识图）')).toBeTruthy();
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
    expect(screen.getByText('看屏幕（识图）')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('看屏幕（识图）')).toBeNull();

    openBubble();
    expect(screen.getByPlaceholderText(/问点什么/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByPlaceholderText(/问点什么/)).toBeNull();
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
