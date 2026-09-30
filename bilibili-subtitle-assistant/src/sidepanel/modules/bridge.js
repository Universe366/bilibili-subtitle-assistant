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
// 与后台的长连接（流式会话）
// ---------------------------------------------------------------------------
//
// 背景：MV3 的 service worker 空闲约 30 秒会被回收，这是浏览器设计。
// 早先的实现**每次请求都新建 port、用完就断**，于是几乎每次都会跳出
// 「与后台的连接已断开：扩展后台已卸载或休眠」—— 其实后台完全正常，
// 只是那次连接刚好赶上 SW 被回收。
//
// 现在：
//   · **全程复用同一个 port**（模块级单例），不再反复连断
//   · port 断开时**自动重连**，且正在进行的流会自动重放一次
//   · 只有重试也用完，才给出一条「能照做」的提示（不再吓人）

const streams = new Map(); // rid -> handler

let sharedPort = null;
let connecting = false;
let reconnectTimer = null;
let reconnectDelay = 300;
let lastDisconnectAt = 0;
let consecutiveFailures = 0;

function dispatch(msg) {
  if (!msg || !msg.rid) return;
  const fn = streams.get(msg.rid);
  if (fn) {
    try {
      fn(msg);
    } catch (err) {
      /* 单个流的处理异常不影响连接本身 */
    }
  }
}

function handleDisconnect() {
  const hadPort = !!sharedPort;
  sharedPort = null;
  connecting = false;
  lastDisconnectAt = Date.now();
  if (!hadPort) return;
  // SW 被回收是正常现象 → 静默重连，不在这里报错
  scheduleReconnect();
}

function scheduleReconnect() {
  if (reconnectTimer || connecting) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    const p = ensurePort();
    if (p) {
      consecutiveFailures = 0;
      reconnectDelay = 300;
    } else {
      consecutiveFailures += 1;
      reconnectDelay = Math.min(5000, reconnectDelay * 2);
      scheduleReconnect();
    }
  }, reconnectDelay);
}

export function ensurePort() {
  if (sharedPort) return sharedPort;
  if (connecting) return null;
  connecting = true;
  try {
    const p = chrome.runtime.connect({ name: RPC.PORT_NAME });
    p.onMessage.addListener(dispatch);
    p.onDisconnect.addListener(handleDisconnect);
    sharedPort = p;
    consecutiveFailures = 0;
    reconnectDelay = 300;
  } catch (err) {
    // 极少见：扩展正在被重载
    sharedPort = null;
  } finally {
    connecting = false;
  }
  return sharedPort;
}

// 供测试与调试查看连接状态
export function portState() {
  return { connected: !!sharedPort, failures: consecutiveFailures, lastDisconnectAt };
}

export class Stream {
  constructor() {
    this.rid = null;
    this.closed = false;
    this.handlers = new Map();
    this.lastSend = null;
    this.retriesLeft = 1;
  }

  start(route, params, callbacks = {}) {
    this.rid = newId();
    this.closed = false;
    this.handlers = new Map();
    this.retriesLeft = 1;
    if (callbacks.onDelta) this.handlers.set(RPC.KIND_DELTA, (m) => callbacks.onDelta(m.text));
    if (callbacks.onLog) this.handlers.set(RPC.KIND_LOG, (m) => callbacks.onLog(m.level, m.text));
    if (callbacks.onProgress) this.handlers.set('stream:progress', (m) => callbacks.onProgress(m.info));
    if (callbacks.onReplace) this.handlers.set('stream:replace', (m) => callbacks.onReplace(m.text));
    if (callbacks.onTool) this.handlers.set('stream:tool', (m) => callbacks.onTool(m.event));
    if (callbacks.onReasoning) this.handlers.set('stream:reasoning', (m) => callbacks.onReasoning(m.text));
    if (callbacks.onError) this.handlers.set(RPC.KIND_ERROR, (m) => callbacks.onError(m.error));
    this.handlers.set(RPC.KIND_END, (m) => {
      if (callbacks.onEnd) callbacks.onEnd(m);
    });

    const payload = { kind: RPC.KIND_START, rid: this.rid, route, params };
    this.lastSend = payload;
    streams.set(this.rid, (m) => this._dispatch(m));
    this._post(payload);
    return this.rid;
  }

  _dispatch(msg) {
    // 后台被回收导致的中断 → 自动重放一次，用户几乎无感
    if (msg.kind === RPC.KIND_ERROR && msg.error && msg.error.kind === 'background' && !this.closed) {
      if (this.retriesLeft > 0 && this.lastSend) {
        this.retriesLeft -= 1;
        setTimeout(() => this._post({ ...this.lastSend, rid: this.rid }), 250);
        return;
      }
      const h = this.handlers.get(RPC.KIND_ERROR);
      if (h) {
        h({
          kind: RPC.KIND_ERROR,
          error: {
            kind: 'background',
            title: '后台暂时无响应',
            detail: '扩展后台被浏览器回收后重连失败，通常是浏览器正在更新扩展。',
            action: '如果反复出现，请在 chrome://extensions 点一下本扩展的刷新按钮。'
          }
        });
      }
      return;
    }
    const h = this.handlers.get(msg.kind);
    if (h) h(msg);
  }

  _post(payload) {
    if (this.closed) return;
    const p = ensurePort();
    if (!p) {
      // 连不上：稍后重试一次
      setTimeout(() => {
        if (!this.closed) this._post(payload);
      }, 500);
      return;
    }
    try {
      p.postMessage(payload);
    } catch (err) {
      // postMessage 抛错说明 port 已失效 → 重连后重放
      setTimeout(() => {
        if (!this.closed) this._post(payload);
      }, 300);
    }
  }

  cancel() {
    if (!this.rid) return;
    try {
      const p = ensurePort();
      if (p) p.postMessage({ kind: 'stream:cancel', rid: this.rid });
    } catch (err) {
      /* ignore */
    }
  }

  close() {
    this.closed = true;
    if (this.rid) streams.delete(this.rid);
    // 注意：**不断开共享 port** —— 反复连断正是 SW 频繁唤醒与
    // 「连接已断开」提示的根源。
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
