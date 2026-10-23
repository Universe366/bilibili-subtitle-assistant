// 本地 mock ASR 服务，只用于验证桌面端转写链路。
import http from 'node:http';

const server = http.createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/v1/audio/transcriptions') {
    request.on('data', () => {
      // 消费 multipart，不解析
    });
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          text: '这是测试音频的转写结果。第二句话在这里。',
          segments: [
            { start: 0, end: 1, text: '这是测试音频的转写结果。' },
            { start: 1, end: 2, text: '第二句话在这里。' }
          ]
        })
      );
    });
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});

server.listen(8899, '127.0.0.1', () => {
  console.log('[mock-asr] listening http://127.0.0.1:8899/v1');
});
