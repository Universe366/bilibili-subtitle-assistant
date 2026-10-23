// 本地 mock MCP SSE 服务：GET /sse 返回 endpoint，POST /messages 回写结果。
import http from 'node:http';

let client = null;

function send(payload) {
  if (!client) return;
  client.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1:8893');

  if (request.method === 'GET' && url.pathname === '/sse') {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    });
    response.write('event: endpoint\ndata: /messages?session=1\n\n');
    client = response;
    request.on('close', () => {
      if (client === response) client = null;
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/messages') {
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
      response.writeHead(202);
      response.end('accepted');

      const method = String(payload.method || '');
      if (method === 'initialize') {
        send({
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-sse', version: '1.0.0' }
          }
        });
        return;
      }
      if (method === 'tools/list') {
        send({
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            tools: [{ name: 'echo', description: 'SSE 回显', inputSchema: { type: 'object' } }]
          }
        });
        return;
      }
      if (method === 'tools/call') {
        send({
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            content: [
              { type: 'text', text: `sse: ${String(payload.params?.arguments?.text || '')}` }
            ]
          }
        });
      }
    });
    return;
  }

  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});

server.listen(8893, '127.0.0.1', () => {
  console.log('[mock-mcp-sse] listening http://127.0.0.1:8893/sse');
});
