// 本地 mock MCP 服务（HTTP JSON-RPC），用于验证 initialize / tools/list / tools/call。
import http from 'node:http';

const server = http.createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/mcp') {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
    return;
  }
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    let payload = {};
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      // ignore
    }
    const method = String(payload.method || '');
    if (method === 'initialize') {
      response.writeHead(200, {
        'content-type': 'application/json',
        'mcp-session-id': 'mock-session'
      });
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-mcp', version: '1.0.0' }
          }
        })
      );
      return;
    }
    if (method === 'notifications/initialized') {
      response.writeHead(202);
      response.end();
      return;
    }
    if (method === 'tools/list') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            tools: [
              {
                name: 'echo',
                description: '回显输入文本',
                inputSchema: {
                  type: 'object',
                  properties: { text: { type: 'string' } },
                  required: ['text']
                }
              }
            ]
          }
        })
      );
      return;
    }
    if (method === 'tools/call') {
      const args = payload.params?.arguments || {};
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            content: [{ type: 'text', text: `echo: ${String(args.text || '')}` }]
          }
        })
      );
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: payload.id,
        error: { code: -32601, message: `unknown method ${method}` }
      })
    );
  });
});

server.listen(8895, '127.0.0.1', () => {
  console.log('[mock-mcp] listening http://127.0.0.1:8895/mcp');
});
