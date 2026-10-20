// 在真实 Chrome 里验证 FFmpeg.wasm 封装（扩展的 ffmpeg.js 本体）：
//   1) 能加载 core（31MB）
//   2) 能把「原始音轨」remux 成普通 MP4（-c:a copy）
//   3) 产出结构与 MediaRecorder 的 fragmented MP4 不同（有 moov、无 moof）
//
// 输入用扩展自己下载到的 m4s 风格字节（这里用之前生成的 fMP4 样本冒充原始音轨，
// 因为 -c:a copy 只要求容器里是 AAC）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '..', 'bilibili-subtitle-assistant');
const PROFILE = path.join(process.env.TEMP || '/tmp', `cdp-ff-${Date.now()}`);
const PORT = 9999;
const HTTP_PORT = 9111;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.log('未找到浏览器，跳过');
  process.exit(0);
}

const ffmpegJs = fs.readFileSync(path.join(EXT, 'src/sidepanel/modules/ffmpeg.js'), 'utf8');
const coreJsPath = path.join(EXT, 'vendor/ffmpeg/ffmpeg-core.js');
const coreWasmPath = path.join(EXT, 'vendor/ffmpeg/ffmpeg-core.wasm');
if (!fs.existsSync(coreJsPath) || !fs.existsSync(coreWasmPath)) {
  console.log('未找到 vendor/ffmpeg 内核，跳过');
  process.exit(0);
}
const samplePath = path.join(__dirname, 'sample-mediarecorder.m4a');
if (!fs.existsSync(samplePath)) {
  console.log('缺少 sample-mediarecorder.m4a（先运行 tools/make-m4a-sample.mjs），跳过');
  process.exit(0);
}
const sampleB64 = fs.readFileSync(samplePath).toString('base64');

