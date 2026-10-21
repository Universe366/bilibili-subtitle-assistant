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

function parseRpc(text: string, expectId: number): any {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
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
      if (parsed && (parsed.id === expectId || parsed.result || parsed.error)) return parsed;
    } catch {
      // ignore
    }
  }
  return null;
}

async function post(server: McpServer, body: unknown, timeoutMs = 40000): Promise<Response> {
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

async function rpc(server: McpServer, method: string, params: unknown, id: number): Promise<any> {
  const response = await post(server, {
    jsonrpc: '2.0',
    id,
    method,
    ...(params === undefined ? {} : { params })
  });
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

async function ensureSession(server: McpServer): Promise<void> {
  if (sessionIds.has(serverKey(server))) return;
  await rpc(server, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'bsub-desktop', version: '1.0.0' }
  }, nextId());
  try {
    await post(server, { jsonrpc: '2.0', method: 'notifications/initialized' });
  } catch {
    // 通知失败不影响后续调用
  }
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
  args: Record<string, unknown>
): Promise<string> {
  await ensureSession(server);
  const result = await rpc(server, 'tools/call', { name, arguments: args }, nextId());
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
