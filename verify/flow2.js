// 端到端流程测试（重写版）：打开视频 → 抓字幕 → 总结 → 提问 → 导出，全链路真实数据。
// 与旧版区别：后台 RPC 桩直接调用被测模块（panel-actions / context / subtitles），
// 不再依赖 window.eval 字符串，避免转义问题。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', 'bilibili-subtitle-assistant');
const BUNDLE = path.join(__dirname, 'build', 'panel.iife.js');
const results = [];
const errors = [];
const rpcLog = [];
const check = (name, ok, extra = '') => results.push({ name, ok: !!ok, extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIDEO = {
  ok: true,
  kind: 'video',
  bvid: 'BV1xx411c7mD',
  aid: 123456,
  cid: 999001,
  page: 2,
  partTitle: 'P2 正片',
  parts: [
    { index: 1, cid: 999000, title: 'P1 开场', duration: 600 },
    { index: 2, cid: 999001, title: 'P2 正片', duration: 754 }
  ],
  title: '【测试】用于验证流程的视频',
  owner: '测试UP',
  duration: 754,
  url: 'https://www.bilibili.com/video/BV1xx411c7mD/?p=2',
  signature: 'BV1xx411c7mD@p2@c999001'
};

// 字幕正文必须与视频标题/简介**是同一话题** —— 现在 validateLines 会做归属校验
// （防「抓到别的视频的字幕」），用无关的通用句子会被正确地判为 unrelated 而拒用。
// 所以固定的测试数据要写成「像这期视频真实字幕」的样子。
const SNIFFED = Array.from({ length: 240 }, (_, i) => ({
  from: i * 3,
  to: i * 3 + 2.6,
  content: `这是本次流程验证视频的第 ${i + 1} 句字幕，讲的是抓取字幕与生成总结的完整步骤。`
}));
const API_LINES = Array.from({ length: 60 }, (_, i) => ({
  from: i * 12,
  to: i * 12 + 11,
  text: `流程验证视频的字幕第 ${i + 1} 句（来自接口下载）`
}));

const SUMMARY_MD = [
  '# 视频总结',
  '',
  '## 核心结论',
  '',
  '- **要点一**：这是粗体',
  '- *要点二*：这是斜体',
  '',
  '| 时间 | 主题 |',
  '| --- | --- |',
  '| 00:00 | 开场 |',
  '',
  '```js',
  'const demo = 1;',
  '```',
  '',
  '> 引用块',
  '',
  ':::tip',
  '高亮块',
  ':::',
  '',
  '详见 [示例](https://example.com)。'
].join('\n');

const TAB = {
  id: 7,
  url: 'https://www.bilibili.com/video/BV1xx411c7mD/?p=2',
  title: VIDEO.title,
  active: true,
  windowId: 1,
  status: 'complete'
};

const storage = { 'bsub.settings.v1': makeSettings() };
const cacheRows = new Map();
let bundleMode = 'ok';
let triggerCalls = 0;

function makeSettings() {
  return {
    schema: 1,
    general: { theme: 'light', fontScale: 1, layout: 'auto', autoFollow: true, firstRun: false, wizardDone: true },
    ai: {
      activeId: 'deepseek',
      platforms: [{ id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '••••••••abcd', apiKeySet: true, models: ['deepseek-chat'] }],
      temperature: 0.3,
      maxTokens: 4096,
      stream: true
    },
    asr: {
      activeId: 'siliconflow',
      platforms: [{ id: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/SenseVoiceSmall', transport: 'base64-json', keyField: 'audio', apiKey: '••••••••efgh', apiKeySet: true, models: [] }],
      concurrency: 2,
      timeoutSeconds: 180,
      sizeLimitMB: 24,
      sliceSeconds: 300,
      overlapSeconds: 4,
      autoOptimizeAfter: false,
      autoApplyAfter: false
    },
    prompt: {
      activeId: 'default',
      templates: [{ id: 'default', name: '默认', text: '整理这期视频的内容（可以用表格、代码块、高亮块、引用、超链接、公式、图片等飞书支持的格式输出，可以加上一些图标增加可读性）' }],
      chatPrefix: '只依据下面的字幕内容回答。'
    },
    optimize: { activeGroupId: 'g', groups: [{ id: 'g', name: 'g', rules: [] }], glossary: [], useSearch: false, searchMaxResults: 3 },
    search: { activeId: 'tavily', platforms: [{ id: 'tavily', name: 'Tavily', baseUrl: 'https://api.tavily.com/search', apiKey: '••••••••tvly', apiKeySet: true, kind: 'tavily' }], engine: 'bing', maxResults: 6, fetchPageContent: false },
    exportCfg: { format: 'srt', template: 'timed', includeTimestamps: true, estimateTimestamps: true, assFontSize: 42, filenamePattern: '{title}-{part}' },
    page: { playerButton: true, playerButtonPrompt: '总结要点', overlay: false, overlayFontScale: 1, overlayBottom: 8, followPlayback: true },
    behavior: { preferOfficial: true, useLocalCache: true },
    batch: { autoExport: false, pauseBetween: 800 },
    cache: { subtitleTtlDays: 30, keepAudio: false },
    diagnostics: { verbose: false },
    __readiness: { ok: { ai: true, asr: true, prompt: true, search: true }, issues: [] }
  };
}

function bundle() {
  if (bundleMode === 'ok' || bundleMode === 'empty-then-ok') {
    if (bundleMode === 'empty-then-ok' && triggerCalls === 0) {
      return { ok: true, tracks: [], sources: [], errors: [], needLogin: false, sniffCount: 0, groups: [] };
    }
    return {
      ok: true,
      tracks: [
        { id: '1', lan: 'zh-CN', lanDoc: '中文（简体）', url: 'https://aisubtitle.hdslb.com/a/zh.json?x=1', isAi: false, body: SNIFFED, from: 'page' },
        { id: '2', lan: 'ai-zh', lanDoc: '中文（自动生成）', url: 'https://aisubtitle.hdslb.com/a/ai.json?x=2', isAi: true, body: null, from: 'page' }
      ],
      sources: ['player/v2', 'network-sniff'],
      errors: [],
      needLogin: false,
      sniffCount: 1,
      groups: ['playerV2', 'sniffed']
    };
  }
  return { ok: true, tracks: [], sources: ['player/v2'], errors: [], needLogin: true, sniffCount: 0, groups: [] };
}

function handleRpc(method, params) {
  rpcLog.push({ method, params });
  const settings = () => JSON.parse(JSON.stringify(storage['bsub.settings.v1']));
  switch (method) {
    case 'settings.get':
    case 'settings.set':
    case 'settings.patch':
    case 'settings.reset':
      return settings();
    case 'build.info':
      return { app: 'B站字幕助手', version: '1.48.0', contentVersion: '1.48.0', modules: 12, buildTime: '2025-06-01T00:00:00Z' };
    case 'page.info':
      return VIDEO;
    case 'page.call': {
      const name = params && params.name;
      if (name === 'getSubtitleBundle') return bundle();
      if (name === 'getInfo') return VIDEO;
      if (name === 'getSubtitles') return { ok: true, subtitles: [], sources: [] };
      if (name === 'triggerSubtitleMenu') {
        triggerCalls += 1;
        return { ok: true, count: 1 };
      }
      return { ok: true };
    }
    case 'subtitle.trigger':
      triggerCalls += 1;
      return { ok: true, count: 1 };
    case 'subtitle.api':
      if (bundleMode === 'empty') {
        return { tracks: [], code: 0, message: 'OK', needLogin: true, sources: [], errors: [{ source: 'wbi/v2', code: 0, message: 'need_login_subtitle' }], video: { duration: 754 } };
      }
      return {
        tracks: [{ id: '9', lan: 'zh-Hans', lanDoc: '中文（简体，AI）', url: 'https://aisubtitle.hdslb.com/a/api.json?x=9', isAi: true, from: 'api' }],
        code: 0,
        message: 'OK',
        needLogin: false,
        sources: ['wbi/v2'],
        errors: [],
        video: { duration: 754 }
      };
    case 'subtitle.fetch':
      return { format: 'json-array', lines: API_LINES, url: params.url };
    case 'subtitle.cache.get': {
      const row = cacheRows.get(params.lang);
      return row ? { hit: true, key: params.lang, row } : { hit: false, key: params.lang };
    }
    case 'subtitle.cache.put':
      cacheRows.set(params.lang, { savedAt: Date.now(), payload: params.payload, meta: params.meta });
      return { key: params.lang };
    case 'history.put':
      return { row: { key: 'k', savedAt: Date.now() } };
    case 'history.list':
      return { rows: [] };
    case 'cache.stats':
      return { subtitleCount: 1, audioCount: 0, historyCount: 1, approxBytes: 100 };
    default:
      return { ok: true, method };
  }
}

function installChrome(window) {
  window.__rpcLog = rpcLog;
  window.chrome = {
    runtime: {
      id: 'test-ext',
      lastError: null,
      getManifest: () => ({ version: '1.48.0', manifest_version: 3 }),
      getURL: (p) => `http://127.0.0.1/${p}`,
      connect: () => ({
        name: 'bsub-stream',
        onMessage: { addListener: (f) => (window.__portListeners = (window.__portListeners || []).concat(f)) },
        onDisconnect: { addListener: () => {} },
        postMessage: (m) => {
          const push = (x) => (window.__portListeners || []).forEach((f) => f(x));
          setTimeout(() => push({ kind: 'stream:delta', rid: m.rid, text: SUMMARY_MD.slice(0, 60) }), 20);
          setTimeout(() => push({ kind: 'stream:delta', rid: m.rid, text: SUMMARY_MD.slice(60) }), 60);
          setTimeout(() => push({ kind: 'stream:end', rid: m.rid }), 120);
        },
        disconnect: () => {}
      }),
      sendMessage: (msg, cb) => {
        if (msg && msg.kind === 'rpc') {
          try {
            const data = handleRpc(msg.method, msg.params || {});
            Promise.resolve().then(() => cb && cb({ kind: 'rpc:res', id: msg.id, ok: true, data }));
          } catch (err) {
            cb && cb({ kind: 'rpc:res', id: msg.id, ok: false, error: { title: String(err.message), kind: 'unknown' } });
          }
        } else if (typeof cb === 'function') {
          cb({ ok: true });
        }
      },
      onMessage: { addListener: () => {}, removeListener: () => {} },
      onConnect: { addListener: () => {} }
    },
    storage: {
      local: {
        get: (key) => Promise.resolve(typeof key === 'string' ? { [key]: storage[key] } : Object.fromEntries((key || []).map((k) => [k, storage[k]]))),
        set: (obj) => {
          Object.assign(storage, JSON.parse(JSON.stringify(obj)));
          return Promise.resolve();
        },
        remove: (k) => {
          delete storage[k];
          return Promise.resolve();
        }
      },
      onChanged: { addListener: () => {} }
    },
    tabs: {
      query: () => Promise.resolve([TAB]),
      sendMessage: (tabId, msg) => {
        if (msg && msg.type === 'bsub:ping') return Promise.resolve({ ok: true, version: '1.48.0' });
        if (msg && msg.type === 'bsub:to-content') {
          if (msg.method === 'getSubtitleBundle') return Promise.resolve({ ok: true, data: bundle() });
          if (msg.method === 'triggerSubtitleMenu') {
            triggerCalls += 1;
            return Promise.resolve({ ok: true, data: { ok: true, count: 1 } });
          }
          return Promise.resolve({ ok: true, data: { ok: true } });
        }
        return Promise.resolve({ ok: true });
      },
      create: () => Promise.resolve({ id: 1 }),
      get: () => Promise.resolve(TAB)
    },
    permissions: { contains: () => Promise.resolve(true), request: () => Promise.resolve(true), getAll: () => Promise.resolve({ origins: [] }) },
    sidePanel: { setPanelBehavior: () => Promise.resolve(), setOptions: () => Promise.resolve(), open: () => Promise.resolve() },
    windows: { WINDOW_ID_CURRENT: -2 }
  };
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener: () => {}, removeListener: () => {} }));
}

function serveHtml() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/' || p.endsWith('panel.html')) {
        const raw = fs.readFileSync(path.join(ROOT, 'src/sidepanel/panel.html'), 'utf8');
        const bundleJs = fs.readFileSync(BUNDLE, 'utf8');
        // 必须用**函数形式**的 replace：字符串 replacement 里 `$$` 是特殊模式，
        // 而 bundle 现在含有 LaTeX 的 `$$...$$`，会被悄悄改写并在 jsdom 里
        // 报一个与真实代码无关的 SyntaxError。
        const html = raw
          .replace(/<script type="module"[^>]*><\/script>/g, '')
          .replace('</body>', () => `<script>\n${bundleJs}\n</script>\n</body>`);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (p.endsWith('panel.css')) {
        res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
        res.end(fs.readFileSync(path.join(ROOT, 'src/sidepanel/panel.css')));
        return;
      }
      res.writeHead(404);
      res.end('nf');
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await serveHtml();
  const vc = new VirtualConsole();
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
  const dom = await JSDOM.fromURL(`http://127.0.0.1:${server.address().port}/panel.html`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse: installChrome
  });
  const { window } = dom;
  const doc = window.document;
  window.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push('unhandledrejection: ' + ((e.reason && e.reason.message) || e.reason)));
  await sleep(2200);

  const api = window.__BSUB_SELFCHECK__;
  check('面板已初始化', !!api && !!api.app && !!api.context);
  if (!api) {
    report(server);
    return;
  }
  const store = api.store;

  // ---------- ① 读取视频 ----------
  const video = await api.context.loadVideo();
  await sleep(400);
  let st = store.get();
  check('① 读到视频信息', !!video && st.video && st.video.title === VIDEO.title && st.video.duration === 754 && st.video.parts.length === 2);
  check('① 识别当前分 P 与签名', st.video.page === 2 && st.video.signature === 'BV1xx411c7mD@p2@c999001');
  const bar1 = doc.getElementById('actionbar').textContent;
  // 主按钮文案是「② 抓取官方字幕」；次要操作已收进「⋯」菜单
  check('① 顶部出现读取/抓取按钮', /抓取官方字幕/.test(bar1), bar1.slice(0, 90));

  // ---------- ② 抓取字幕 ----------
  const harvested = await api.context.harvest();
  await sleep(500);
  st = store.get();
  check('② 抓字幕成功', !!harvested && harvested.ok === true, JSON.stringify(harvested && harvested.meta));
  check('② 拿到 240 行', (st.subtitles || []).length === 240, `实际 ${(st.subtitles || []).length}`);
  check('② 优先用页面已捕获的正文（未再下载）', !rpcLog.some((r) => r.method === 'subtitle.fetch'), rpcLog.filter((r) => /subtitle/.test(r.method)).map((r) => r.method).join(','));
  check('② 命中中文人工轨而不是 AI 轨', st.video.subtitleMeta.lang === 'zh-CN', JSON.stringify(st.video.subtitleMeta.lang));
  check('② 时长校验通过', st.video.subtitleMeta.validation.ok === true);
  check('② 写入缓存', cacheRows.has('zh-CN'), [...cacheRows.keys()].join(','));
  window.__dbg = { lines: (store.get().subtitles||[]).length, renderPanels: window.__renderPanelsCount, subCount: window.__actionsSubCount, renderCount: window.__actionsRenderCount, emit: window.__storeEmitCount };
  console.log('DEBUG2', JSON.stringify(window.__dbg));
  const barEl = doc.getElementById('actionbar');
  console.log('DEBUG3 barChildren=' + barEl.children.length + ' pills=' + JSON.stringify(Array.from(barEl.querySelectorAll('.pill')).map((p) => p.textContent)) + ' firstBtn=' + (barEl.querySelector('button') ? barEl.querySelector('button').textContent : 'none') + ' lastSig=' + window.__actionsSubSig);
  const bar2 = doc.getElementById('actionbar').textContent;
  check('② 顶部胶囊显示行数', /240 行/.test(bar2), bar2.slice(-120));
  check('② 顶部主按钮变成「生成总结」', /生成总结/.test(bar2), bar2.slice(0, 90));
  // 字幕就绪后，常用操作应**直接摆出来**（用户要求：常用摆外面、不常用进 ⋯）
  check('② 常用按钮直接可见（提问 / 优化字幕 / 复制 / 导出）',
    /去提问/.test(bar2) && /优化字幕/.test(bar2) && /复制/.test(bar2) && /导出/.test(bar2),
    bar2.slice(0, 140));
  // 常用按钮数量要克制，不能又铺平一堆
  {
    const barEl = doc.getElementById('actionbar');
    const shown = Array.from(barEl.querySelectorAll('button'))
      .filter((b) => !b.closest('.menu-panel'))
      .map((b) => b.textContent.trim())
      .filter(Boolean);
    check('② 可见按钮不超过 7 个', shown.length <= 7, `${shown.length} 个: ${shown.join('/')}`);
  }

  await sleep(300);
  const rows = doc.querySelectorAll('#subtitles-pane .subtitle-row');
  check('② 字幕列表渲染出行', rows.length > 3, `渲染 ${rows.length} 行`);
  check('② 行内含时间与文本', !!rows[0] && /00:00/.test(rows[0].textContent) && rows[0].querySelector('.st-text').textContent.length > 3);
  check('② 行内显示单行统计', !!rows[0].querySelector('.stats'));

  // ---------- ③ 搜索 / 跟随 / 跳转 ----------
  store.setUi({ search: '第 5 句' });
  await sleep(400);
  check('③ 搜索命中并高亮', doc.querySelectorAll('#subtitles-pane .st-text mark').length > 0);
  store.setUi({ search: '' });
  await sleep(300);

  store.set({ follow: { currentTime: 33, duration: 754, paused: false } });
  api.panelSubtitles.syncActive();
  await sleep(300);
  check('③ 跟随播放高亮当前句', doc.querySelectorAll('#subtitles-pane .subtitle-row[data-active="true"]').length === 1, `active=${doc.querySelectorAll('#subtitles-pane .subtitle-row[data-active="true"]').length}`);
  const seekBefore = rpcLog.filter((r) => r.method === 'page.seek').length;
  const timeEl = doc.querySelector('#subtitles-pane .subtitle-row .st-time');
  if (timeEl) timeEl.click();
  await sleep(300);
  check('③ 点击时间戳跳转播放位置', rpcLog.filter((r) => r.method === 'page.seek').length > seekBefore);

  // ---------- ④ 总结 ----------
  store.set({ activeTab: 'ai' });
  await sleep(200);
  await api.panelAi.generateSummary();
  await sleep(700);
  st = store.get();
  check('④ 总结生成完成', (st.summary || '').length > 50, `长度 ${(st.summary || '').length}`);
  const box = doc.querySelector('#ai-pane .summary-box');
  check('④ Markdown 真正渲染（标题/表格/代码块/高亮块）', !!box && !!box.querySelector('h1') && !!box.querySelector('table') && !!box.querySelector('pre') && !!box.querySelector('.md-callout'));
  check('④ 没有残留 ** 原始符号', !!box && !/\*\*[^*]+\*\*/.test(box.textContent));
  check('④ 渲染出超链接', !!box && !!box.querySelector('a[href^="https://example.com"]'));

  // ---------- ⑤ 对话 ----------
  await api.panelAi.sendMessage('这期讲了什么？');
  await sleep(700);
  st = store.get();
  check('⑤ 对话产生用户 + AI 两条消息', st.chat.length >= 2 && st.chat[st.chat.length - 2].role === 'user' && st.chat[st.chat.length - 1].role === 'assistant');
  check('⑤ AI 回复非空且流式已结束', (st.chat[st.chat.length - 1].text || '').length > 10 && st.chat[st.chat.length - 1].streaming !== true);
  check('⑤ 对话在界面渲染', doc.querySelectorAll('#ai-pane .msg').length >= 2);

  // ---------- ⑥ 导出 ----------
  const srt = api.exporter.buildExport(st.subtitles, { ...st.video, summary: st.summary }, { format: 'srt', template: 'timed', includeTimestamps: true });
  check('⑥ 导出 SRT 含 240 条', (srt.match(/-->/g) || []).length === 240, `箭头 ${(srt.match(/-->/g) || []).length}`);
  check('⑥ SRT 毫秒用逗号', /,\d{3} --> /.test(srt));
  const md = api.exporter.buildExport(st.subtitles, { ...st.video }, { format: 'md', template: 'study', includeTimestamps: true });
  check('⑥ 导出学习笔记模板非空', md.length > 100 && /^#/m.test(md), `长度 ${md.length}`);

  // ---------- ⑦ 页面读不到 → 点播放器字幕菜单 → 再读 ----------
  bundleMode = 'empty-then-ok';
  triggerCalls = 0;
  cacheRows.clear();
  store.set({ subtitles: [], subtitleError: null });
  const out2 = await api.context.harvest();
  await sleep(500);
  check('⑦ 页面空时会去点播放器字幕菜单', triggerCalls >= 1, `trigger=${triggerCalls}`);
  check('⑦ 触发后重新读取拿到字幕', !!out2 && out2.ok === true && out2.lines.length === 240, `ok=${!!(out2 && out2.ok)} lines=${out2 && out2.lines ? out2.lines.length : 0}`);

  // ---------- ⑧ 完全没有字幕 ----------
  bundleMode = 'empty';
  triggerCalls = 0;
  cacheRows.clear();
  store.set({ subtitles: [], subtitleError: null });
  const out3 = await api.context.harvest();
  await sleep(500);
  st = store.get();
  check('⑧ 无字幕时返回失败而不是假成功', out3 === null && !!st.subtitleError, JSON.stringify(st.subtitleError && st.subtitleError.title));
  check('⑧ 提示里说明需要登录 B 站', !!st.subtitleError && /登录/.test((st.subtitleError.detail || '') + (st.subtitleError.action || '')));
  check('⑧ 提示里带上来源明细', !!st.subtitleError && /need_login_subtitle|来源|接口/.test(st.subtitleError.detail || ''), (st.subtitleError && st.subtitleError.detail || '').slice(0, 160));
  await sleep(300);
  const bar3 = doc.getElementById('actionbar').textContent;
  check('⑧ 顶部给出「查看明细 / 语音转录」', /查看明细/.test(bar3) && /语音转录/.test(bar3), bar3.slice(-200));

  report(server);
}

function report(server) {
  console.log('\n===== 端到端流程测试 =====');
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed += 1;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
  }
  console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
  if (errors.length) {
    console.log('\n---- 运行时错误 ----');
    for (const e of errors.slice(0, 20)) console.log(e);
  }
  try {
    server && server.close();
  } catch (err) {
    /* ignore */
  }
  process.exit(results.some((r) => !r.ok) || errors.length ? 1 : 0);
}

main().catch((err) => {
  console.error('测试崩溃：', err && err.stack);
  report(null);
});
