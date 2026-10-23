import type { BrowserWindow } from 'electron';
import type { Result } from '../../shared/types';

/** IPC 注册函数共享的宿主上下文。 */
export interface IpcContext {
  win: BrowserWindow;
  /** 向渲染进程广播事件（窗口已销毁时自动忽略）。 */
  send: (channel: string, payload?: unknown) => void;
  /** 长任务取消句柄；ai:cancel 与 collection:summarize 共用。 */
  aiControllers: Map<string, AbortController>;
}

export function failure<T>(error: unknown): Result<T> {
  return { ok: false, error: (error as Error)?.message || String(error) };
}

// 任务记录是旁路能力：写库失败不能把总结/转录本身带崩。
export function trackJob(action: () => void): void {
  try {
    action();
  } catch (error) {
    console.warn('[jobs] 记录失败:', (error as Error).message);
  }
}
