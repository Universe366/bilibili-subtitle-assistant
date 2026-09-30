// 操作区布局回归体检（真实 Chrome）。
//
// 为什么需要：jsdom **不做布局**，所以「按钮太多把工具栏撑成 4 行」
// 这种事，测试套件完全看不出来（`textContent` 里有那个按钮就算通过）。
//
// 这个项目已经吃过一次亏：第六十九轮实测发现字幕就绪后操作区
// 有 7 个可见按钮，400px 宽下占 **3 行 / 113px**，接近侧边栏
// 可视高度的三分之一，把真正要看的字幕往下挤。
//
// 所以这里用真实 Chrome + 真实 panel.css 量一次：
//   - 操作区在常见侧边栏宽度下不超过 3 行
//   - 超长视频标题不许把操作区顶得更高（省略号截断要生效）
//
// 用的是**与面板同款的 CSS 与 DOM 结构**，不是简化的假页面。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(
  path.resolve(HERE, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'panel.css'),
  'utf8'
);

const results = [];
const errors = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok: !!ok, extra });
  if (!ok) errors.push(`${name}${extra ? ' -> ' + extra : ''}`);
};

// 与 panel-actions.js 里「字幕就绪」状态渲染出来的结构一致
const LONG_TITLE = '【超长标题压力测试】这是一个非常非常长的视频标题用来验证窄侧边栏下不会把工具栏撑成四行';
const barHtml = (title) => `
  <button class="btn btn-primary">③ 生成总结</button>
  <button class="btn">⚡ 快速总结</button>
  <button class="btn">去提问</button>
  <button class="btn">导出</button>
  <button class="btn btn-sm menu-trigger">⋯</button>
  <span class="pill" title="${title}"><span>${title} · 6:41</span></span>
  <span class="pill pill-brand"><span>240 行</span></span>
`;

const page = (title) => `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/panel.css"></head>
<body><div id="app"><div class="view">
<div class="actionbar" id="bar">${barHtml(title)}</div>
<div class="columns" style="height:300px"></div>
</div></div>
<script>
window.measure = () => {
  const bar = document.getElementById('bar');
  const r = bar.getBoundingClientRect();
  const tops = [...bar.children].map((el) => Math.round(el.getBoundingClientRect().top));
  return { h: Math.round(r.height), rows: new Set(tops).size, w: Math.round(r.width) };
};
</script></body></html>`;

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].find((p) => fs.existsSync(p));

if (!CHROME) {
  console.log('跳过：本机未找到 Chrome，无法做布局体检');
  process.exit(0);
}

const PORT = 9691;
const PROF = path.join(process.env.TEMP || '/tmp', 'bsub-layout');
fs.rmSync(PROF, { recursive: true, force: true });

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/panel.css')) {
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    res.end(CSS);
    return;
  }
  const longTitle = /long/.test(req.url);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page(longTitle ? LONG_TITLE : '测试视频'));
});
const webPort = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

const child = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${PROF}`, `--remote-debugging-port=${PORT}`, 'about:blank'],
  { stdio: 'ignore' }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (p) =>
  new Promise((resolve, reject) => {
    const rq = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 5000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(new Error('非 JSON'));
        }
      });
    });
    rq.on('error', reject);
  });

let ws = null;
let id = 0;
const pend = new Map();
const rpc = (m, p = {}, t = 30000) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pend.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method: m, params: p }));
    setTimeout(() => {
      if (pend.has(mid)) {
        pend.delete(mid);
        reject(new Error(m + ' timeout'));
      }
    }, t);
  });

try {
  for (let i = 0; i < 40; i++) {
    try {
      await getJson('/json/version');
      break;
    } catch (e) {
      await sleep(400);
    }
  }
  const list = await getJson('/json/list');
  const target = list.find((x) => x.type === 'page');
  ws = new globalThis.WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    let m;
    try {
      m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
    } catch (e) {
      return;
    }
    if (m.id && pend.has(m.id)) {
      const { resolve, reject } = pend.get(m.id);
      pend.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  await rpc('Page.enable');
  await rpc('Runtime.enable');

  const measureAt = async (suffix, width) => {
    await rpc('Page.navigate', { url: `http://127.0.0.1:${webPort}/${suffix}` });
    await sleep(450);
    await rpc('Runtime.evaluate', { expression: `document.getElementById('app').style.width='${width}px'` });
    const r = await rpc('Runtime.evaluate', { expression: 'JSON.stringify(measure())', returnByValue: true });
    return JSON.parse(r.result.value);
  };

  // 常见侧边栏宽度：Chrome 侧边栏默认约 400px，用户拖窄可到 300px
  // 300px 是极窄窗口（按钮本身就要 3 行），允许 4 行；360/420 要求 3 行
  for (const w of [300, 360, 420]) {
    const m = await measureAt('normal', w);
    const limit = w <= 300 ? 4 : 3;
    check(`操作区在 ${w}px 下不超过 ${limit} 行`, m.rows <= limit, `${m.rows} 行 / 高 ${m.h}px`);
  }
  // 超长标题不该让操作区更高
  const normal = await measureAt('normal', 360);
  const long = await measureAt('long', 360);
  check('超长视频标题不会撑高操作区', long.h <= normal.h + 4, `普通 ${normal.h}px vs 超长 ${long.h}px`);
  check('超长标题被省略号截断（不溢出）', long.w <= 360, `宽 ${long.w}px`);
} catch (err) {
  check('布局体检执行完成', false, String((err && err.message) || err));
} finally {
  try {
    child.kill();
  } catch (e) {
    /* ignore */
  }
  server.close();
}

console.log('\n===== 操作区布局体检（真实 Chrome）=====');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? '  -> ' + r.extra : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
