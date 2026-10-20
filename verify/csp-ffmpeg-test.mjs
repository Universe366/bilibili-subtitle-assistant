// 验证「与扩展页完全相同的 CSP」下，FFmpeg 模块能否跑通。
//
// 背景：Chrome 禁止 MV3 扩展页 CSP 在 script-src / worker-src 里出现 blob:，
// 所以两者都只能是 'self'。这个测试用 HTTP 提供与扩展一致的目录结构与 CSP 头，
// 并 stub 掉 chrome.runtime.getURL（返回同源相对地址），
// 从而在**同源的 script-src 'self' / worker-src 'self'** 约束下验证：
//   · ffmpeg-api.js 能否被 import（不用 blob）
//   · Worker 能否从同源地址创建
//   · worker 能否动态 import core 并完成 remux
//
// 这不能替代「真实扩展加载」，但能在同样 CSP 语义下验证失败模式。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '..', 'bilibili-subtitle-assistant');
const PROFILE = path.join(process.env.TEMP || '/tmp', `cdp-csp-${Date.now()}`);
const PORT = 9333;
const HTTP_PORT = 9444;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.log('未找到 Chrome，跳过');
  process.exit(0);
}
if (!fs.existsSync(path.join(EXT, 'vendor', 'ffmpeg', 'ffmpeg-core.wasm'))) {
  console.log('未找到 vendor/ffmpeg，跳过');
  process.exit(0);
}

// 与 manifest 里的 extension_pages CSP 保持一致
const CSP = process.env.TEST_CSP || "script-src 'self'; object-src 'self'; worker-src 'self'; img-src 'self' data: blob: https:; connect-src 'self' https: http:";

const loaderJs = fs.readFileSync(path.join(EXT, 'src/sidepanel/modules/ffmpeg.js'), 'utf8');
// 用扩展自己的解码器反向校验重封装产物，确认「发出去的字节是有效音频」
const audioJs = fs.readFileSync(path.join(EXT, 'src/sidepanel/modules/audio.js'), 'utf8');

const results = [];
const check = (n, ok, extra = '') => results.push({ n, ok: !!ok, extra });

// 注意：页面里不能写内联 <script>（script-src 'self' 会拦掉，和真实扩展页一样），
// 所以这里的探测脚本也必须作为**外部文件**提供。
const probeJs = `
window.chrome = { runtime: { getURL: (rel) => new URL(rel, location.href).href } };
window.__err = '';
window.addEventListener('error', (e) => { window.__err += e.message + ' | '; });
window.addEventListener('unhandledrejection', (e) => { window.__err += String(e.reason && (e.reason.message || e.reason)) + ' | '; });
window.__run = async (b64) => {
  const notes = [];
  let mod;

  try {
    mod = await import('/src/sidepanel/modules/ffmpeg.js');
  } catch (e) {
    return { stage: 'import-module', error: String(e && e.message || e), notes, pageErr: window.__err };
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const t0 = performance.now();
  try {
    const out = await mod.remuxToMp4(bytes, { inputName: 'in.m4s', outputName: 'out.m4a', onProgress: (m) => notes.push(m) });
    const head = String.fromCharCode(out[4], out[5], out[6], out[7]);
    // 反向校验：用扩展自己的解码器解重封装产物。
    // 若能解出完整时长且电平非零，说明「发出去的字节是有效音频」。
    let decoded = null;
    let decodeError = null;
    try {
      const audio = await import('/src/sidepanel/modules/audio.js');
      const buf = await audio.decodeAudioBytes(out, {});
      const ch = buf.getChannelData(0);
      let peak = 0;
      let sum = 0;
      const step = Math.max(1, Math.floor(ch.length / 200000));
      let n = 0;
      for (let i = 0; i < ch.length; i += step) {
        const a = Math.abs(ch[i]);
        if (a > peak) peak = a;
        sum += a * a;
        n++;
      }
      decoded = {
        duration: Number(buf.duration.toFixed(2)),
        sampleRate: buf.sampleRate,
        channels: buf.numberOfChannels,
        peak: Number(peak.toFixed(4)),
        rms: Number(Math.sqrt(sum / Math.max(1, n)).toFixed(4))
      };
    } catch (e) {
      decodeError = String(e && e.message || e);
    }

    // 反向校验 WAV 路径：把 16kHz 单声道 PCM 用扩展自己的 sliceToWav 编成 WAV，
    // 再用扩展自己的解码器解回来，确认头部与采样数据都正确。
    let wavRoundTrip = null;
    let wavError = null;
    try {
      const audio = await import('/src/sidepanel/modules/audio.js');
      const rate = 16000;
      const secs = 3;
      const samples = new Float32Array(rate * secs);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.4;
      const wavBytes = audio.sliceToWav(samples, rate, 0, secs);
      const back = await audio.decodeAudioBytes(wavBytes, {});
      const ch = back.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
      wavRoundTrip = {
        bytes: wavBytes.length,
        riff: String.fromCharCode(wavBytes[0], wavBytes[1], wavBytes[2], wavBytes[3]),
        wave: String.fromCharCode(wavBytes[8], wavBytes[9], wavBytes[10], wavBytes[11]),
        duration: Number(back.duration.toFixed(2)),
        sampleRate: back.sampleRate,
        channels: back.numberOfChannels,
        peak: Number(peak.toFixed(3))
      };
    } catch (e) {
      wavError = String(e && e.message || e);
    }
    return { ok: true, ms: Math.round(performance.now() - t0), size: out.length, head, notes, decoded, decodeError, wavRoundTrip, wavError, pageErr: window.__err };
  } catch (e) {
    return { stage: 'remux', error: String(e && e.message || e), notes, pageErr: window.__err };
  }
};
document.title = 'READY';
`;

