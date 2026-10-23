// 本地 mock OpenAI 兼容服务，只用于验证流式总结链路。
import http from 'node:http';

const SUMMARY = `## 一句话总结
这是一次针对 iPhone Duo 折叠屏的极限测试，重点验证反复折叠后的折痕与屏幕耐久。

## 核心观点
- 折叠 1 万次后，折痕变化没有想象中明显
- 内屏的纳米纹理表层是耐久性的关键
- 折叠机构的寿命比屏幕本身更值得关注

## 章节脉络
- [0:00] 开场与测试目的
- [5:00] 折痕显微观察
- [12:00] 万次折叠测试
- [20:00] 结论与建议

## 关键细节
- 测试设备完成了 10000 次折叠
- 屏幕在显微视角下出现了细微纹理变化
- 日常使用中更需要注意的是铰链进灰

（本总结来自本地 mock 服务，仅用于开发验证。）`;

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
      console.log('[mock-ai] request', payload.model, 'stream=', payload.stream);
      const system = String(payload?.messages?.[0]?.content || '');
      const user = String(payload?.messages?.[1]?.content || '');
      console.log(
        '[mock-ai] prompt',
        JSON.stringify({
          formatRules: system.includes('输出风格'),
          skills: system.includes('可用技能'),
          systemLen: system.length,
          userLen: user.length
        })
      );

      if (!payload.stream) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content: SUMMARY } }] }));
        return;
      }

      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      });

      const chunks = SUMMARY.match(/[\s\S]{1,14}/g) || [];
      let index = 0;
      const timer = setInterval(() => {
        if (index >= chunks.length) {
          response.write('data: [DONE]\n\n');
          clearInterval(timer);
          response.end();
          return;
        }
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: chunks[index++] } }] })}\n\n`
        );
      }, 15);
    });
    return;
  }

  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'mock-summary' }] }));
    return;
  }

  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});

server.listen(8787, '127.0.0.1', () => {
  console.log('[mock-ai] listening http://127.0.0.1:8787/v1');
});
