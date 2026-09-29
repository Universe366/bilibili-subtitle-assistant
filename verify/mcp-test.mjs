// MCP 客户端 + 工具调用循环的单元测试。
//
// 用本地 HTTP 服务模拟一个 MCP 服务端（JSON-RPC over HTTP），
// 验证：握手、tools/list、tools/call、结果转文本、
// 以及 tools.js 的多轮对话循环（含 OpenAI 与 Anthropic 两种形状）。
import http from 'node:http';

const results = [];
const check = (n, ok, extra = '') => results.push({ n, ok: !!ok, extra });

// ---------- 假的 MCP 服务端 ----------
const calls = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let msg = null;
    try {
      msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (err) {
      /* 通知可能没有 body */
    }
    res.setHeader('content-type', 'application/json');
    if (!msg || !msg.method) {
      res.end('{}');
      return;
    }
    calls.push(msg.method);
    if (msg.method === 'initialize') {
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'fake', version: '1' }, capabilities: { tools: {} } } }));
      return;
    }
    if (msg.method === 'notifications/initialized') {
      res.end('{}');
      return;
    }
    if (msg.method === 'tools/list') {
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: [
              { name: 'echo', description: '原样返回参数', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
              { name: 'boom', description: '总是失败', inputSchema: { type: 'object', properties: {} } }
            ]
          }
        })
      );
      return;
    }
    if (msg.method === 'tools/call') {
      const nm = msg.params && msg.params.name;
      if (nm === 'boom') {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: '工具内部错误' } }));
        return;
      }
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [
              { type: 'text', text: `echo:${(msg.params.arguments || {}).text || ''}` },
              { type: 'image', data: 'x' }
            ]
          }
        })
      );
      return;
    }
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } }));
  });
});

const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const URL_ = `http://127.0.0.1:${port}/mcp`;

const M = await import('../bilibili-subtitle-assistant/src/background/mcp.js');
const T = await import('../bilibili-subtitle-assistant/src/background/tools.js');

const server1 = { id: 's1', name: 'Fake', url: URL_, transport: 'http', token: 'sk-x' };

// ---------- 1. 握手 + 列工具 ----------
{
  const out = await M.connectServer(server1, { timeoutMs: 10000 });
  check('能完成 initialize 握手', !!out.protocolVersion, String(out.protocolVersion));
  check('读到了服务端信息', !!(out.serverInfo && out.serverInfo.name === 'fake'), JSON.stringify(out.serverInfo));
  check('列出 2 个工具', out.tools.length === 2, String(out.tools.length));
  check('工具带 inputSchema', !!(out.tools[0].inputSchema && out.tools[0].inputSchema.properties), JSON.stringify(out.tools[0].inputSchema));
  check('握手时发了 initialized 通知', calls.includes('notifications/initialized'), calls.join(','));
}

// ---------- 2. 调用工具 ----------
{
  const out = await M.callTool(server1, 'echo', { text: '你好' }, { timeoutMs: 10000 });
  check('tools/call 返回 content 数组', Array.isArray(out.content) && out.content.length === 2, JSON.stringify(out).slice(0, 120));
  const text = M.toolResultToText(out);
  check('文本内容被提取', /echo:你好/.test(text), text);
  check('图片内容被折叠而不是丢弃', /图片/.test(text), text);
}

// ---------- 3. 工具报错要如实抛出 ----------
{
  let err = null;
  try {
    await M.callTool(server1, 'boom', {}, { timeoutMs: 10000 });
  } catch (e) {
    err = e;
  }
  check('服务端返回的 JSON-RPC 错误会被抛出', !!err, String(err && err.message));
  check('错误里带上服务端原始消息', /工具内部错误/.test(String(err && err.detail)), String(err && err.detail));
}

