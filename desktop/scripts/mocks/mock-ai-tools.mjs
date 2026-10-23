// 本地 mock AI：先返回一次 tool_call，拿到工具结果后输出最终文本。
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
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const toolMessage = [...messages].reverse().find((message) => message.role === 'tool');
      const message = toolMessage
        ? { role: 'assistant', content: `工具返回：${toolMessage.content}` }
        : {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'mock__echo',
                  arguments: JSON.stringify({ text: 'hello' })
                }
              }
            ]
          };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message }] }));
    });
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});

server.listen(8894, '127.0.0.1', () => {
  console.log('[mock-ai-tools] listening http://127.0.0.1:8894/v1');
});
