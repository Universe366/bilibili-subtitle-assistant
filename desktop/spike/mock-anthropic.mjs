// Anthropic 原生协议 mock：用于验证桌面端 aiClient 的 /v1/messages 分支。
// 用法：node spike/mock-anthropic.mjs  然后 BSUB_ANTHROPIC_TEST=1 npm run dev
import http from 'node:http';

const PORT = Number(process.env.BSUB_MOCK_ANTHROPIC_PORT || 8891);

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sse(res, events) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  });
  for (const [event, data] of events) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
  res.end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    return sendJson(res, 200, {
      data: [{ id: 'claude-mock', display_name: 'Claude Mock' }],
      has_more: false
    });
  }

  if (req.method !== 'POST' || url.pathname !== '/v1/messages') {
    return sendJson(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'not found' } });
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return sendJson(res, 400, { type: 'error', error: { message: 'bad json' } });
    }

    // 记录关键请求形态，便于确认协议走对了。
    console.log(
      '[mock-anthropic]',
      JSON.stringify({
        model: body.model,
        stream: body.stream === true,
        system: Boolean(body.system),
        messages: Array.isArray(body.messages) ? body.messages.length : 0,
        tools: Array.isArray(body.tools) ? body.tools.map((tool) => tool.name) : [],
        max_tokens: body.max_tokens
      })
    );

    const text = '这是 Claude 模拟回答。';
    const hasToolResult = JSON.stringify(body.messages || []).includes('tool_result');

    if (Array.isArray(body.tools) && body.tools.length && !hasToolResult) {
      return sendJson(res, 200, {
        id: 'msg_mock_tool',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [
          {
            type: 'tool_use',
            id: 'toolu_mock_1',
            name: body.tools[0].name,
            input: { text: 'hello-from-anthropic' }
          }
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 }
      });
    }

    if (body.stream !== true) {
      return sendJson(res, 200, {
        id: 'msg_mock_1',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 8 }
      });
    }

    sse(res, [
      [
        'message_start',
        { type: 'message_start', message: { id: 'msg_mock_1', role: 'assistant', content: [] } }
      ],
      [
        'content_block_start',
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
      ],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '这是 ' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Claude 模拟回答。' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' } }],
      ['message_stop', { type: 'message_stop' }]
    ]);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-anthropic] listening on http://127.0.0.1:${PORT}/v1`);
});
