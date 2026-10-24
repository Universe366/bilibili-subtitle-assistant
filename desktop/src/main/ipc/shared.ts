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

/**
 * 长任务取消句柄。集中放这里，是因为 jobs:cancel 需要跨域查找句柄，
 * 而各域（ai / asr / 批量…）自己持有注册与清理逻辑。
 */
export const abortControllers = {
  ai: new Map<string, AbortController>(),
  chat: new Map<string, AbortController>(),
  asr: new Map<string, AbortController>(),
  translate: new Map<string, AbortController>(),
  optimize: new Map<string, AbortController>(),
  batch: new Map<string, AbortController>(),
  urlBatch: new Map<string, AbortController>()
};

/** 按 requestId 找任意域上的取消句柄。 */
export function findAbortController(id: string): AbortController | undefined {
  return (
    abortControllers.ai.get(id) ||
    abortControllers.chat.get(id) ||
    abortControllers.asr.get(id) ||
    abortControllers.translate.get(id) ||
    abortControllers.optimize.get(id) ||
    abortControllers.batch.get(id) ||
    abortControllers.urlBatch.get(id)
  );
}
