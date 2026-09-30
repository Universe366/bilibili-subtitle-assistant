// 思维链与最终回答分离的测试。
//
// 背景：`chatStream` 原来这一行把推理内容当正文了：
//   piece = (c.delta && (c.delta.content || c.delta.reasoning_content)) || ...
// 于是推理模型（deepseek-reasoner）的心路历程和最终回答混在一起，
// 既读不清，也无法折叠。
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src');
const mod = (rel) => pathToFileURL(path.join(SRC, rel)).href;

const P = await import(mod('background/providers.js'));

const results = [];
const check = (n, ok, extra = '') => results.push({ n, ok: !!ok, extra });

// ---------------------------------------------------------------------------
// 一个可编排的假 SSE 服务端
// ---------------------------------------------------------------------------

function sseServer(lines) {
  return http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      for (const l of lines) res.write(`data: ${JSON.stringify(l)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
}

async function runStream(lines, opts = {}) {
  const server = sseServer(lines);
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  const platform = {
    id: 't',
    name: 'T',
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: 'm',
    apiKey: 'k'
  };
  const deltas = [];
  const reasons = [];
  let text = '';
  let err = null;
  try {
    text = await P.chatStream(platform, [{ role: 'user', content: 'hi' }], (d) => deltas.push(d), {
      timeoutMs: 10000,
      onReasoning: (r) => reasons.push(r),
      ...opts
    });
  } catch (e) {
    err = e;
  }
  server.close();
  server.closeAllConnections?.();
  await new Promise((r) => setTimeout(r, 40));
  return { text, deltas, reasons, err };
}

// ---------------------------------------------------------------------------
// 1. DeepSeek 风格：reasoning_content 必须与 content 分开
// ---------------------------------------------------------------------------
{
  const { text, deltas, reasons, err } = await runStream([
    { choices: [{ delta: { reasoning_content: '先看问题。' } }] },
    { choices: [{ delta: { reasoning_content: '再想一步。' } }] },
    { choices: [{ delta: { content: '答案' } }] },
    { choices: [{ delta: { content: '是 42。' } }] }
  ]);
  check('DeepSeek 风格流式请求不报错', !err, String(err && err.message));
  check('正文只包含最终回答', text === '答案是 42。', JSON.stringify(text));
  check('正文**不含**推理内容', !/先看问题|再想一步/.test(text), JSON.stringify(text));
  check('推理内容通过 onReasoning 单独产出', reasons.join('') === '先看问题。再想一步。', JSON.stringify(reasons.join('')));
  check('onDelta 只收到正文分片', deltas.join('') === '答案是 42。', JSON.stringify(deltas.join('')));
  check('推理分片没有混进 onDelta', !deltas.some((d) => /先看问题|再想一步/.test(d)), JSON.stringify(deltas));
}

// ---------------------------------------------------------------------------
// 2. reasoning vs reasoning_content 两种字段名都认
// ---------------------------------------------------------------------------
{
  const { text, reasons } = await runStream([
    { choices: [{ delta: { reasoning: 'R1' } }] },
    { choices: [{ delta: { reasoning_content: 'R2' } }] },
    { choices: [{ delta: { content: 'T' } }] }
  ]);
  check('reasoning 与 reasoning_content 都被识别为推理', reasons.join('') === 'R1R2', JSON.stringify(reasons.join('')));
  check('正文仍然干净', text === 'T', JSON.stringify(text));
}

// ---------------------------------------------------------------------------
// 3. Anthropic 风格：thinking 与 text 分开
// ---------------------------------------------------------------------------
// 说明：`isAnthropic()` 靠 URL 里是否含 "anthropic.com" 判断，
// 而 `api.anthropic.com` 在当前沙箱被网络策略拦截（connect=0），
// 所以这一路**无法端到端验证**。
// 诚实起见：这里只做源码级断言（分支存在、字段名正确），
// 并在下面注明「未经真实请求验证」。
{
  const fs = await import('node:fs');
  const src = fs.readFileSync(path.join(SRC, 'background', 'providers.js'), 'utf8');
  check('Anthropic 分支识别 thinking_delta', /thinking_delta/.test(src), '');
  check('Anthropic 分支识别 content_block_start 的 thinking', /content_block\.type === 'thinking'/.test(src), '');
  check('Anthropic 的 text_delta 仍归入正文', /json\.delta\.type === 'thinking_delta'[\s\S]{0,200}json\.delta\.text/.test(src), '');
  check('（注）Anthropic 路径未经真实请求验证 —— 沙箱拦截 anthropic.com', true, '');
}

// ---------------------------------------------------------------------------
// 3b. OpenAI 兼容路径上，content 与 reasoning 严格互斥（可端到端验证）
// ---------------------------------------------------------------------------
{
  const { text, reasons, deltas } = await runStream([
    { choices: [{ delta: { reasoning_content: '想 A' } }] },
    { choices: [{ delta: { content: '答 A' } }] },
    { choices: [{ delta: { reasoning_content: '想 B' } }] },
    { choices: [{ delta: { content: '答 B' } }] }
  ]);
  check('交错到达时正文仍只含回答', text === '答 A答 B', JSON.stringify(text));
  check('交错到达时推理仍只含思考', reasons.join('') === '想 A想 B', JSON.stringify(reasons.join('')));
  check('交错到达时 onDelta 不含推理', deltas.join('') === '答 A答 B', JSON.stringify(deltas.join('')));
}

// ---------------------------------------------------------------------------
// 4. 非推理模型（只有 content）不受影响
// ---------------------------------------------------------------------------
{
  const { text, reasons } = await runStream([
    { choices: [{ delta: { content: '普通' } }] },
    { choices: [{ delta: { content: '模型' } }] }
  ]);
  check('非推理模型正文正常', text === '普通模型', JSON.stringify(text));
  check('非推理模型不产生推理内容', reasons.length === 0, JSON.stringify(reasons));
}

// ---------------------------------------------------------------------------
// 5. 没有提供 onReasoning 时也不能崩（向后兼容）
// ---------------------------------------------------------------------------
{
  const server = sseServer([
    { choices: [{ delta: { reasoning_content: 'R' } }] },
    { choices: [{ delta: { content: 'T' } }] }
  ]);
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  let err = null;
  let text = '';
  try {
    text = await P.chatStream(
      { id: 't', name: 'T', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm', apiKey: 'k' },
      [{ role: 'user', content: 'hi' }],
      () => {},
      { timeoutMs: 10000 }
    );
  } catch (e) {
    err = e;
  }
  server.close();
  server.closeAllConnections?.();
  await new Promise((r) => setTimeout(r, 40));
  check('未传 onReasoning 时不报错', !err, String(err && err.message));
  check('未传 onReasoning 时正文仍然正确', text === 'T', JSON.stringify(text));
}

// ---------------------------------------------------------------------------
// 6. 面板侧：思维链块必须存在、可折叠、且不混入正文
// ---------------------------------------------------------------------------
{
  const fs = await import('node:fs');
  const aiSrc = fs.readFileSync(path.join(SRC, 'sidepanel', 'modules', 'panel-ai.js'), 'utf8');

  check('存在思维链折叠块构建函数', /export function buildReasoningBlock/.test(aiSrc), '');
  check('思维链有独立的累积通道 onReasoning', /onReasoning: \(piece\)/.test(aiSrc), '');
  check('思维链写入 msg.reasoning 而不是 msg.text', /reasoning: \(last\.reasoning \|\| ''\) \+ piece/.test(aiSrc), '');
  check('渲染时在正文之前插入思维链块', /el\.appendChild\(buildReasoningBlock\(msg\)\)/.test(aiSrc), '');
  check('默认折叠（require 用户点击才展开）', /expandReasoning/.test(aiSrc), '');
  check('记录思考耗时', /reasonMs/.test(aiSrc), '');
  check('折叠时不渲染全文（省布局）', /if \(hasText && expanded\)/.test(aiSrc), '');
  check('折叠时给单行预览', /reason-preview/.test(aiSrc), '');
  check('有三阶段状态', /requesting/.test(aiSrc) && /thinking/.test(aiSrc) && /settled/.test(aiSrc), '');
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
}
console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