const html = `<!DOCTYPE html><html><body><pre id="out">run</pre><script type="module">
window.chrome = { runtime: { getURL: (r) => new URL('/' + r, location.href).href } };
import { remuxToMp4, openFfmpegSession, ffmpegAvailable } from '/mod/ffmpeg.js';
window.__err = '';
window.addEventListener('error', (e) => { window.__err += e.message + ' | '; });
window.addEventListener('unhandledrejection', (e) => { window.__err += String(e.reason && e.reason.message) + ' | '; });
window.__probe = async (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const notes = [];
  const t0 = performance.now();
  const out = await remuxToMp4(bytes, { inputName: 'in.m4s', outputName: 'out.m4a', onProgress: (m) => notes.push(m) });
  const ms = Math.round(performance.now() - t0);
  let ob = '';
  for (let i = 0; i < out.length; i += 0x8000) ob += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
  return { available: ffmpegAvailable(), notes, ms, size: out.length, base64: btoa(ob), inputSize: bytes.length };
};
// 多段重封装（回归：以前每段都调 remuxToMp4(rawBytes)，而 writeFile 会把
// ArrayBuffer transfer 给 Worker，第 2 段就报
// 「An ArrayBuffer is detached and could not be cloned」）
window.__multi = async (b64, segs) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const total = bytes.length;
  const s = await openFfmpegSession({});
  const sizes = [];
  const inputLenBefore = bytes.length;
  try {
    await s.writeInput(bytes);
    // ⚠ writeInput 之后 bytes 应当已 detached（这是预期行为）
    const inputLenAfter = bytes.length;
    for (let i = 0; i < segs; i += 1) {
      const out = await s.remuxSlice({ startSec: i * 1, durationSec: 1, outputName: 'o' + i + '.m4a' });
      sizes.push(out.length);
    }
    return { ok: true, segs, sizes, total, inputLenBefore, inputLenAfter };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), segs, sizes };
  } finally {
    await s.dispose();
  }
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
  if (url === '/mod/ffmpeg.js') return send('text/javascript', ffmpegJs);
  if (url.startsWith('/vendor/ffmpeg/')) {
    const rel = url.replace('/vendor/ffmpeg/', '');
    if (rel.includes('..') || rel.includes('/')) {
      res.writeHead(403);
      return res.end('no');
    }
    const file = path.join(EXT, 'vendor/ffmpeg', rel);
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      return res.end('nf');
    }
    const isWasm = rel.endsWith('.wasm');
    res.writeHead(200, { 'content-type': isWasm ? 'application/wasm' : 'text/javascript; charset=utf-8' });
    return res.end(fs.readFileSync(file));
  }
  res.writeHead(404);
  res.end('nf');
});

const child = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
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
    }, 180000);
  });

const results = [];
const check = (n, ok, extra = '') => results.push({ n, ok: !!ok, extra });

// ---- 与 mp4-structure-test 相同的 box 解析（内联一份，避免跨文件依赖）----
function findBoxes(buf, wanted) {
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf', 'edts']);
  const found = [];
  const walk = (start, end, level) => {
    let off = start;
    while (off + 8 <= end) {
      const size = buf.readUInt32BE(off);
      const type = buf.toString('latin1', off + 4, off + 8);
      if (size < 8) break;
      if (wanted.includes(type)) found.push({ type, level });
      if (CONTAINERS.has(type) && level < 6) walk(off + 8, off + size, level + 1);
      off += size;
    }
  };
  walk(0, buf.length, 0);
  return found;
}
function topLevel(buf) {
  const out = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    const size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (size < 8) break;
    out.push(type);
    off += size;
  }
  return out;
}

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
  await sleep(1500);
  const res = await rpc('Runtime.evaluate', {
    expression: `window.__probe(${JSON.stringify(sampleB64)})`,
    awaitPromise: true,
    returnByValue: true
  });
  if (res && res.exceptionDetails) {
    console.error('页面内异常:', JSON.stringify(res.exceptionDetails).slice(0, 500));
  }
  const value = res && res.result && res.result.value;
  // ---- 多段重封装（同一个页面会话里继续跑，Chrome 还没关）----
  let multi = null;
  try {
    const mres = await rpc('Runtime.evaluate', {
      expression: `window.__multi(${JSON.stringify(sampleB64)}, 3)`,
      awaitPromise: true,
      returnByValue: true
    });
    multi = mres && mres.result && mres.result.value;
  } catch (e) {
    multi = { ok: false, error: String((e && e.message) || e) };
  }
  return { value, multi };
}

main()
  .then(({ value: out, multi }) => {
    console.log('\n===== FFmpeg.wasm 重封装验证 =====');
    try {
      child.kill();
      server.close();
    } catch (e) {
      /* ignore */
    }
    if (!out) {
      console.error('无结果（页面可能报错）');
      process.exit(2);
    }
    console.log(JSON.stringify({ available: out.available, ms: out.ms, inputSize: out.inputSize, size: out.size, notes: out.notes }, null, 2));

    check('ffmpegAvailable() 为 true', out.available === true);
    check('重封装产出非空', out.size > 1000, String(out.size));
    if (out.base64) {
      const buf = Buffer.from(out.base64, 'base64');
      const top = topLevel(buf);
      const boxes = findBoxes(buf, ['moov', 'moof', 'mvex', 'ftyp']);
      const has = (t) => boxes.some((b) => b.type === t);
      console.log('顶层 box:', top.slice(0, 12).join(', '));
      check('产出是合法 MP4（含 ftyp）', has('ftyp') === true, top.slice(0, 6).join(','));
      check('产出是**普通** MP4（有 moov）', has('moov') === true, top.slice(0, 8).join(','));
      check('产出**不再是** fragmented（无 moof）', has('moof') === false, top.slice(0, 12).join(','));
      check('moov 在 mdat 之前（faststart）', top.indexOf('moov') >= 0 && top.indexOf('mdat') >= 0 && top.indexOf('moov') < top.indexOf('mdat'), top.slice(0, 8).join(','));
      fs.writeFileSync(path.join(__dirname, 'sample-ffmpeg.m4a'), buf);
      console.log('已写出 sample-ffmpeg.m4a');
    }

    // ---- 多段重封装（detached ArrayBuffer 回归）----
    //
    // 用户日志：第 1/13 片成功，之后报
    //   Failed to execute 'postMessage' on 'Worker':
    //   An ArrayBuffer is detached and could not be cloned.
    // 原因是每段都调 remuxToMp4(rawBytes)，而 writeFile 会把 ArrayBuffer
    // transfer 给 Worker —— 第 2 段拿到的就是 detached 的 buffer。
    // 现在改为「一个会话、输入只写一次」。
    console.log('\n===== 多段重封装（detached 回归）=====');
    console.log(JSON.stringify(multi, null, 2));
    check('多段重封装全部成功（不再 detached）', !!(multi && multi.ok === true), multi && multi.error);
    check('确实跑了 3 段', !!(multi && multi.segs === 3 && multi.sizes && multi.sizes.length === 3), multi && JSON.stringify(multi.sizes));
    check('每段都有产出', !!(multi && multi.sizes && multi.sizes.every((n) => n > 1000)), multi && JSON.stringify(multi.sizes));
    // writeInput 之后调用方那份应该已经 detached —— 这是**预期**行为，
    // 正因如此才要求「输入只写一次」。断言它，防止以后又有人循环复用同一份。
    check(
      'writeInput 会 detach 调用方 buffer（预期行为，故只能写一次）',
      !!(multi && multi.inputLenAfter === 0 && multi.inputLenBefore > 0),
      multi ? `${multi.inputLenBefore} -> ${multi.inputLenAfter}` : ''
    );
    let failed = 0;
    for (const r of results) {
      if (!r.ok) failed += 1;
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
    }
    console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
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
