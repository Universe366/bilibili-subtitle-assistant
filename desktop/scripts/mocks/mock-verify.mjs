// 总结核对链路 mock：一个 OpenAI 兼容端点（生成检索词 / 证据判定）+ 一个自定义检索端点。
// 用法：node scripts/mocks/mock-verify.mjs
// 然后：BSUB_VERIFY_TEST=1 npm run dev
import http from 'node:http';

const AI_PORT = Number(process.env.BSUB_MOCK_VERIFY_AI_PORT || 8888);
const SEARCH_PORT = Number(process.env.BSUB_MOCK_VERIFY_SEARCH_PORT || 8892);

const EVIDENCE = '测试视频在 2026 年发布，DeepSeek V4 参数量达到 6710 亿。';

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const search = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${SEARCH_PORT}`);
  if (url.pathname !== '/search') {
    return json(res, 404, { error: 'not found' });
  }
  const query = url.searchParams.get('q') || '';
  console.log('[mock-verify-search]', JSON.stringify({ query }));
  return json(res, 200, {
    results: [
      {
        title: `测试视频 2026 发布：${query}`.slice(0, 80),
        url: `https://example.com/${encodeURIComponent(query)}`,
        snippet: EVIDENCE
      }
    ]
  });
});

const ai = http.createServer((req, res) => {
  if (req.method !== 'POST' || !/\/chat\/completions$/.test(req.url || '')) {
    return json(res, 404, { error: 'not found' });
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
      return json(res, 400, { error: 'bad json' });
    }
    const system = String(body?.messages?.[0]?.content || '');
    let content = '## 模拟总结\n\n这是一份模拟总结。';
    if (system.includes('检索词生成助手')) {
      content = JSON.stringify(['测试视频 2026 年发布', 'DeepSeek V4 参数量']);
    } else if (system.includes('事实核查员')) {
      content = JSON.stringify({
        judgments: [{ id: 'E1', verdict: 'support', quote: '测试视频在 2026 年发布' }],
        supplements: ['外部资料确认测试视频于 2026 年发布。']
      });
    }
    console.log(
      '[mock-verify-ai]',
      JSON.stringify({ system: system.slice(0, 24), content: content.slice(0, 40) })
    );
    json(res, 200, {
      choices: [{ message: { role: 'assistant', content } }],
      model: 'mock-verify'
    });
  });
});

search.listen(SEARCH_PORT, '127.0.0.1', () =>
  console.log(`[mock-verify-search] http://127.0.0.1:${SEARCH_PORT}/search`)
);
ai.listen(AI_PORT, '127.0.0.1', () =>
  console.log(`[mock-verify-ai] http://127.0.0.1:${AI_PORT}/v1`)
);
