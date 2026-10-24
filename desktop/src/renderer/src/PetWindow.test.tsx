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
    getPageInfo: vi.fn(async () => ({
      ok: true as const,
      data: { title: '测试页', url: 'https://example.com', kind: 'video' }
    })),
    chat: vi.fn(async () => ({ ok: true as const, data: { requestId: 'pet-1' } })),
    focusMain: vi.fn(async () => undefined),
    setPetEnabled: vi.fn(async () => undefined),
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

describe('PetWindow', () => {
  afterEach(cleanup);

  it('默认只有桌宠，点击展开气泡', () => {
    installBsub();
    render(<PetWindow />);
    expect(screen.queryByPlaceholderText(/输入问题/)).toBeNull();
    fireEvent.click(screen.getByTitle(/点击聊天/));
    expect(screen.getByPlaceholderText(/输入问题/)).toBeTruthy();
  });

  it('快捷动作直接发送预设提示词', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    fireEvent.click(screen.getByTitle(/点击聊天/));
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
    fireEvent.click(screen.getByTitle(/点击聊天/));
    const input = screen.getByPlaceholderText(/输入问题/);
    fireEvent.change(input, { target: { value: '这个视频讲了什么' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    const requestId = ((api.chat.mock.calls[0] as unknown[])[0] as { requestId: string }).requestId;
    handlers.done?.({ requestId, text: '它讲了三个要点', model: 'test' });
    expect(await screen.findByText('它讲了三个要点')).toBeTruthy();
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
    fireEvent.click(screen.getByTitle(/点击聊天/));
    fireEvent.click(screen.getByTitle(/隐藏桌宠/));
    expect(api.setPetEnabled).toHaveBeenCalledWith(false);
  });
});