const html = `<!DOCTYPE html><html><body><pre id="out">run</pre><script type="module" src="/probe.js"></script></body></html>`;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  // 所有响应都带上与扩展一致的 CSP
  const common = { 'content-security-policy': CSP };
  const send = (type, body) => {
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, ...common });
    res.end(body);
  };
  if (url === '/' || url === '/index.html') return send('text/html', html);
  if (url === '/probe.js') return send('text/javascript', probeJs);
  if (url === '/src/sidepanel/modules/ffmpeg.js') return send('text/javascript', loaderJs);
  if (url === '/src/sidepanel/modules/audio.js') return send('text/javascript', audioJs);
  if (url === '/src/sidepanel/modules/bridge.js') return send('text/javascript', 'export function call(){ return Promise.resolve({}); }');
  if (url === '/src/shared/constants.js') return send('text/javascript', 'export const ASR_LIMITS = { overlapSeconds: 4, defaultTimeoutSeconds: 180, targetRate: 16000 };');
  if (url.startsWith('/vendor/ffmpeg/')) {
    const rel = url.replace('/vendor/ffmpeg/', '');
    if (rel.includes('..') || rel.includes('/')) {
      res.writeHead(403, common);
      return res.end('no');
    }
    const file = path.join(EXT, 'vendor/ffmpeg', rel);
    if (!fs.existsSync(file)) {
      res.writeHead(404, common);
      return res.end('nf');
    }
    const isWasm = rel.endsWith('.wasm');
    res.writeHead(200, { 'content-type': isWasm ? 'application/wasm' : 'text/javascript; charset=utf-8', ...common });
    return res.end(fs.readFileSync(file));
  }
  res.writeHead(404, common);
  res.end('nf');
});

// 用来喂给 remux 的输入：一段 fMP4（含 AAC）。
// 直接复用 make-m4a-sample 的产物；没有就临时生成一个最小 fMP4 也行。
const samplePath = path.join(__dirname, 'sample-mediarecorder.m4a');
let sampleB64 = '';
if (fs.existsSync(samplePath)) {
  sampleB64 = fs.readFileSync(samplePath).toString('base64');
} else {
  console.log('缺少 sample-mediarecorder.m4a（先运行 node tools/make-m4a-sample.mjs），跳过');
  process.exit(0);
}

const child = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, 'about:blank'],
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
const rpc = (method, params = {}, t = 180000) =>
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
  await sleep(1800);
  const res = await rpc('Runtime.evaluate', {
    expression: `window.__run(${JSON.stringify(sampleB64)})`,
    awaitPromise: true,
    returnByValue: true
  });
  if (res && res.exceptionDetails) console.error('页面内异常:', JSON.stringify(res.exceptionDetails).slice(0, 500));
  return res && res.result && res.result.value;
}

main()
  .then((out) => {
    console.log('\n===== 与扩展一致的 CSP 下的 FFmpeg 验证 =====');
    console.log('CSP:', CSP);
    console.log(JSON.stringify(out, null, 2));
    check('模块可被 import（未用 blob）', out && out.stage !== 'import-module', (out && out.error) || '');
    check('worker 能在 script-src/worker-src \'self\' 下创建并完成 remux', !!(out && out.ok), (out && out.error) || '');
    check('产出是普通 MP4（ftyp）', !!(out && out.head === 'ftyp'), (out && out.head) || '');
    check('页面无未捕获错误（无 CSP 违规）', !(out && out.pageErr), (out && out.pageErr) || '');
    // 反向校验：产出的音频必须能被完整解码且不是静音
    check(
      '重封装产物可被扩展解码器完整解码',
      !!(out && out.decoded && out.decoded.duration > 1),
      (out && out.decodeError) || JSON.stringify(out && out.decoded)
    );
    check(
      '解码出的音频不是静音（peak > 0.05）',
      !!(out && out.decoded && out.decoded.peak > 0.05),
      JSON.stringify(out && out.decoded)
    );
    check(
      'WAV 路径可被扩展解码器解回（RIFF/WAVE 头正确）',
      !!(out && out.wavRoundTrip && out.wavRoundTrip.riff === 'RIFF' && out.wavRoundTrip.wave === 'WAVE'),
      (out && out.wavError) || JSON.stringify(out && out.wavRoundTrip)
    );
    check(
      'WAV 往返后时长与声道正确（16kHz 单声道，解码器输出 48kHz）',
      !!(out && out.wavRoundTrip && Math.abs(out.wavRoundTrip.duration - 3) < 0.2 && out.wavRoundTrip.channels === 1),
      JSON.stringify(out && out.wavRoundTrip)
    );
    check(
      'WAV 往返后音频非静音且幅度正确',
      !!(out && out.wavRoundTrip && out.wavRoundTrip.peak > 0.35 && out.wavRoundTrip.peak <= 0.45),
      JSON.stringify(out && out.wavRoundTrip)
    );
    if (out && out.decoded) console.log('解码校验:', JSON.stringify(out.decoded));
    if (out && out.wavRoundTrip) console.log('WAV 往返校验:', JSON.stringify(out.wavRoundTrip));
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
