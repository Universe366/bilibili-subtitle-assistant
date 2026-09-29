// 在真实 Chrome 里验证 M4A 编码（直接加载扩展的 audio.js 本体）。
// ES module 不能用 file:// 导入（会被 CORS 拦），所以起一个本地 HTTP 服务。
//
// 背景：硅基流动对 WAV 返回 500，参考实现 Bilitato 上传的是 .m4a（MP4/AAC）。
// 浏览器没有可用的 AAC 编码器（WebCodecs mp4a.40.2 不可用），
// 但 MediaRecorder 支持 audio/mp4;codecs=mp4a.40.2，代价是实时编码。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '..', 'bilibili-subtitle-assistant');
const PROFILE = path.join(process.env.TEMP || '/tmp', `cdp-m4a-${Date.now()}`);
const PORT = 9555;
const HTTP_PORT = 9666;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.log('未找到浏览器，跳过');
  process.exit(0);
}

const SECONDS = Number(process.env.PROBE_SECONDS || 6);
const audioJs = fs.readFileSync(path.join(EXT, 'src/sidepanel/modules/audio.js'), 'utf8');
const bridgeJs = `export function call(){ return Promise.resolve({}); }`;
const constantsJs = `export const ASR_LIMITS = { overlapSeconds: 4, defaultTimeoutSeconds: 180 };`;

const html = `<!DOCTYPE html><html><body><pre id="out">run</pre><script type="module">
import { canEncodeM4a, encodeSliceToM4a, sliceToWav, M4A_MIME } from '/mod/audio.js';
window.__err = '';
window.addEventListener('error', (e) => { window.__err += e.message + ' | '; });
window.addEventListener('unhandledrejection', (e) => { window.__err += String(e.reason && e.reason.message) + ' | '; });
window.__probe = async (seconds) => {
  const rate = 16000;
  const samples = new Float32Array(rate * seconds);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(2 * Math.PI * 330 * i / rate) * 0.35;
  const t0 = performance.now();
  const m4a = await encodeSliceToM4a(samples, rate, 0, seconds, {});
  const wallMs = Math.round(performance.now() - t0);
  const wav = sliceToWav(samples, rate, 0, seconds);
  const tag = m4a ? String.fromCharCode(m4a[4], m4a[5], m4a[6], m4a[7]) : '';
  const wavTag = String.fromCharCode(wav[0], wav[1], wav[2], wav[3]);
  const silence = new Float32Array(rate * 2);
  const silentM4a = await encodeSliceToM4a(silence, rate, 0, 2, {});
  return {
    canEncodeM4a: canEncodeM4a(), mime: M4A_MIME,
    m4aSize: m4a ? m4a.length : 0, m4aTag: tag, wallMs, seconds,
    wavSize: wav.length, wavTag,
    speed: (seconds * 1000 / Math.max(1, wallMs)).toFixed(2),
    silentOk: !!(silentM4a && silentM4a.length > 1000)
  };
};
document.title = 'READY';
</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const send = (type, body) => {
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
    res.end(body);
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

const results = [];
const check = (n, ok, extra = '') => results.push({ n, ok: !!ok, extra });

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
  const ready = await rpc('Runtime.evaluate', { expression: 'typeof window.__probe', returnByValue: true });
  if ((ready && ready.result && ready.result.value) !== 'function') {
    const errText = await rpc('Runtime.evaluate', { expression: 'String(window.__err)', returnByValue: true });
    console.error('模块未加载，页面报错:', (errText && errText.result && errText.result.value) || '(无)');
  }
  const res = await rpc('Runtime.evaluate', {
    expression: `window.__probe(${SECONDS})`,
    awaitPromise: true,
    returnByValue: true
  });
  if (res && res.exceptionDetails) console.error('页面内异常:', JSON.stringify(res.exceptionDetails).slice(0, 400));
  return res && res.result && res.result.value;
}

main()
  .then((out) => {
    console.log('\n===== 真实浏览器里的 M4A 编码（扩展代码本体）=====');
    console.log(JSON.stringify(out, null, 2));
    check('浏览器可用 MediaRecorder 编 M4A', out && out.canEncodeM4a === true);
    check('M4A 产出非空', out && out.m4aSize > 1000, String(out && out.m4aSize));
    check('M4A 是合法 MP4（ftyp）', out && out.m4aTag === 'ftyp', out && out.m4aTag);
    check('静音也能编出 M4A', out && out.silentOk === true, String(out && out.silentOk));
    check('WAV 分支仍正常（RIFF）', !!out && out.wavTag === 'RIFF' && out.wavSize > 1000, `${out && out.wavTag} ${out && out.wavSize}`);
    check('实时编码速度约 1x', out && Number(out.speed) > 0.6, `speed=${out && out.speed}x`);
    let failed = 0;
    for (const r of results) {
      if (!r.ok) failed += 1;
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
    }
    console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
    try {
      child.kill();
      server.close();
    } catch (e) {
      /* ignore */
    }
    process.exit(failed ? 1 : 0);
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
