import type { BrowserWindow } from 'electron';
import type { Result } from '../../shared/types';
import type { TabManager } from '../tabs';

/** IPC 注册函数共享的宿主上下文。 */
export interface IpcContext {
  win: BrowserWindow;
  tabs: TabManager;
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

/** 把 `t=` 播放位置安全地拼到链接上；非 http(s) 或非法时间原样返回。 */
export function withStartParam(url: string, seconds: number): string {
  if (!url || !(seconds > 0)) return url;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return url;
    parsed.searchParams.set('t', String(Math.floor(seconds)));
    return parsed.toString();
  } catch {
    return url;
  }
}