// ---------- 4. 解析模型返回的工具调用（两种形状） ----------
{
  const openaiMsg = {
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'Fake__echo', arguments: '{"text":"hi"}' } }]
  };
  const a = T.extractToolCalls(openaiMsg);
  check('解析 OpenAI 风格 tool_calls', a.length === 1 && a[0].name === 'Fake__echo', JSON.stringify(a));
  check('解析字符串形式的 arguments', a[0].args && a[0].args.text === 'hi', JSON.stringify(a[0].args));

  const anthMsg = {
    role: 'assistant',
    content: [{ type: 'text', text: '让我查一下' }, { type: 'tool_use', id: 'tu_1', name: 'Fake__echo', input: { text: 'yo' } }]
  };
  const b = T.extractToolCalls(anthMsg);
  check('解析 Anthropic 风格 tool_use', b.length === 1 && b[0].name === 'Fake__echo', JSON.stringify(b));
  check('Anthropic 的 input 被当作参数', b[0].args && b[0].args.text === 'yo', JSON.stringify(b[0].args));

  check('普通文本消息不产生工具调用', T.extractToolCalls({ role: 'assistant', content: '你好' }).length === 0, '');
  check('容忍畸形 arguments', T.extractToolCalls({ tool_calls: [{ id: 'x', function: { name: 'n', arguments: 'not-json' } }] })[0].args && Object.keys(T.extractToolCalls({ tool_calls: [{ id: 'x', function: { name: 'n', arguments: 'not-json' } }] })[0].args).length === 0, '');
}

// ---------- 5. 多轮工具循环 ----------
{
  // 造一个假的 chat 函数（通过 opts.chatFn 注入）：第一轮返回工具调用，第二轮返回最终文本
  let round = 0;
  const seen = [];
  const chatFn = async (platform, messages, opts) => {
    seen.push({ round, hasTools: !!(opts && opts.tools && opts.tools.length), roles: messages.map((m) => m.role) });
    round += 1;
    if (round === 1) {
      const msg = { role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'Fake__echo', arguments: '{"text":"视频主题"}' } }] };
      return Object.assign('', { text: '', message: msg });
    }
    return Object.assign('这是最终回答', { text: '这是最终回答', message: { role: 'assistant', content: '这是最终回答' } });
  };
  const tools = [
    { qualifiedName: 'Fake__echo', name: 'echo', serverName: 'Fake', server: server1, description: 'e', inputSchema: { type: 'object', properties: {} } }
  ];
  const events = [];
  const out = await T.chatWithTools(
    { id: 'x', name: 'X', baseUrl: 'https://api.deepseek.com/v1', model: 'm', apiKey: 'k' },
    [{ role: 'user', content: 'hi' }],
    tools,
    { onToolEvent: (e) => events.push(e), toolTimeoutMs: 10000, chatFn }
  );
  check('第一轮把工具传给了模型', seen[0] && seen[0].hasTools === true, JSON.stringify(seen[0]));
  check('工具执行后追加了结果消息', seen[1] && seen[1].roles.includes('tool'), JSON.stringify(seen[1]));
  check('最终返回模型的收尾回答', out.text === '这是最终回答', out.text);
  check('记录了工具调用的开始与结束', events.some((e) => e.phase === 'start') && events.some((e) => e.phase === 'end'), JSON.stringify(events.map((e) => e.phase)));
  check('工具结果进入事件', events.some((e) => e.phase === 'end' && /echo:视频主题/.test(e.text || '')), JSON.stringify(events.filter((e) => e.phase === 'end').map((e) => e.text)));
}

// ---------- 6. 未知工具不崩，而是作为错误回填 ----------
{
  let n = 0;
  const chatFn = async () => {
    n += 1;
    if (n === 1) {
      return Object.assign('', { text: '', message: { role: 'assistant', tool_calls: [{ id: 'c', function: { name: 'NoSuch__tool', arguments: '{}' } }] } });
    }
    return Object.assign('ok', { text: 'ok', message: { content: 'ok' } });
  };
  const events = [];
  const out = await T.chatWithTools(
    { id: 'x', name: 'X', baseUrl: 'https://api.deepseek.com/v1', model: 'm', apiKey: 'k' },
    [{ role: 'user', content: 'hi' }],
    [],
    { onToolEvent: (e) => events.push(e), toolTimeoutMs: 5000, chatFn }
  );
  check('未知工具被记为失败而不是抛异常', events.some((e) => e.phase === 'end' && e.ok === false), JSON.stringify(events));
  check('未知工具后仍能拿到回答', out.text === 'ok', out.text);
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
}
console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
server.close();
// 直接 process.exit 会让 Node 在 Windows 上触发 libuv 断言；
// 先让事件循环空转一圈再退出。
server.closeAllConnections?.();
setTimeout(() => process.exit(failed ? 1 : 0), 60);
