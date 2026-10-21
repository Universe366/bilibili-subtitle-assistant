// 技术验证：Electron 内打开 B 站视频页，注入现有 page-bridge，验证
//   ① 页面/视频/弹幕能否正常工作
//   ② 注入桥能否读到字幕与播放器状态
//   ③ 空载与播放时的真实内存
//   ④ Electron 能否加载现有扩展（仅作参考，不作为依赖）
//
// 这不是产品代码，跑完即可丢弃；结果写到同目录 report.json。

import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const EXT_DIR = path.join(REPO, 'bilibili-subtitle-assistant');
const BRIDGE_FILE = path.join(EXT_DIR, 'src/content/page-bridge.js');
const REPORT_FILE = path.join(__dirname, 'report.json');

const CHROME = process.versions.chrome;
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36 Edg/${CHROME}`;

const report = {
  startedAt: new Date().toISOString(),
  versions: { electron: process.versions.electron, chrome: CHROME, node: process.versions.node },
  steps: {},
  errors: []
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mark(text) {
  console.log(`[spike] >>> ${text} @ ${new Date().toISOString().slice(11, 19)}`);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms))
  ]);
}

function note(step, data) {
  report.steps[step] = data;
  console.log(`[spike] ${step}:`, JSON.stringify(data).slice(0, 600));
}

function fail(step, err) {
  const msg = (err && err.stack) || String(err);
  report.errors.push({ step, error: msg });
  console.error(`[spike] ${step} FAILED:`, msg.split('\n')[0]);
}

function memSnapshot(label) {
  const metrics = app.getAppMetrics();
  const rows = metrics
    .map((m) => ({
      type: m.type,
      pid: m.pid,
      workingSetMB: Math.round((m.memory && m.memory.workingSetSize ? m.memory.workingSetSize : 0) / 1024),
      privateMB: Math.round((m.memory && m.memory.privateBytes ? m.memory.privateBytes : 0) / 1024)
    }))
    .sort((a, b) => b.workingSetMB - a.workingSetMB);
  const total = rows.reduce((n, r) => n + r.workingSetMB, 0);
  const data = { label, totalWorkingSetMB: total, processes: rows };
  console.log(`[spike] memory ${label}: total ${total}MB`, rows.map((r) => `${r.type}:${r.workingSetMB}`).join(' '));
  return data;
}

// 与 content.js 等价的宿主端调用器：写 content 通道，读 page 通道。
// 只用于验证，不进入产品。
const HELPER = String.raw`
(() => {
  if (window.__spikeCall) return true;
  window.__spikeCall = (method, params = {}) => new Promise((resolve, reject) => {
    const id = 'spike_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const t0 = Date.now();
    let written = false;
    const write = () => {
      const el = document.getElementById('__bsub_content_channel__');
      if (!el) return false;
      const seq = String((parseInt(el.getAttribute('data-seq') || '0', 10) || 0) + 1);
      el.textContent = JSON.stringify({ id, method, params });
      el.setAttribute('data-seq', seq);
      written = true;
      return true;
    };
    const tick = setInterval(() => {
      try {
        if (!written) write();
        const out = document.getElementById('__bsub_page_channel__');
        if (out) {
          const msg = JSON.parse(out.textContent || 'null');
          if (msg && msg.id === id) { clearInterval(tick); resolve(msg); return; }
        }
        if (Date.now() - t0 > 25000) { clearInterval(tick); reject(new Error('bridge timeout: ' + method)); }
      } catch (e) { /* ignore */ }
    }, 120);
  });
  return true;
})()
`;

async function fetchPopular() {
  const res = await fetch('https://api.bilibili.com/x/web-interface/popular?ps=5&pn=1', {
    headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/' },
    signal: AbortSignal.timeout(12000)
  });
  const json = await res.json();
  const list = (json && json.data && json.data.list) || [];
  if (!list.length) throw new Error(`popular API empty (code=${json && json.code})`);
  const v = list[0];
  return { bvid: v.bvid, title: v.title, duration: v.duration, source: 'popular-api' };
}

function waitLoad(wc, ms = 40000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('page load timeout')), ms);
    wc.once('did-finish-load', () => {
      clearTimeout(timer);
      resolve();
    });
    wc.once('did-fail-load', (_e, code, desc) => {
      clearTimeout(timer);
      reject(new Error(`did-fail-load ${code} ${desc}`));
    });
  });
}

async function run() {
  await app.whenReady();
  session.defaultSession.setUserAgent(UA);

  note('versions', report.versions);

  // 先量一次“空窗口”基线，尽量在导航前
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    title: 'bsub spike',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  win.webContents.setAudioMuted(true);
  win.show();
  win.focus();

  const wc = win.webContents;
  // 关键：先让 target 真正加载一次，再挂 CDP；否则 Page.enable 会一直不返回。
  mark('load about:blank');
  await withTimeout(wc.loadURL('about:blank'), 15000, 'about:blank');
  await sleep(1200);
  note('memoryIdle', memSnapshot('idle-empty-window'));

  // 注入 page-bridge（模拟扩展的 MAIN world content script）
  const bridgeCode = fs.readFileSync(BRIDGE_FILE, 'utf8');
  mark('attach debugger');
  try {
    wc.debugger.attach('1.3');
  } catch (err) {
    note('debuggerAttachError', String((err && err.message) || err));
  }
  mark('Page.enable');
  await withTimeout(wc.debugger.sendCommand('Page.enable'), 15000, 'Page.enable');
  mark('Page.addScriptToEvaluateOnNewDocument');
  const addScript = await withTimeout(
    wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: bridgeCode }),
    15000,
    'addScript'
  );
  note('inject', { ok: true, bytes: bridgeCode.length, identifier: addScript && addScript.identifier });

  // 选一个当前热门视频
  mark('pickPopular');
  let video = null;
  try {
    video = await fetchPopular();
  } catch (err) {
    fail('pickPopular', err);
  }

  const url = video ? `https://www.bilibili.com/video/${video.bvid}` : 'https://www.bilibili.com/';
  note('navigate', { url, video });

  const t0 = Date.now();
  mark('loadURL');
  try {
    await withTimeout(wc.loadURL(url), 45000, 'loadURL');
  } catch (err) {
    fail('loadURL', err);
  }
  mark('loaded, settling');
  await sleep(3500);
  note('load', { ms: Date.now() - t0, title: wc.getTitle(), url: wc.getURL() });

  // 装宿主端调用器
  mark('install helper');
  await withTimeout(wc.executeJavaScript(HELPER, true), 10000, 'helper');
  mark('helper installed');

  // ① 桥是否就绪
  try {
    const bridgeMeta = await wc.executeJavaScript(
      `(() => {
        const b = window.__BSUB_PAGE_BRIDGE__;
        return {
          present: !!b,
          version: b && b.version,
          methods: b && typeof b.supportedMethods === 'function' ? b.supportedMethods() : [],
          channels: {
            page: !!document.getElementById('__bsub_page_channel__'),
            content: !!document.getElementById('__bsub_content_channel__')
          },
          sniff: b && typeof b.sniffStatus === 'function' ? b.sniffStatus() : null
        };
      })()`,
      true
    );
    note('bridge', bridgeMeta);
  } catch (err) {
    fail('bridge', err);
  }

  // ② 页面身份 / 信息
  try {
    note('identity', await wc.executeJavaScript(`window.__spikeCall('identity')`, true));
  } catch (err) {
    fail('identity', err);
  }
  try {
    note('info', await wc.executeJavaScript(`window.__spikeCall('getInfo')`, true));
  } catch (err) {
    fail('info', err);
  }

  // ③ 视频状态 + 播放
  try {
    const before = await wc.executeJavaScript(
      `(() => {
        const v = document.querySelector('video');
        if (!v) return { found: false };
        return { found: true, paused: v.paused, readyState: v.readyState, duration: v.duration, w: v.videoWidth, h: v.videoHeight, t: v.currentTime };
      })()`,
      true
    );
    note('videoBefore', before);

    await wc.executeJavaScript(
      `(() => {
        const v = document.querySelector('video');
        if (!v) return false;
        v.muted = true;
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
        return true;
      })()`,
      true
    );
    await sleep(5000);
    const after = await wc.executeJavaScript(
      `(() => {
        const v = document.querySelector('video');
        if (!v) return { found: false };
        return { found: true, paused: v.paused, readyState: v.readyState, duration: v.duration, w: v.videoWidth, h: v.videoHeight, t: v.currentTime, buffered: v.buffered && v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0 };
      })()`,
      true
    );
    note('videoAfter', after);
    note('playback', {
      advanced: before.found && after.found ? +(after.t - before.t).toFixed(2) : null,
      playing: after.found ? !after.paused : false
    });
  } catch (err) {
    fail('video', err);
  }

  // ④ 弹幕 / 评论
  try {
    note(
      'danmaku',
      await wc.executeJavaScript(
        `({
          canvases: document.querySelectorAll('canvas').length,
          dmCanvas: document.querySelectorAll('canvas.bpx-player-dm-canvas, canvas[class*="danmaku"]').length,
          dmItems: document.querySelectorAll('[class*="danmaku-item"], .b-danmaku, .bpx-player-row-dm-wrap').length,
          comments: document.querySelectorAll('#commentapp, bili-comments, .reply-list').length,
          player: !!document.querySelector('.bpx-player-container, #bilibili-player')
        })`,
        true
      )
    );
  } catch (err) {
    fail('danmaku', err);
  }

  // ⑤ 登录态（本机 Electron 是独立会话，预期未登录）
  try {
    note(
      'login',
      await wc.executeJavaScript(
        `fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' })
           .then(r => r.json())
           .then(j => ({ code: j.code, isLogin: !!(j.data && j.data.isLogin), uname: (j.data && j.data.uname) || '' }))
           .catch(e => ({ error: String(e) }))`,
        true
      )
    );
  } catch (err) {
    fail('login', err);
  }

  // ⑥ 字幕（未登录时预期走到 need_login_subtitle 分支）
  try {
    const subs = await wc.executeJavaScript(`window.__spikeCall('getSubtitleBundle', {})`, true);
    const summary = {
      ok: subs && subs.ok,
      tracks: ((subs && subs.tracks) || []).map((t) => ({ lan: t.lan, source: t.source, lines: (t.lines || []).length, url: (t.url || '').slice(0, 80) })),
      groups: ((subs && subs.groups) || []).map((g) => ({ lan: g.lan, source: g.source, count: (g.tracks || []).length })),
      needLogin: subs && subs.needLogin,
      sources: subs && subs.sources,
      errors: subs && subs.errors,
      identity: subs && subs.identity && subs.identity.signature,
      identityMismatch: subs && subs.identityMismatch
    };
    note('subtitles', summary);
  } catch (err) {
    fail('subtitles', err);
  }

  // ⑦ 播放后内存
  note('memoryPlaying', memSnapshot('after-playback'));

  // ⑧ Electron 能否加载现有扩展（独立 session，避免污染本页）
  try {
    const extSession = session.fromPartition('persist:spike-ext');
    const ext = await extSession.loadExtension(EXT_DIR, { allowFileAccess: true });
    note('loadExtension', {
      ok: true,
      id: ext.id,
      name: ext.name,
      manifestVersion: ext.manifest && ext.manifest.manifest_version,
      hasBackground: !!(ext.manifest && ext.manifest.background)
    });
    try {
      extSession.removeExtension(ext.id);
    } catch (e) { /* ignore */ }
  } catch (err) {
    note('loadExtension', { ok: false, error: String((err && err.message) || err) });
  }

  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - t0;
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[spike] report written: ${REPORT_FILE}`);

  win.destroy();
  app.exit(0);
}

// 总超时保护
setTimeout(() => {
  try {
    report.finishedAt = new Date().toISOString();
    report.timedOut = true;
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
    console.error('[spike] global timeout, report written');
  } catch (e) { /* ignore */ }
  app.exit(2);
}, 150000);

run().catch((err) => {
  fail('run', err);
  try {
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
  } catch (e) { /* ignore */ }
  app.exit(1);
});
