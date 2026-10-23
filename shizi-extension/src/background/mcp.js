// MCP（Model Context Protocol）客户端。
//
// 浏览器扩展无法启动 stdio 子进程，所以只支持两种**远程传输**：
//   · http —— 直接 POST JSON-RPC（也叫 streamable HTTP，无状态）
//   · sse  —— 先 GET event-stream 拿到 endpoint，再向其 POST；分两块读取响应
//
// 协议要点（JSON-RPC 2.0）：
//   initialize → notifications/initialized → tools/list → tools/call
//
// 本模块只负责「与 MCP 服务对话」；把工具接进 AI 循环的逻辑在 tools.js。

import { AppError } from './errors.js';
import { timedFetch, joinUrl } from './net.js';

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'shizi-extension', version: '1.0.0' };

let seq = 0;
const nextId = () => `mcp_${Date.now().toString(36)}_${(seq += 1)}`;

function assertServer(server) {
  if (!server || !String(server.url || '').trim()) {
    throw new AppError('badargs', 'MCP 服务地址为空', '', '在 设置 → MCP 服务 里填写完整 URL。');
  }
}

function headersFor(server, extra = {}) {
  const h = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    ...extra
  };
  // 允许自定义鉴权头（例如 Authorization / X-API-Key）
  const token = String(server.token || '').trim();
  if (token) h.authorization = /^bearer\s/i.test(token) ? token : `Bearer ${token}`;
  for (const [k, v] of Object.entries(server.headers || {})) {
    if (k && v) h[k] = String(v);
  }
  return h;
}

// 从一次响应里解析出 JSON-RPC 报文。
// SSE 响应形如：
//   event: message
//   data: {"jsonrpc":"2.0","id":1,"result":{...}}
// 也可能直接返回 application/json。
function parseRpcResponse(text, expectId) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  // 直接是 JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const obj = JSON.parse(trimmed);
      return Array.isArray(obj) ? obj.find((o) => o && o.id === expectId) || obj[0] : obj;
    } catch (err) {
      /* 落到 SSE 解析 */
    }
  }
  // SSE：逐行找 data:
  const datas = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const m = /^data:\s*(.*)$/.exec(line);
    if (m && m[1]) datas.push(m[1]);
  }
  for (const d of datas) {
    try {
      const obj = JSON.parse(d);
      if (obj && (obj.id === expectId || obj.result || obj.error)) return obj;
    } catch (err) {
      /* 跳过非 JSON 的 data */
    }
  }
  return null;
}

// 解析 SSE 里的 endpoint 事件（SSE 传输握手）
function parseEndpoint(text) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^data:\s*(.+)$/.exec(line);
    if (m && /endpoint|url/i.test(line) === false && m[1]) {
      const v = m[1].trim();
      if (v.startsWith('/') || /^https?:/i.test(v)) return v;
    }
    const m2 = /^event:\s*endpoint/i.test(line);
    if (m2) continue;
  }
  const m3 = /^data:\s*(\/\S+|\S*\/message\S*)\s*$/m.exec(String(text || ''));
  return m3 ? m3[1].trim() : null;
}

async function rpcFetch(server, body, { timeoutMs, signal } = {}) {
  const url = String(server.url).trim();
  const res = await timedFetch(
    url,
    { method: 'POST', headers: headersFor(server), body: JSON.stringify(body) },
    { timeoutMs: timeoutMs || 40000, externalSignal: signal, ctx: {} }
  );
  const text = await res.text();
  if (!res.ok) {
    throw new AppError(
      'mcp',
      `MCP 服务返回 ${res.status}`,
      `${server.name || url}\n${text.slice(0, 300)}`,
      '检查 MCP 服务地址与鉴权配置（设置 → MCP 服务）。',
      { status: res.status }
    );
  }
  const msg = parseRpcResponse(text, body.id);
  if (!msg) {
    throw new AppError('mcp', 'MCP 响应无法解析', text.slice(0, 300), '确认该地址是 MCP 的 JSON-RPC 端点。');
  }
  if (msg.error) {
    throw new AppError(
      'mcp',
      `MCP 调用出错（${msg.error.code}）`,
      String(msg.error.message || ''),
      '检查该 MCP 服务的参数要求。',
      { mcpError: msg.error }
    );
  }
  return msg.result;
}

