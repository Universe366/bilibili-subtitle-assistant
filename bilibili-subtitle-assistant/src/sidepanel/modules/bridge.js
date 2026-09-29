// 与后台通信：统一 RPC 封装，一律带超时；流式走长连接端口。

import { RPC, METHOD_TIMEOUT, DEFAULT_RPC_TIMEOUT } from '../../shared/constants.js';

function newId() {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// 查询后台（service worker）实际在跑的版本。
// 用途：MV3 里 SW 与面板是两份独立更新的代码 —— 只刷新扩展时，
// 面板会立刻用上新代码，而**旧的 SW 可能仍在运行**，于是出现
// 「日志是新版、请求却还是旧版行为」这种极具迷惑性的现象。
// 把 SW 版本打进转录日志，就能一眼看出后台是不是旧的。
export function backgroundVersion(timeoutMs = 3000) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, timeoutMs);
    try {
      chrome.runtime.sendMessage({ type: 'bsub:ping' }, (res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) return resolve(null);
        resolve((res && res.version) || null);
      });
    } catch (err) {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(null);
      }
    }
  });
}

export function call(method, params = {}, opts = {}) {  const timeout = opts.timeoutMs || METHOD_TIMEOUT[method] || DEFAULT_RPC_TIMEOUT;
  const id = newId();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        Object.assign(new Error('后台响应超时'), {
          payload: {
            kind: 'timeout',
            title: '后台响应超时',
            detail: `${method} 在 ${Math.round(timeout / 1000)} 秒内没有返回。`,
            action: '请重试；若反复超时，点击设置 → 诊断复制信息后排查。'
          }
        })
      );
    }, timeout);

    let sendError = null;
    try {
      chrome.runtime.sendMessage({ kind: RPC.KIND_REQ, id, method, params }, (res) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          sendError = lastErr.message || '无法连接后台';
        }
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (sendError) {
          reject(
            Object.assign(new Error(sendError), {
              payload: {
                kind: 'background',
                title: '无法连接扩展后台',
                detail: sendError,
                action: '请在 chrome://extensions 中重新加载本扩展，然后刷新侧边栏。'
              }
            })
          );
          return;
        }
        if (!res) {
          reject(
            Object.assign(new Error('后台没有响应'), {
              payload: {
                kind: 'background',
                title: '后台没有响应',
                detail: 'service worker 可能已休眠或已卸载。',
                action: '请刷新侧边栏；若仍无响应，到扩展管理页重新加载扩展。'
              }
            })
          );
          return;
        }
        if (res.ok) resolve(res.data);
        else
          reject(
            Object.assign(new Error((res.error && res.error.title) || '请求失败'), {
              payload: res.error || { title: '请求失败', detail: '' }
            })
          );
      });
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        Object.assign(err, {
          payload: err.payload || {
            kind: 'background',
            title: '扩展上下文已失效',
            detail: String(err && err.message),
            action: '扩展可能已更新或重新加载，请关闭并重新打开侧边栏，或刷新页面。'
          }
        })
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 流式会话（AI 总结 / 对话）
// ---------------------------------------------------------------------------

export class Stream {
  constructor() {
    this.port = null;
    this.rid = null;
    this.handlers = new Map();
    this.closed = false;
  }

  connect() {
    if (this.port) return this.port;
    this.port = chrome.runtime.connect({ name: RPC.PORT_NAME });
    this.port.onMessage.addListener((msg) => {
      if (!msg || msg.rid !== this.rid) return;
      const h = this.handlers.get(msg.kind);
      if (h) h(msg);
    });
    this.port.onDisconnect.addListener(() => {
      this.closed = true;
      const h = this.handlers.get(RPC.KIND_ERROR);
      if (h) {
        h({
          kind: RPC.KIND_ERROR,
          error: {
            kind: 'background',
            title: '与后台的连接已断开',
            detail: '扩展后台已卸载或休眠。',
            action: '请刷新侧边栏后重试。'
          }
        });
      }
    });
    return this.port;
  }

  start(route, params, callbacks = {}) {
    this.rid = newId();
    this.handlers = new Map();
    if (callbacks.onDelta) this.handlers.set(RPC.KIND_DELTA, (m) => callbacks.onDelta(m.text));
    if (callbacks.onLog) this.handlers.set(RPC.KIND_LOG, (m) => callbacks.onLog(m.level, m.text));
    if (callbacks.onProgress) this.handlers.set('stream:progress', (m) => callbacks.onProgress(m.info));
    if (callbacks.onReplace) this.handlers.set('stream:replace', (m) => callbacks.onReplace(m.text));
    if (callbacks.onError) this.handlers.set(RPC.KIND_ERROR, (m) => callbacks.onError(m.error));
    this.handlers.set(RPC.KIND_END, () => {
      if (callbacks.onEnd) callbacks.onEnd();
    });
    const port = this.connect();
    port.postMessage({ kind: RPC.KIND_START, rid: this.rid, route, params });
    return this.rid;
  }

  cancel() {
    if (this.port && this.rid) {
      try {
        this.port.postMessage({ kind: 'stream:cancel', rid: this.rid });
      } catch (err) {
        /* ignore */
      }
    }
  }

  close() {
    try {
      this.port && this.port.disconnect();
    } catch (err) {
      /* ignore */
    }
    this.port = null;
  }
}

export function onRuntimeMessage(cb) {
  const listener = (msg, sender, sendResponse) => {
    const r = cb(msg, sender);
    if (r === true) return true;
    sendResponse({ ok: true });
    return undefined;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

// 错误对象 -> 可操作提示（稳定性 #11）
export function errorPayload(err) {
  if (err && err.payload) return err.payload;
  return {
    kind: 'unknown',
    title: '操作失败',
    detail: (err && err.message) || String(err),
    action: '可复制诊断信息后排查。'
  };
}
