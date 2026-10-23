// 本地 mock 翻译服务：把输入行加「译：」前缀，返回 JSON。
import http from 'node:http';

const server = http.createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/v1/chat/completions') {
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
      const user = Array.isArray(payload.messages)
        ? payload.messages.filter((message) => message.role === 'user').pop()
        : null;
      const content = String((user && user.content) || '');
      const lines = content
        .split(/\r?\n/)
        .filter((line) => /^\s*\d+\.\s+/.test(line))
        .map((line) => line.replace(/^\s*\d+\.\s*/, '').trim())
        .filter(Boolean);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ lines: lines.map((line) => `译：${line}`) })
              }
            }
          ]
        })
      );
    });
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});

server.listen(8898, '127.0.0.1', () => {
  console.log('[mock-translate] listening http://127.0.0.1:8898/v1');
});
