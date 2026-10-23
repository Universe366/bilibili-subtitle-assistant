// 验证登录后的字幕正文可下载（跨域由主进程 fetch，不走页面 CORS）
import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BRIDGE_FILE = path.join(REPO, 'shizi-extension/src/content/page-bridge.js');
const CHROME = process.versions.chrome;
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36 Edg/${CHROME}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[sub]', ...a);
app.on('window-all-closed', () => {});

const HELPER = String.raw`
(() => {
  if (window.__spikeCall) return true;
  window.__spikeCall = (method, params = {}) => new Promise((resolve, reject) => {
    const id = 'sb_' + Math.random().toString(36).slice(2);
    const t0 = Date.now();
    let written = false;
    const write = () => {
      const el = document.getElementById('__bsub_content_channel__');
      if (!el) return false;
      el.textContent = JSON.stringify({ id, method, params });
      el.setAttribute('data-seq', String((parseInt(el.getAttribute('data-seq') || '0', 10) || 0) + 1));
      written = true;
      return true;
    };
    const tick = setInterval(() => {
      if (!written) write();
      const o = document.getElementById('__bsub_page_channel__');
      if (o) { try { const m = JSON.parse(o.textContent || 'null'); if (m && m.id === id) { clearInterval(tick); resolve(m); } } catch (e) {} }
      if (Date.now() - t0 > 30000) { clearInterval(tick); reject(new Error('timeout')); }
    }, 120);
  });
  return true;
})()
`;

app.whenReady().then(async () => {
  session.defaultSession.setUserAgent(UA);
  const win = new BrowserWindow({ width: 1100, height: 760, show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  const wc = win.webContents;
  wc.setAudioMuted(true);
  await wc.loadURL('about:blank');
  wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Page.enable');
  await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(BRIDGE_FILE, 'utf8') });
  await wc.loadURL('https://www.bilibili.com/video/BV1xrnz6gEVD');
  await sleep(5000);

  const nav = await wc.executeJavaScript(`fetch('https://api.bilibili.com/x/web-interface/nav',{credentials:'include'}).then(r=>r.json()).then(j=>({isLogin:!!(j.data&&j.data.isLogin),uname:(j.data&&j.data.uname)||''}))`, true);
  log('nav', JSON.stringify(nav));

  await wc.executeJavaScript(HELPER, true);
  const msg = await wc.executeJavaScript(`window.__spikeCall('getSubtitleBundle', {})`, true);
  const d = msg && msg.data;
  const tracks = (d && d.tracks) || [];
  log('needLogin', d && d.needLogin, 'tracks', tracks.length);
  const picked = tracks.map((t) => ({ lan: t.lan, url: t.url, source: t.source, ai: t.isAi }));
  log('track urls', JSON.stringify(picked.map((t) => ({ lan: t.lan, url: (t.url || '').slice(0, 90) }))));

  const first = tracks.find((t) => t.url);
  if (!first) {
    log('NO_TRACK_URL');
    win.destroy();
    app.exit(4);
    return;
  }

  const url = first.url.startsWith('//') ? 'https:' + first.url : first.url;
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/' }, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch (e) {}
    const lines = (body && body.body) || [];
    log('fetch status', res.status, 'bytes', text.length, 'lines', lines.length);
    log('first line', JSON.stringify(lines[0] || null));
    log('last line', JSON.stringify(lines[lines.length - 1] || null));
    fs.writeFileSync(path.join(__dirname, 'subtitle-sample.json'), JSON.stringify({ url, status: res.status, count: lines.length, first: lines[0], last: lines[lines.length - 1] }, null, 2), 'utf8');
  } catch (e) {
    log('fetch failed', String(e && e.message || e));
  }

  win.destroy();
  app.exit(0);
}).catch((e) => { log('FATAL', e && e.stack || e); app.exit(1); });

setTimeout(() => { log('TIMEOUT'); app.exit(2); }, 90000);
