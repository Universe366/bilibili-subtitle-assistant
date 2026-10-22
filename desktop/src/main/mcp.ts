import { session } from 'electron';
import type { McpServer, McpTool } from '../shared/types';

const PROTOCOL_VERSION = '2024-11-05';
const sessionIds = new Map<string, string>();
let seq = 0;
const nextId = () => ++seq;

function serverKey(server: McpServer): string {
  return `${server.id}|${server.url}`;
}

function headersFor(server: McpServer): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json'
  };
  const token = String(server.token || '').trim();
  if (token) headers.authorization = /^bearer\s/i.test(token) ? token : `Bearer ${token}`;
  for (const [key, value] of Object.entries(server.headers || {})) {
    if (key && value) headers[key] = String(value);
  }
  const sessionId = sessionIds.get(serverKey(server));
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return headers;
}

function parseRpc(text: string, expectId: number | null): any {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (expectId == null) return parsed;
      if (Array.isArray(parsed)) {
        return parsed.find((item) => item && item.id === expectId) || parsed[0];
      }
      return parsed;
    } catch {
      // 继续按 SSE 解析
    }
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const match = /^data:\s*(.*)$/.exec(line);
    if (!match || !match[1]) continue;
    try {
      const parsed = JSON.parse(match[1]);
      if (expectId == null || (parsed && (parsed.id === expectId || parsed.result || parsed.error))) {
        return parsed;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

async function postHttp(server: McpServer, body: unknown, timeoutMs = 40000): Promise<Response> {
  if (!server.url.trim()) throw new Error('MCP 服务地址为空');
  const response = await session.defaultSession.fetch(server.url.trim(), {
    method: 'POST',
    headers: headersFor(server),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const sessionId = response.headers.get('mcp-session-id');
  if (sessionId) sessionIds.set(serverKey(server), sessionId);
  return response;
}

async function rpcHttp(
  server: McpServer,
  method: string,
  params: unknown,
  id: number,
  timeoutMs = 40000
): Promise<any> {
  const response = await postHttp(
    server,
    {
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params })
    },
    timeoutMs
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`MCP 服务返回 HTTP ${response.status}：${text.slice(0, 200)}`);
  }
  const message = parseRpc(text, id);
  if (!message) throw new Error('MCP 响应无法解析');
  if (message.error) {
    throw new Error(`MCP 调用出错（${message.error.code ?? '?'}）：${message.error.message || ''}`);
  }
  return message.result;
}

interface SseEvent {
  event: string;
  data: string;
}

async function rpcSse(
  server: McpServer,
  body: { jsonrpc: string; id?: number; method: string; params?: unknown },
  expectId: number | null,
  timeoutMs = 40000
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await session.defaultSession.fetch(server.url.trim(), {
      method: 'GET',
      headers: { ...headersFor(server), accept: 'text/event-stream' },
      signal: controller.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`MCP SSE 连接失败（HTTP ${response.status}）`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const nextEvent = async (): Promise<SseEvent | null> => {
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary >= 0) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          let event = 'message';
          const data: string[] = [];
          for (const line of raw.split(/\r?\n/)) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
          }
          if (data.length) return { event, data: data.join('\n') };
          continue;
        }
        const { value, done } = await reader.read();
        if (done) return null;
        buffer += decoder.decode(value, { stream: true });
      }
    };

    let endpoint = '';
    for (let index = 0; index < 20; index += 1) {
      const event = await nextEvent();
      if (!event) break;
      const value = event.data.trim();
      if (event.event === 'endpoint' || /^(\/|https?:)/i.test(value)) {
        endpoint = value;
        break;
      }
    }
    if (!endpoint) throw new Error('MCP SSE 没有返回 endpoint');

    const target = new URL(endpoint, server.url.trim()).toString();
    const posted = await session.defaultSession.fetch(target, {
      method: 'POST',
      headers: headersFor(server),
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await posted.text();
    if (!posted.ok && posted.status !== 202) {
      throw new Error(`MCP SSE 消息提交失败（HTTP ${posted.status}）：${text.slice(0, 200)}`);
    }

    if (expectId == null) return null;

    let message = parseRpc(text, expectId);
    while (!message) {
      const event = await nextEvent();
      if (!event) break;
      if (event.event === 'message') message = parseRpc(event.data, expectId);
    }
    if (!message) throw new Error('MCP SSE 响应无法解析');
    if (message.error) {
      throw new Error(`MCP 调用出错（${message.error.code ?? '?'}）：${message.error.message || ''}`);
    }
    return message.result;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function rpc(
  server: McpServer,
  method: string,
  params: unknown,
  id: number,
  timeoutMs = 40000
): Promise<any> {
  if (server.transport === 'sse') {
    return rpcSse(server, { jsonrpc: '2.0', id, method, params }, id, timeoutMs);
  }
  return rpcHttp(server, method, params, id, timeoutMs);
}

async function notifyInitialized(server: McpServer): Promise<void> {
  try {
    if (server.transport === 'sse') {
      await rpcSse(server, { jsonrpc: '2.0', method: 'notifications/initialized' }, null, 10000);
    } else {
      await postHttp(server, { jsonrpc: '2.0', method: 'notifications/initialized' });
    }
  } catch {
    // 通知失败不影响后续调用
  }
}

async function ensureSession(server: McpServer): Promise<void> {
  if (sessionIds.has(serverKey(server))) return;
  await rpc(server, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'bsub-desktop', version: '1.0.0' }
  }, nextId());
  await notifyInitialized(server);
}

export async function listMcpTools(server: McpServer): Promise<McpTool[]> {
  await ensureSession(server);
  const result = await rpc(server, 'tools/list', {}, nextId());
  const rows = Array.isArray(result?.tools) ? result.tools : [];
  return rows
    .filter((item: any) => item && item.name)
    .map((item: any) => ({
      name: String(item.name),
      description: String(item.description || ''),
      inputSchema: item.inputSchema || item.input_schema
    }));
}

export async function callMcpTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 40000
): Promise<string> {
  await ensureSession(server);
  const result = await rpc(
    server,
    'tools/call',
    { name, arguments: args },
    nextId(),
    timeoutMs
  );
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content
    .map((item: any) => {
      if (item?.type === 'text') return String(item.text || '');
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    })
    .filter(Boolean)
    .join('\n');
  return text || JSON.stringify(result, null, 2);
}

export function resetMcpSession(server: McpServer): void {
  sessionIds.delete(serverKey(server));
}
