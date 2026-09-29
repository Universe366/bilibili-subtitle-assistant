// 在真实 Chrome 里用扩展的 audio.js 生成一段 M4A，把字节落到磁盘，
// 供 mp4-structure-test.mjs 做结构分析（fragmented MP4 vs 普通 MP4）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '..', 'bilibili-subtitle-assistant');
const PROFILE = path.join(process.env.TEMP || '/tmp', `cdp-samp-${Date.now()}`);
const PORT = 9777;
const HTTP_PORT = 9888;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.log('未找到浏览器，跳过');
  process.exit(0);
}

const SECONDS = Number(process.env.PROBE_SECONDS || 8);
const audioJs = fs.readFileSync(path.join(EXT, 'src/sidepanel/modules/audio.js'), 'utf8');
const bridgeJs = `export function call(){ return Promise.resolve({}); }`;
const constantsJs = `export const ASR_LIMITS = { overlapSeconds: 4, defaultTimeoutSeconds: 180 };`;

const html = `<!DOCTYPE html><html><body><pre id="out">run</pre><script type="module">
import { encodeSliceToM4a } from '/mod/audio.js';
window.__probe = async (seconds) => {
  const rate = 16000;
  const samples = new Float32Array(rate * seconds);
  for (let i = 0; i < samples.length; i++) {
    // 混合音，避免静音
    samples[i] = Math.sin(2 * Math.PI * 220 * i / rate) * 0.3 + Math.sin(2 * Math.PI * 440 * i / rate) * 0.15;
  }
  const m4a = await encodeSliceToM4a(samples, rate, 0, seconds, {});
  if (!m4a) return { error: 'no-bytes' };
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < m4a.length; i += CH) bin += String.fromCharCode.apply(null, m4a.subarray(i, i + CH));
  return { size: m4a.length, base64: btoa(bin) };
};
document.title = 'READY';
</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const send = (t, b) => {
    res.writeHead(200, { 'content-type': `${t}; charset=utf-8` });
    res.end(b);
  };
  if (url === '/' || url === '/index.html') return send('text/html', html);
  if (url === '/mod/audio.js') return send('text/javascript', audioJs);
  if (url === '/mod/bridge.js') return send('text/javascript', bridgeJs);
  if (url === '/shared/constants.js') return send('text/javascript', constantsJs);
  res.writeHead(404);
  res.end('nf');
});

const child = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank'
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (p) =>
  new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 5000 }, (res) => {
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

let ws = null;
let id = 0;
const pending = new Map();
const rpc = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => {
      if (pending.has(mid)) {
        pending.delete(mid);
        reject(new Error(`${method} timeout`));
      }
    }, 120000);
  });

async function main() {
  await new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', r));
  for (let i = 0; i < 40; i += 1) {
    try {
      await getJson('/json/version');
      break;
    } catch (e) {
      await sleep(400);
    }
  }
  const url = `http://127.0.0.1:${HTTP_PORT}/`;
  let target;
  try {
    target = await getJson(`/json/new?${url}`);
  } catch (e) {
    target = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: PORT, path: `/json/new?${url}`, method: 'PUT', timeout: 8000 },
        (res) => {
          let d = '';
          res.on('data', (c) => (d += c));
          res.on('end', () => resolve(JSON.parse(d)));
        }
      );
      req.on('error', reject);
      req.end();
    });
  }
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
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  await rpc('Runtime.enable');
  await sleep(2000);
  const res = await rpc('Runtime.evaluate', {
    expression: `window.__probe(${SECONDS})`,
    awaitPromise: true,
    returnByValue: true
  });
  return res && res.result && res.result.value;
}

main()
  .then((out) => {
    try {
      child.kill();
      server.close();
    } catch (e) {
      /* ignore */
    }
    if (!out || out.error) {
      console.error('生成失败:', JSON.stringify(out));
      process.exit(2);
    }
    const bytes = Buffer.from(out.base64, 'base64');
    const dest = path.join(__dirname, 'sample-mediarecorder.m4a');
    fs.writeFileSync(dest, bytes);
    console.log(`已写出 ${dest}（${bytes.length} 字节，来自 ${SECONDS}s 音频）`);
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
