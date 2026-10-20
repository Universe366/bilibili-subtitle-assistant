// 让**真实 Chrome 扩展的 service worker** 把 multipart 请求发到一个本地抓包服务，
// 从而看到扩展实际发出的头部与 body 结构。
//
// 这是唯一能回答「扩展到底发了什么」的办法 —— 之前的实验全是「外部复刻」，
// 而问题恰恰只在扩展真实运行时出现。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const HTTP_PORT = 9911;
const CDP_PORT = 9922;
const PROFILE = path.join(process.env.TEMP || '/tmp', `swcap-${Date.now()}`);
const EXT = path.join(process.env.TEMP || '/tmp', 'sw-cap-ext');

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.log('未找到 Chrome，跳过');
  process.exit(0);
}

// ---------- 抓包服务：记录头部 + 看 body 是否为合法 multipart ----------
const captured = [];
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*'
    });
    return res.end();
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const ct = String(req.headers['content-type'] || '');
    const m = /boundary=(.+)$/.exec(ct);
    let boundaryFound = false;
    let parts = [];
    if (m) {
      const b = m[1].trim().replace(/^"|"$/g, '');
      const text = body.toString('latin1');
      boundaryFound = text.includes(`--${b}`);
      parts = text.split(`--${b}`).length - 1;
    }
    captured.push({
      url: req.url,
      method: req.method,
      contentType: ct,
      hasBoundary: !!m,
      boundaryFound,
      parts,
      bodyBytes: body.length,
      authHeader: req.headers.authorization ? 'present' : 'MISSING',
      allHeaders: Object.keys(req.headers).sort().join(', ')
    });
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true }));
  });
});

// ---------- 测试扩展：在 service worker 里用与扩展相同的方式发 multipart ----------
fs.rmSync(EXT, { recursive: true, force: true });
fs.mkdirSync(EXT, { recursive: true });
fs.writeFileSync(
  path.join(EXT, 'manifest.json'),
  JSON.stringify(
    {
      manifest_version: 3,
      name: 'sw-capture',
      version: '1.0.0',
      background: { service_worker: 'bg.js', type: 'module' },
      host_permissions: [`http://127.0.0.1:${HTTP_PORT}/*`]
    },
    null,
    2
  )
);
fs.writeFileSync(
  path.join(EXT, 'bg.js'),
  `
const ENDPOINT = 'http://127.0.0.1:${HTTP_PORT}/v1/audio/transcriptions';

// 完全复刻扩展的 authOnlyHeaders：只带 authorization
function authOnly() { return { authorization: 'Bearer test-key' }; }

async function run() {
  const out = [];
  const rate = 16000, secs = 5, n = rate * secs;
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0,'RIFF'); dv.setUint32(4, 36 + n*2, true); ws(8,'WAVE'); ws(12,'fmt ');
  dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,1,true);
  dv.setUint32(24,rate,true); dv.setUint32(28,rate*2,true); dv.setUint16(32,2,true); dv.setUint16(34,16,true);
  ws(36,'data'); dv.setUint32(40, n*2, true);
  const u8 = new Uint8Array(buf);

  // A) 只用 authorization（修复后的做法）
  {
    const fd = new FormData();
    fd.append('file', new File([u8], 'slice-001.wav', { type: 'audio/wav' }), 'slice-001.wav');
    fd.append('model', 'XingChenAGI/XingChenGSR-V1.0');
    const res = await fetch(ENDPOINT, { method: 'POST', headers: authOnly(), body: fd });
    out.push({ case: 'A 只带 authorization', status: res.status });
  }
  // B) 复刻旧 bug：额外带 content-type: application/json
  {
    const fd = new FormData();
    fd.append('file', new File([u8], 'slice-001.wav', { type: 'audio/wav' }), 'slice-001.wav');
    fd.append('model', 'XingChenAGI/XingChenGSR-V1.0');
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { ...authOnly(), 'content-type': 'application/json' }, body: fd });
    out.push({ case: 'B 旧 bug：带 application/json', status: res.status });
  }
  return out;
}

chrome.runtime.onMessage.addListener((m, s, sendResponse) => {
  if (m !== 'run') return false;
  run().then((out) => sendResponse({ out })).catch((e) => sendResponse({ error: String(e && e.message || e) }));
  return true;
});
`
);

const child = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--load-extension=${EXT}`,
    `--disable-extensions-except=${EXT}`,
    'about:blank'
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (p) =>
  new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: CDP_PORT, path: p, timeout: 5000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });

async function main() {
  await new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', r));
  let sw = null;
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await getJson('/json/list');
      sw = list.find((t) => t.type === 'service_worker' && String(t.url).includes('chrome-extension://'));
      if (sw) break;
    } catch (e) {
      /* retry */
    }
    await sleep(500);
  }
  if (!sw) {
    console.log('没有找到扩展 service worker 目标');
    return null;
  }
  console.log('已连接:', sw.url);

  const ws = new globalThis.WebSocket(sw.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    let m;
    try {
      m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
    } catch (e) {
      return;
    }
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  const rpc = (method, params = {}, t = 60000) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
      setTimeout(() => {
        if (pending.has(mid)) {
          pending.delete(mid);
          reject(new Error(`${method} timeout`));
        }
      }, t);
    });

  await rpc('Runtime.enable');
  // 直接在 service worker 里求值（比消息传递更直接）
  const res = await rpc('Runtime.evaluate', {
    expression: `(async () => { ${fs.readFileSync(path.join(EXT, 'bg.js'), 'utf8').replace(/chrome\.runtime\.onMessage[\s\S]*$/, '')} return await run(); })()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (res && res.exceptionDetails) console.error('异常:', JSON.stringify(res.exceptionDetails).slice(0, 400));
  return res && res.result && res.result.value;
}

main()
  .then((out) => {
    console.log('\n===== service worker 实际发出的请求 =====');
    console.log(JSON.stringify(captured, null, 2));
    console.log('\n执行结果:', JSON.stringify(out, null, 2));
    try {
      child.kill();
      server.close();
    } catch (e) {
      /* ignore */
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('失败:', err && err.message);
    try {
      child.kill();
      server.close();
    } catch (e) {
      /* ignore */
    }
    process.exit(2);
  });
