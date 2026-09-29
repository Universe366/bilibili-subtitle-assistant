// 网络工具：所有跨上下文请求都带超时（第七章），并保证 AbortController 可外部终止。

import { AppError, classifyNetwork, httpError } from './errors.js';

export const NOOP = () => {};

export function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/, '');
  const p = String(path || '').replace(/^\/+/, '');
  if (!b) return `/${p}`;
  if (b.endsWith('/chat/completions') || b.endsWith('/audio/transcriptions')) {
    // 用户把完整端点写进接口地址时，直接用
    return b;
  }
  return `${b}/${p}`;
}

export function makeAbort(external, timeoutMs) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer =
    timeoutMs && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          ctrl.abort();
        }, timeoutMs)
      : null;
  const onExternal = () => ctrl.abort();
  if (external) {
    if (external.aborted) ctrl.abort();
    else external.addEventListener('abort', onExternal, { once: true });
  }
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (external) external.removeEventListener('abort', onExternal);
  };
  return {
    signal: ctrl.signal,
    cleanup,
    didTimeout: () => timedOut,
    toError(err, ctx) {
      if (timedOut) {
        return new AppError(
          'timeout',
          '请求超时',
          `超过 ${Math.round(timeoutMs / 1000)} 秒没有响应。`,
          '检查网络；或在 设置 → 语音识别 / AI 平台 里调大超时时间后重试。'
        );
      }
      return classifyNetwork(err, ctx);
    }
  };
}

// 带超时的 fetch；返回 Response（已处理网络错误分类）。
export async function timedFetch(url, init = {}, opts = {}) {
  const { timeoutMs = 60000, externalSignal = null, ctx = {} } = opts;
  const abort = makeAbort(externalSignal, timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: abort.signal });
    return res;
  } catch (err) {
    throw abort.toError(err, ctx);
  } finally {
    abort.cleanup();
  }
}

export async function fetchJson(url, init = {}, opts = {}) {
  const res = await timedFetch(url, init, opts);
  if (!res.ok) throw await httpError(res, opts.ctx);
  try {
    return await res.json();
  } catch (err) {
    throw new AppError(
      'parse',
      '返回内容不是合法 JSON',
      (err && err.message) || '',
      '确认接口地址指向 OpenAI 兼容接口（通常以 /v1 结尾）。'
    );
  }
}

// ---------------------------------------------------------------------------
// 流式解析
// ---------------------------------------------------------------------------

// 逐行读取 SSE / NDJSON 流，回调每行数据。
export async function readLines(res, onLine, opts = {}) {
  const { externalSignal = null } = opts;
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  try {
    for (;;) {
      if (externalSignal && externalSignal.aborted) {
        try {
          await reader.cancel();
        } catch (err) {
          /* ignore */
        }
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf('\n');
      while (idx >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (line.length) await onLine(line);
        idx = buf.indexOf('\n');
      }
    }
    buf += decoder.decode();
    if (buf.trim().length) await onLine(buf.replace(/\r$/, ''));
  } finally {
    try {
      reader.releaseLock();
    } catch (err) {
      /* ignore */
    }
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
