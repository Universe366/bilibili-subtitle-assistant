import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BRIDGE_FILE = path.join(REPO, 'bilibili-subtitle-assistant/src/content/page-bridge.js');
const CHROME = process.versions.chrome;
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36 Edg/${CHROME}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HELPER = String.raw`
(() => {
  if (window.__spikeCall) return true;
  window.__spikeCall = (method, params = {}) => new Promise((resolve, reject) => {
    const id = 'sp_' + Math.random().toString(36).slice(2);
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
      const out = document.getElementById('__bsub_page_channel__');
      if (out) {
        try {
          const m = JSON.parse(out.textContent || 'null');
          if (m && m.id === id) { clearInterval(tick); resolve(m); }
        } catch (e) {}
      }
      if (Date.now() - t0 > 30000) { clearInterval(tick); reject(new Error('timeout')); }
    }, 120);
  });
  return true;
})()
`;

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  session.defaultSession.setUserAgent(UA);
  const win = new BrowserWindow({ width: 1100, height: 760, show: true, webPreferences: { contextIsolation: true, sandbox: true } });
  const wc = win.webContents;
  wc.setAudioMuted(true);
  await wc.loadURL('about:blank');
  wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Page.enable');
  const bridge = fs.readFileSync(BRIDGE_FILE, 'utf8');
  await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: bridge });

  await wc.loadURL('https://www.bilibili.com/video/BV1xrnz6gEVD');
  await sleep(5000);
  await wc.executeJavaScript(HELPER, true);

  const msg = await wc.executeJavaScript(`window.__spikeCall('getSubtitleBundle', {})`, true);
  const data = msg && msg.data;
  const out = {
    rpcOk: msg && msg.ok,
    needLogin: data && data.needLogin,
    trackCount: data && (data.tracks || []).length,
    sources: data && data.sources,
    errors: data && data.errors,
    groups: data && data.groups,
    sniffCount: data && data.sniffCount,
    identity: data && data.identity && data.identity.signature,
    tracks: data && (data.tracks || []).map((t) => ({ lan: t.lan, source: t.source, lines: (t.lines || []).length }))
  };
  console.log('SUBTITLE_DATA ' + JSON.stringify(out));

  const subs = await wc.executeJavaScript(`window.__spikeCall('getSubtitles', {})`, true);
  const d2 = subs && subs.data;
  console.log('GETSUBS ' + JSON.stringify({
    rpcOk: subs && subs.ok,
    needLogin: d2 && d2.needLogin,
    count: d2 && ((d2.tracks || d2.subtitles || []).length),
    sources: d2 && d2.sources,
    errors: d2 && d2.errors,
    keys: d2 && Object.keys(d2)
  }));

  app.exit(0);
}).catch((e) => { console.log('FATAL', e && e.stack || e); app.exit(1); });

setTimeout(() => { console.log('TIMEOUT'); app.exit(2); }, 80000);
