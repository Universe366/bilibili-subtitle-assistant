// 本地 mock 章节服务：返回固定两章 JSON。
import http from 'node:http';

const server = http.createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/v1/chat/completions') {
    request.on('data', () => {
      // consume
    });
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  { start: 0, end: 3, title: '开场' },
                  { start: 3, end: 6, title: '测试章节' }
                ])
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

server.listen(8896, '127.0.0.1', () => {
  console.log('[mock-chapters] listening http://127.0.0.1:8896/v1');
});