// SSE 传输：先 GET 拿到 endpoint，再向它 POST。
// 用 fetch 读流而不是 EventSource —— 后者只能 GET，发不了 tools/call。
async function rpcSse(server, body, { timeoutMs, signal } = {}) {
  const base = String(server.url).trim();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || 40000);
  if (signal) signal.addEventListener('abort', () => ctl.abort(), { once: true });
  try {
    const streamRes = await fetch(base, {
      method: 'GET',
      headers: { accept: 'text/event-stream', ...headersFor(server) },
      signal: ctl.signal
    });
    if (!streamRes.ok || !streamRes.body) {
      throw new AppError('mcp', `MCP SSE 连接失败（HTTP ${streamRes.status}）`, base, '确认地址支持 SSE 传输。');
    }
    const reader = streamRes.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let endpoint = null;
    // 读出 endpoint 事件即可，不需要读完整个流
    while (!endpoint) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      endpoint = parseEndpoint(buf);
    }
    if (!endpoint) throw new AppError('mcp', 'MCP SSE 没有给出 message endpoint', buf.slice(0, 200), '该服务可能不是标准 SSE 传输。');
    const postUrl = /^https?:/i.test(endpoint) ? endpoint : new URL(endpoint, base).href;

    const res = await fetch(postUrl, {
      method: 'POST',
      headers: headersFor(server),
      body: JSON.stringify(body),
      signal: ctl.signal
    });
    // 标准 SSE 传输会在原流上推回响应；也有服务直接在 POST 响应里返回
    const postText = await res.text();
    let msg = parseRpcResponse(postText, body.id);
    if (!msg) {
      // 再从流里等一小会儿
      const deadline = Date.now() + 8000;
      while (!msg && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        msg = parseRpcResponse(buf, body.id);
      }
    }
    try {
      reader.cancel();
    } catch (err) {
      /* ignore */
    }
    if (!msg) throw new AppError('mcp', 'MCP SSE 没有返回结果', '', '该服务可能只支持初始化后的推送。');
    if (msg.error) throw new AppError('mcp', `MCP 调用出错（${msg.error.code}）`, String(msg.error.message || ''), '');
    return msg.result;
  } finally {
    clearTimeout(timer);
    try {
      ctl.abort();
    } catch (err) {
      /* ignore */
    }
  }
}

async function rpc(server, method, params, opts = {}) {
  const body = { jsonrpc: '2.0', id: nextId(), method, params };
  if (String(server.transport || 'http').toLowerCase() === 'sse') return rpcSse(server, body, opts);
  return rpcFetch(server, body, opts);
}

// 通知（无 id、不需要响应）
async function notify(server, method, params) {
  const body = { jsonrpc: '2.0', method, params };
  try {
    const res = await timedFetch(
      String(server.url).trim(),
      { method: 'POST', headers: headersFor(server), body: JSON.stringify(body) },
      { timeoutMs: 10000, ctx: {} }
    );
    await res.text();
  } catch (err) {
    /* 通知失败不阻塞主流程 */
  }
}

// 连接一个 MCP 服务：握手 + 列出工具
export async function connectServer(server, opts = {}) {
  assertServer(server);
  const t = { transport: server.transport || 'http' };
  const init = await rpc(server, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {} },
    clientInfo: CLIENT_INFO
  }, { ...opts, ...t });
  await notify(server, 'notifications/initialized', {});
  const listed = await rpc(server, 'tools/list', {}, { ...opts, ...t });
  const tools = (Array.isArray(listed && listed.tools) ? listed.tools : []).map((x) => ({
    name: String(x.name || ''),
    description: String(x.description || ''),
    inputSchema: x.inputSchema || { type: 'object', properties: {} }
  }));
  return {
    server: { id: server.id, name: server.name || server.url, url: server.url },
    protocolVersion: init && init.protocolVersion,
    serverInfo: (init && init.serverInfo) || null,
    tools
  };
}

export async function listTools(server, opts = {}) {
  const listed = await rpc(server, 'tools/list', {}, opts);
  return (Array.isArray(listed && listed.tools) ? listed.tools : []).map((x) => ({
    name: String(x.name || ''),
    description: String(x.description || ''),
    inputSchema: x.inputSchema || { type: 'object', properties: {} }
  }));
}

export async function callTool(server, name, args, opts = {}) {
  const out = await rpc(server, 'tools/call', { name, arguments: args || {} }, opts);
  return out || {};
}

// 把 MCP 的 content 数组转成纯文本，喂给模型
export function toolResultToText(result) {
  if (!result) return '';
  const content = Array.isArray(result.content) ? result.content : [];
  const parts = [];
  for (const c of content) {
    if (!c) continue;
    if (c.type === 'text' && c.text) parts.push(String(c.text));
    else if (c.type === 'image') parts.push('[图片内容，已省略]');
    else if (c.type === 'resource' && c.resource) parts.push(String(c.resource.text || c.resource.uri || ''));
    else if (typeof c === 'string') parts.push(c);
  }
  if (!parts.length && typeof result === 'string') parts.push(result);
  return parts.join('\n').slice(0, 8000);
}

export { PROTOCOL_VERSION };
