// 登录复测：扫码登录后，验证 1080p 播放、字幕抓取与内存。
// 登录态保存在 Electron 默认 userData 里，后续开发可直接复用。
import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BRIDGE_FILE = path.join(REPO, 'bilibili-subtitle-assistant/src/content/page-bridge.js');
const OUT = path.join(__dirname, 'report3.json');

const CHROME = process.versions.chrome;
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36 Edg/${CHROME}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[login]', ...a);

const out = { startedAt: new Date().toISOString(), steps: {}, errors: [] };
app.on('window-all-closed', () => {});

const HELPER = String.raw`
(() => {
  if (window.__spikeCall) return true;
  window.__spikeCall = (method, params = {}) => new Promise((resolve, reject) => {
    const id = 'lg_' + Math.random().toString(36).slice(2);
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

function mem(label) {
  const rows = app.getAppMetrics().map((m) => ({
    type: m.type,
    ws: Math.round(((m.memory && m.memory.workingSetSize) || 0) / 1024),
    priv: Math.round(((m.memory && m.memory.privateBytes) || 0) / 1024)
  })).sort((a, b) => b.ws - a.ws);
  const total = rows.reduce((n, r) => n + r.ws, 0);
  out.steps[label] = { total, private: rows.reduce((n, r) => n + r.priv, 0), rows };
  log(label, 'total', total, 'private', out.steps[label].private);
  return out.steps[label];
}

async function navState(wc) {
  try {
    return await wc.executeJavaScript(
      `fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' })
         .then(r => r.json())
         .then(j => ({ code: j.code, isLogin: !!(j.data && j.data.isLogin), uname: (j.data && j.data.uname) || '', vip: !!(j.data && j.data.vipStatus) }))
         .catch(e => ({ error: String(e) }))`,
      true
    );
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
}

app.whenReady().then(async () => {
  session.defaultSession.setUserAgent(UA);
  log('userData', app.getPath('userData'));

  const win = new BrowserWindow({
    width: 1080,
    height: 820,
    show: true,
    title: '请用 B 站 App 扫码登录（登录后自动继续）',
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  win.setAlwaysOnTop(true);
  win.show();
  win.focus();
  win.flashFrame(true);
  const wc = win.webContents;
  wc.setAudioMuted(true);

  await wc.loadURL('https://passport.bilibili.com/login');
  await sleep(1500);
  // 顶部提示条
  try {
    await wc.executeJavaScript(`(() => {
      if (document.getElementById('__bsub_login_tip')) return;
      const d = document.createElement('div');
      d.id = '__bsub_login_tip';
      d.textContent = '请用 B 站手机 App 扫码登录；成功后本窗口会自动继续验证，勿关闭。';
      d.style.cssText = 'position:fixed;z-index:2147483647;left:0;right:0;top:0;padding:10px 14px;background:#00a1d6;color:#fff;font:14px/1.5 system-ui;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.2)';
      document.documentElement.appendChild(d);
    })()`, true);
  } catch (e) { /* ignore */ }

  // 等扫码
  const t0 = Date.now();
  let nav = null;
  while (Date.now() - t0 < 180000) {
    nav = await navState(wc);
    if (nav && nav.isLogin) break;
    await sleep(2000);
  }
  out.steps.login = { ...nav, waitedMs: Date.now() - t0 };
  log('login', JSON.stringify(out.steps.login));
  win.setAlwaysOnTop(false);
  win.flashFrame(false);

  if (!nav || !nav.isLogin) {
    out.steps.result = 'not-logged-in';
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
    log('未检测到登录，退出。可重跑本脚本再扫一次。');
    win.destroy();
    app.exit(3);
    return;
  }

  // 注入桥，然后进视频页
  await wc.loadURL('about:blank');
  const bridge = fs.readFileSync(BRIDGE_FILE, 'utf8');
  wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Page.enable');
  await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: bridge });

  await wc.loadURL('https://www.bilibili.com/video/BV1xrnz6gEVD');
  await sleep(6000);
  mem('a_page_loaded');

  // 播放
  await wc.executeJavaScript(`(() => { const v = document.querySelector('video'); if (!v) return false; v.muted = true; const p = v.play(); if (p && p.catch) p.catch(() => {}); return true; })()`, true);
  await sleep(8000);
  mem('b_playing');

  const video = await wc.executeJavaScript(`(() => {
    const v = document.querySelector('video');
    return v ? { w: v.videoWidth, h: v.videoHeight, t: v.currentTime, paused: v.paused, rs: v.readyState } : null;
  })()`, true);
  out.steps.video = video;
  log('video', JSON.stringify(video));

  // 尝试切 1080P（B 站清晰度代码 80）
  try {
    const q = await wc.executeJavaScript(`(() => {
      const p = window.player;
      const before = p && typeof p.getQuality === 'function' ? p.getQuality() : null;
      let called = false;
      if (p && typeof p.setQuality === 'function') { try { p.setQuality(80); called = true; } catch (e) {} }
      return { hasPlayer: !!p, before, called };
    })()`, true);
    out.steps.qualityAttempt = q;
    log('quality attempt', JSON.stringify(q));
    await sleep(6000);
    const after = await wc.executeJavaScript(`(() => {
      const v = document.querySelector('video');
      const p = window.player;
      return { w: v && v.videoWidth, h: v && v.videoHeight, q: p && typeof p.getQuality === 'function' ? p.getQuality() : null };
    })()`, true);
    out.steps.videoAfterQuality = after;
    log('video after quality', JSON.stringify(after));
  } catch (e) {
    out.errors.push({ step: 'quality', error: String(e && e.message || e) });
  }

  // 字幕
  try {
    await wc.executeJavaScript(HELPER, true);
    const msg = await wc.executeJavaScript(`window.__spikeCall('getSubtitleBundle', {})`, true);
    const d = msg && msg.data;
    out.steps.subtitles = {
      rpcOk: msg && msg.ok,
      needLogin: d && d.needLogin,
      trackCount: d && (d.tracks || []).length,
      tracks: d && (d.tracks || []).map((t) => ({ lan: t.lan, source: t.source, lines: (t.lines || []).length, ai: t.isAi })),
      sources: d && d.sources,
      errors: d && d.errors,
      identity: d && d.identity && d.identity.signature
    };
    log('subtitles', JSON.stringify(out.steps.subtitles));
  } catch (e) {
    out.errors.push({ step: 'subtitles', error: String(e && e.message || e) });
    log('subtitles failed', String(e && e.message || e));
  }

  mem('c_after_subtitles');

  out.finishedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  log('report written', OUT);
  await sleep(1500);
  win.destroy();
  app.exit(0);
}).catch((e) => {
  out.errors.push({ step: 'run', error: String(e && e.stack || e) });
  try { fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8'); } catch (e2) {}
  log('FATAL', e && e.stack || e);
  app.exit(1);
});

setTimeout(() => {
  out.timedOut = true;
  try { fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8'); } catch (e) {}
  log('global timeout');
  app.exit(2);
}, 260000);
