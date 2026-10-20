// 生成扩展图标（定稿方案）。
//
// 设计依据：先做了 zi / cc / bar 三种方案在 16/32/64/128 下的对比（见 icon-compare.mjs），
// 结论是**纯图形方案在 16×16 下最可辨识** —— 中文笔画（「字」）在 16px 会糊成一团，
// 而三条字幕条不会。故定稿用「字幕条」图形。
//
// 视觉：
//   · 圆角方正底 + B 站粉渐变（#FB7299 → #E85C86）→ 一眼认出是 B 站相关
//   · 三条白色横条，自上而下变短、变淡 → 就是「字幕」的图形语言，且与语言无关
//   · 顶部高光 → 小尺寸下也有体积感
//
// 输出：icons/icon16.png / 32 / 48 / 128
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', '..', 'bilibili-subtitle-assistant', 'icons');
const TMP = path.join(process.env.TEMP || '/tmp', 'bsub-icon-gen');
const SIZES = [16, 32, 48, 128];
const MASTER = 1024;

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const chrome = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => fs.existsSync(p));
if (!chrome) {
  console.error('未找到 Chrome/Edge，无法渲染图标');
  process.exit(2);
}

const html = `<!DOCTYPE html><html><body><script>
window.__draw = (size) => {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  const S = size, pad = S * 0.055, r = S * 0.235;
  const rr = (x, y, w, h, rad) => {
    g.beginPath();
    g.moveTo(x + rad, y);
    g.arcTo(x + w, y, x + w, y + h, rad);
    g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad);
    g.arcTo(x, y, x + w, y, rad);
    g.closePath();
  };

  // 底：B 站粉渐变
  const grad = g.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, '#FB7299');
  grad.addColorStop(1, '#E85C86');
  g.fillStyle = grad;
  rr(pad, pad, S - pad * 2, S - pad * 2, r);
  g.fill();

  // 顶部高光
  const hl = g.createLinearGradient(0, pad, 0, S * 0.55);
  hl.addColorStop(0, 'rgba(255,255,255,0.20)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl;
  rr(pad, pad, S - pad * 2, S * 0.5, r);
  g.fill();

  // 小尺寸简化：16px 只画两条（三条在 16px 会糊成一团 —— 实测对比得出）
  const small = S <= 20;
  const bars = small
    ? [
        { w: 0.62, y: 0.26, h: 0.150, o: 1.00 },
        { w: 0.40, y: 0.58, h: 0.150, o: 0.85 }
      ]
    : [
        { w: 0.60, y: 0.285, h: 0.105, o: 1.00 },
        { w: 0.60, y: 0.475, h: 0.105, o: 1.00 },
        { w: 0.34, y: 0.665, h: 0.105, o: 0.70 }
      ];
  for (const b of bars) {
    g.fillStyle = 'rgba(255,255,255,' + b.o + ')';
    const bw = S * b.w, bh = S * b.h;
    rr(S * 0.5 - bw / 2, S * b.y, bw, bh, bh / 2);
    g.fill();
  }
  return c.toDataURL('image/png');
};
document.title = 'READY';
</script></body></html>`;

const htmlPath = path.join(TMP, 'i.html');
fs.writeFileSync(htmlPath, html, 'utf8');

const PORT = 9478;
const PROFILE = path.join(TMP, 'prof');
fs.rmSync(PROFILE, { recursive: true, force: true });
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });

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
          reject(new Error(`非 JSON（${d.slice(0, 60)}）`));
        }
      });
    });
    req.on('error', reject);
  });

let ws = null, id = 0;
const pending = new Map();
const rpc = (method, params = {}, t = 60000) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); reject(new Error(`${method} timeout`)); } }, t);
  });

async function main() {
  for (let i = 0; i < 40; i += 1) { try { await getJson('/json/version'); break; } catch (e) { await sleep(400); } }
  const url = `file:///${htmlPath.replace(/\\/g, '/')}`;
  let target;
  try {
    target = await getJson(`/json/new?${url}`);
  } catch (e) {
    target = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: PORT, path: `/json/new?${url}`, method: 'PUT', timeout: 8000, headers: { accept: 'application/json' } },
        (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (err) { reject(err); } }); }
      );
      req.on('error', reject); req.end();
    });
  }
  ws = new globalThis.WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (e) { return; }
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
  });
  await rpc('Runtime.enable');
  await sleep(1200);

  // 渲染策略：
  //   · 尺寸 > 20 时，先画 1024 主图再高质量降采样（边缘更干净）
  //   · 尺寸 <= 20 时，直接按目标尺寸绘制 —— 因为 16px 用了简化的两条布局，
  //     若从主图缩放会把三条糊在一起（这是对比实验得出的结论）
  const master = await rpc('Runtime.evaluate', { expression: `window.__draw(${MASTER})`, returnByValue: true });
  const masterUrl = master && master.result && master.result.value;
  if (!masterUrl) throw new Error('主图渲染失败');

  const made = [];
  for (const size of SIZES) {
    const expr =
      size <= 20
        ? `window.__draw(${size})`
        : `(async () => {
            const img = new Image();
            img.src = ${JSON.stringify(masterUrl)};
            await img.decode();
            const c = document.createElement('canvas');
            c.width = ${size}; c.height = ${size};
            const g = c.getContext('2d');
            g.imageSmoothingEnabled = true;
            g.imageSmoothingQuality = 'high';
            g.drawImage(img, 0, 0, ${size}, ${size});
            return c.toDataURL('image/png');
          })()`;
    const r = await rpc('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const bytes = Buffer.from(String(r.result.value).split(',')[1], 'base64');
    const file = path.join(OUT, `icon${size}.png`);
    fs.writeFileSync(file, bytes);
    made.push({ size, bytes: bytes.length, file, direct: size <= 20 });
  }
  return made;
}

main()
  .then((made) => {
    try { child.kill(); } catch (e) {}
    console.log('图标已生成（bar 方案）：');
    for (const m of made) console.log(`  ${String(m.size).padStart(3)}×${String(m.size).padEnd(3)} ${String(m.bytes).padStart(6)} 字节  ${path.basename(m.file)}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('生成失败:', err && err.message);
    try { child.kill(); } catch (e) {}
    process.exit(2);
  });
