// 第二轮：内存时间线 + 登录页 + 现有扩展在 Electron 内的注入情况
import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const EXT_DIR = path.join(REPO, 'bilibili-subtitle-assistant');
const BRIDGE_FILE = path.join(EXT_DIR, 'src/content/page-bridge.js');
const OUT = path.join(__dirname, 'report2.json');

const CHROME = process.versions.chrome;
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36 Edg/${CHROME}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r2]', ...a);

const out = { startedAt: new Date().toISOString(), steps: {} };

// 关键：没有窗口时 Electron 默认退出，会打断后续测试
app.on('window-all-closed', () => {});

function mem(label) {
  const rows = app.getAppMetrics().map((m) => ({
    type: m.type,
    pid: m.pid,
    ws: Math.round(((m.memory && m.memory.workingSetSize) || 0) / 1024),
    priv: Math.round(((m.memory && m.memory.privateBytes) || 0) / 1024)
  })).sort((a, b) => b.ws - a.ws);
  const total = rows.reduce((n, r) => n + r.ws, 0);
  const data = { total, rows };
  out.steps[label] = data;
  log(label, 'total', total, 'MB', rows.map((r) => `${r.type}:${r.ws}`).join(' '));
  return data;
}

async function makeWin(opts = {}) {
  const w = new BrowserWindow({
    width: 1280,
    height: 820,
    show: true,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, ...opts.webPreferences }
  });
  w.webContents.setAudioMuted(true);
  return w;
}

async function run() {
  await app.whenReady();
  session.defaultSession.setUserAgent(UA);

  // ---------- A. 视频页内存时间线 ----------
  const win = await makeWin();
  const wc = win.webContents;
  await wc.loadURL('about:blank');
  mem('a_blank');

  const bridge = fs.readFileSync(BRIDGE_FILE, 'utf8');
  wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Page.enable');
  await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: bridge });

  await wc.loadURL('https://www.bilibili.com/video/BV1xrnz6gEVD');
  // B 站会自动播放；先暂停，量“纯页面”基线
  await wc.executeJavaScript(`(() => { const v=document.querySelector('video'); if (v && !v.paused) v.pause(); return true; })()`, true);
  await sleep(5000);
  mem('b_loaded_paused');

  await wc.executeJavaScript(`(() => { const v=document.querySelector('video'); if(!v) return false; v.muted=true; const p=v.play(); if(p&&p.catch)p.catch(()=>{}); return true; })()`, true);
  await sleep(10000);
  mem('c_play10s');
  await sleep(15000);
  mem('d_play25s');

  const t = await wc.executeJavaScript(`(() => { const v=document.querySelector('video'); return v ? { t: v.currentTime, w: v.videoWidth, h: v.videoHeight, rs: v.readyState } : null; })()`, true);
  log('video', JSON.stringify(t));
  out.steps.video = t;

  // 停播 + 离开页面，看内存是否回落
  await wc.executeJavaScript(`(() => { const v=document.querySelector('video'); if(v) { v.pause(); v.removeAttribute('src'); v.load(); } return true; })()`, true);
  await sleep(2500);
  mem('e_paused');
  await wc.loadURL('about:blank');
  await sleep(12000);
  mem('f_blank_again');

  win.destroy();

  // ---------- B. 登录页二维码 ----------
  const loginWin = await makeWin({ width: 900, height: 760 });
  try {
    await loginWin.loadURL('https://passport.bilibili.com/login');
    await sleep(4500);
    const qr = await loginWin.webContents.executeJavaScript(`({
      title: document.title,
      url: location.href,
      qrImg: document.querySelectorAll('img[src*="qrcode"], .qrcode-img, canvas.qrcode').length,
      canvases: document.querySelectorAll('canvas').length,
      qrBox: document.querySelectorAll('.login-scan, .qrcode-box, [class*="qrcode"]').length
    })`, true);
    out.steps.loginPage = qr;
    log('loginPage', JSON.stringify(qr));
  } catch (e) {
    out.steps.loginPage = { error: String(e && e.message || e) };
  }
  loginWin.destroy();

  // ---------- C. 现有扩展在 Electron 内能否注入 ----------
  try {
    const extSession = session.fromPartition('persist:r2-ext');
    extSession.setUserAgent(UA);
    const ext = await extSession.extensions.loadExtension(EXT_DIR, { allowFileAccess: true });
    out.steps.extension = { loaded: true, id: ext.id, name: ext.name };
    const ew = new BrowserWindow({
      width: 1100, height: 760, show: true,
      webPreferences: { session: extSession, contextIsolation: true, sandbox: true, backgroundThrottling: false }
    });
    await ew.loadURL('https://www.bilibili.com/video/BV1xrnz6gEVD');
    await sleep(6000);
    const injected = await ew.webContents.executeJavaScript(`({
      bridge: !!window.__BSUB_PAGE_BRIDGE__,
      version: window.__BSUB_PAGE_BRIDGE__ && window.__BSUB_PAGE_BRIDGE__.version,
      pageChannel: !!document.getElementById('__bsub_page_channel__'),
      contentChannel: !!document.getElementById('__bsub_content_channel__'),
      overlay: !!document.getElementById('__bsub_overlay__')
    })`, true);
    out.steps.extension.injected = injected;
    log('extension injected', JSON.stringify(injected));
    ew.destroy();
    extSession.extensions.removeExtension(ext.id);
  } catch (e) {
    out.steps.extension = { loaded: false, error: String(e && e.message || e) };
    log('extension load/inject failed', String(e && e.message || e));
  }

  out.finishedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  log('report written', OUT);
  app.exit(0);
}

setTimeout(() => {
  out.timedOut = true;
  try { fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8'); } catch (e) {}
  log('global timeout');
  app.exit(2);
}, 150000);

app.whenReady().then(run).catch((e) => {
  log('FATAL', e && e.stack || e);
  try { fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8'); } catch (e2) {}
  app.exit(1);
});
