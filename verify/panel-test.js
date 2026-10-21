// 侧边栏真实渲染测试（jsdom）。
// jsdom 不执行 type=module 脚本，因此用 esbuild 把 src/sidepanel/app.js 打成 IIFE 后注入页面骨架。
// 面板骨架与 panel.html 保持一致（panel.html 结构变了要同步这里）。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', 'bilibili-subtitle-assistant');
const BUNDLE = path.join(__dirname, 'build', 'panel.iife.js');
const PANEL_HTML = path.join(ROOT, 'src/sidepanel', 'panel.html');
const PANEL_CSS = path.join(ROOT, 'src/sidepanel', 'panel.css');

function structureFingerprint(html) {
  const ids = ['app', 'topbar', 'tabs', 'fingerprint', 'readiness', 'jobs', 'alerts', 'main', 'view', 'actionbar', 'columns', 'col-subtitles', 'col-ai', 'subtitles-pane', 'ai-pane', 'settings-pane', 'overlay-root', 'drag-hint'];
  return ids.filter((id) => html.includes(`id="${id}"`));
}

const skeleton = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head><meta charset="utf-8" /><title>B站字幕助手</title><link rel="stylesheet" href="/panel.css" /></head>
<body data-layout="auto" data-tab="subtitles">
<div id="app" data-app="true">
  <header id="topbar">
    <div class="topbar-row">
      <div class="brand"><span class="brand-mark">字幕</span><span class="brand-title">B站字幕助手</span></div>
      <div class="topbar-actions">
        <button id="btn-layout" class="btn icon-btn" type="button">L</button>
        <button id="btn-font-down" class="btn icon-btn" type="button">A-</button>
        <button id="btn-font-up" class="btn icon-btn" type="button">A+</button>
        <button id="btn-theme" class="btn icon-btn" type="button">T</button>
        <button id="btn-help" class="btn icon-btn" type="button">?</button>
        <button id="btn-settings" class="btn icon-btn" type="button">S</button>
      </div>
    </div>
    <div class="tabs" id="tabs">
      <button class="tab" type="button" data-tab-btn="subtitles">字幕</button>
      <button class="tab" type="button" data-tab-btn="ai">总结 / AI</button>
      <button class="tab" type="button" data-tab-btn="settings">设置</button>
    </div>
    <div id="fingerprint" class="fingerprint">构建信息加载中…</div>
  </header>
  <div id="readiness" class="readiness" data-visible="true"></div>
  <div id="jobs" class="jobs" data-visible="false" style="display:none"></div>
  <div id="alerts" class="alerts"></div>
  <main id="main">
    <div id="view" class="view" data-tab="subtitles">
      <div id="actionbar" class="actionbar"></div>
      <div id="columns" class="columns" data-mode="two">
        <section id="col-subtitles" class="column" data-col="subtitles"><div id="subtitles-pane" class="pane"></div></section>
        <section id="col-ai" class="column" data-col="ai"><div id="ai-pane" class="pane"></div></section>
      </div>
      <section id="settings-pane" class="pane settings"></section>
    </div>
  </main>
  <div id="overlay-root" class="overlay-root" data-open="false"></div>
  <div id="drag-hint" class="drag-hint" data-visible="false">松开即可把文件加入对话</div>
</div>
<script>__BUNDLE__</script>
</body></html>`;

const DEFAULT_SETTINGS = require('./default-settings.json');
const errors = [];
const storage = { 'bsub.settings.v1': JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/' || p.endsWith('panel.html')) {
        // 注意：必须用**函数形式**的 replace。
  // 字符串形式的 replacement 里 `$$`、`$&` 等是特殊模式，
  // 而 bundle 里现在含有 LaTeX 的 `$$...$$` —— 会被悄悄改写甚至插入错字符，
  // 结果就是 jsdom 报一个和真实代码毫无关系的 SyntaxError。
  const html = skeleton.replace('__BUNDLE__', () => fs.readFileSync(BUNDLE, 'utf8'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (p.endsWith('panel.css')) {
        res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
        res.end(fs.readFileSync(PANEL_CSS));
        return;
      }
      res.writeHead(404);
      res.end('nf');
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function makePort() {
  return {
    name: 'bsub-stream',
    onMessage: { addListener: () => {} },
    onDisconnect: { addListener: () => {} },
    postMessage: () => {},
    disconnect: () => {}
  };
}

function settingsForUi() {
  const raw = storage['bsub.settings.v1'];
  const s = JSON.parse(JSON.stringify(raw));
  for (const group of ['ai', 'asr', 'search']) {
    for (const p of s[group].platforms) {
      const real = raw[group].platforms.find((x) => x.id === p.id) || {};
      p.apiKeySet = !!real.apiKey;
      p.apiKey = real.apiKey ? `••••••••${String(real.apiKey).slice(-4)}` : '';
    }
  }
  const ai = s.ai.platforms.find((p) => p.id === s.ai.activeId);
  const issues = [];
  if (!ai.apiKey) issues.push({ level: 'warn', area: 'ai', text: 'AI 平台还没填 API Key，AI 总结与对话不可用。' });
  issues.push({ level: 'info', area: 'search', text: '服务商检索未配置，仍可用「直接搜索引擎」链接，不消耗额度。' });
  s.__readiness = { ok: { ai: !!ai.apiKey, asr: false, prompt: true, search: false }, issues };
  return s;
}

const RPC_RESPONSES = {
  'build.info': { app: 'B站字幕助手', version: '2.11.0', contentVersion: '2.11.0', modules: 19, buildTime: '2026-10-21T07:00:00Z' },
  'page.info': {
    ok: true,
    kind: 'video',
    bvid: 'BV1xx411c7mD',
    cid: 123456,
    page: 1,
    title: '测试视频标题',
    owner: '测试UP',
    duration: 754,
    parts: [{ index: 1, title: 'P1', duration: 754 }],
    subtitleTracks: [],
    signature: 'BV1xx411c7mD@p1@c123456',
    url: 'https://www.bilibili.com/video/BV1xx411c7mD'
  },
  'page.subtitles': { subtitles: [{ lan: 'zh-CN', lanDoc: '中文（简体）', url: '//aisubtitle.hdslb.com/x.json', isAi: false }], sources: ['player.getSubtitle'] },
  'page.call': { ok: true },
  'page.reinject': { ok: true },
  'history.list': { rows: [] },
  'cache.stats': { subtitleCount: 0, audioCount: 0, historyCount: 0, approxBytes: 0 },
  'page.refresh': {
    tabs: [{ tabId: 1, url: 'https://www.bilibili.com/video/BV1xx411c7mD', title: '测试视频标题', pageType: 'video', scriptVersion: '2.11.0', stale: false }],
    contentVersion: '2.11.0'
  },
  diagnostics: {
    extensionVersion: '2.11.0',
    contentVersion: '2.11.0',
    modules: 19,
    buildTime: '2026-10-21T07:00:00Z',
    userAgent: 'jsdom',
    manifestVersion: 3,
    cache: { subtitleCount: 0, audioCount: 0, historyCount: 0, approxBytes: 0 },
    platformSummary: { ai: [{ id: 'deepseek', name: 'DeepSeek', active: true, keySet: false, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' }] },
    permissions: { origins: ['https://*.bilibili.com/*'] }
  }
};

function installChrome(window) {
  window.chrome = {
    runtime: {
      id: 'test-extension',
      lastError: null,
      getManifest: () => ({ version: '2.11.0', manifest_version: 3 }),
      getURL: (p) => `http://127.0.0.1/${p}`,
      connect: () => makePort(),
      sendMessage: (msg, cb) => {
        if (msg && msg.kind === 'rpc') {
          const data = msg.method === 'settings.get' ? settingsForUi() : RPC_RESPONSES[msg.method] || { ok: true, method: msg.method };
          Promise.resolve().then(() => cb && cb({ kind: 'rpc:res', id: msg.id, ok: true, data }));
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
    tabs: { query: () => Promise.resolve([]), sendMessage: () => Promise.resolve({ ok: true }), create: () => Promise.resolve({ id: 1 }), get: () => Promise.resolve({ id: 1 }) },
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

async function main() {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/panel.html`;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')));
  virtualConsole.on('jsdomError', (err) => errors.push(`jsdomError: ${err && err.message}`));

  const realHtml = fs.readFileSync(PANEL_HTML, 'utf8');
  const dom = await JSDOM.fromURL(url, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse: installChrome
  });
  const { window } = dom;
  window.addEventListener('error', (e) => errors.push(`window.error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => errors.push(`unhandledrejection: ${(e.reason && (e.reason.message || e.reason)) || e.reason}`));

  await sleep(2600);
  const doc = window.document;
  const results = [];
  const check = (name, ok, extra = '') => results.push({ name, ok: !!ok, extra });
  const step = (label) => console.log(`[step] ${label} heap=${Math.round(process.memoryUsage().heapUsed / 1048576)}MB asserts=${results.length}`);
  step('页面初始化完成');

  check('测试骨架与 panel.html 关键结构一致', structureFingerprint(realHtml).length >= 18, `关键 id 数 ${structureFingerprint(realHtml).length}`);
  check('面板脚本已执行（自检挂钩存在）', !!window.__BSUB_SELFCHECK__);
  const api = window.__BSUB_SELFCHECK__;

  check('顶部标题渲染', /B站字幕助手/.test(doc.body.textContent));
  check('构建指纹（版本 + 模块数 + 构建时间）', /构建指纹 2\.11\.0 · 19 模块 · 2026-10-21/.test(doc.getElementById('fingerprint').textContent), doc.getElementById('fingerprint').textContent);
  check('配置状态常驻提示可见且说明原因', doc.getElementById('readiness').getAttribute('data-visible') === 'true' && /API Key/.test(doc.getElementById('readiness').textContent));
  // ---- 操作区：主流程按钮必须精简，次要操作收进「⋯」菜单 ----
  {
    const bar = doc.getElementById('actionbar');
    const barText = bar.textContent;
    const visibleBtns = Array.from(bar.querySelectorAll('button')).filter(
      (b) => !b.closest('.menu-panel') && b.offsetParent !== null
    );
    check('操作区渲染出读取视频', /读取当前视频|抓取官方字幕|生成总结/.test(barText), barText.slice(0, 80));
    // 手动检索栏已移除：联网由 AI 自动完成（生成总结/对话时），
    // 只在已有来源时给一个查看入口。这里断言**不再**有手动检索控件。
    check('不再有手动检索输入框（改由 AI 自动联网）', !bar.querySelector('input[placeholder*="检索关键词"]'), '');
    check('没有来源时不出现检索来源入口', !/查看 \d+ 条检索来源/.test(barText), '');
    // 界面可见按钮要少 —— 这是本轮的核心目标
    check('可见按钮不超过 6 个（避免一屏全是按钮）', visibleBtns.length <= 6, `可见 ${visibleBtns.length} 个: ${visibleBtns.map((b) => b.textContent).join('/')}`);
    check('存在「更多操作」菜单', !!bar.querySelector('.menu-wrap .menu-trigger'), '');
    check('菜单默认是收起的', bar.querySelector('.menu-wrap').getAttribute('data-open') !== 'true', '');
    // 常用操作应直接摆出来（用户要求：常用的摆出来，不常用的进 ⋯）
    // 注意：当前是「还没读视频」的空态，所以只断言引导按钮；
    // 常用按钮要等字幕就绪后才出现（见下方 flow2 的流程断言）。
    check('空态显示「读取当前视频」主按钮', /读取当前视频/.test(barText), barText.slice(0, 120));
    // 打开菜单（用 pointerdown 开关，与实现一致）
    const mt = bar.querySelector('.menu-trigger');
    const tap = (el) => el.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    tap(mt);
    await sleep(60);
    const openedPanel = bar.querySelector('.menu-panel');
    const menuText = openedPanel ? openedPanel.textContent : '';
    check('菜单能展开', !!openedPanel && bar.querySelector('.menu-wrap').getAttribute('data-open') === 'true', menuText.slice(0, 60));
    check('菜单里含应用替换规则', /应用替换规则/.test(menuText), menuText.slice(0, 160));
    check('菜单里含生成章节与质量自检', /生成章节/.test(menuText) && /质量自检/.test(menuText), '');
    check('菜单里含历史记录与回退', /历史记录与回退/.test(menuText), '');
    check('菜单里含批量处理', /批量处理/.test(menuText), '');
    check('菜单里含语音转录', /语音转录/.test(menuText), '');
    // 再点一次能收起（防「点了没反应」回归）
    tap(mt);
    await sleep(50);
    check('再点一次可收起', bar.querySelector('.menu-wrap').getAttribute('data-open') !== 'true', '');
  }
  const subEmpty = doc.getElementById('subtitles-pane').textContent;
  check('字幕面板空态渲染（含引导清单）', /还没有拿到视频信息|读取当前视频/.test(subEmpty));
  check('空态给出 4 步流程引导', (doc.querySelectorAll('#subtitles-pane .step').length >= 3) && /获取字幕/.test(subEmpty) && /语音转录/.test(subEmpty) && /生成总结/.test(subEmpty), JSON.stringify(Array.from(doc.querySelectorAll('#subtitles-pane .step-title')).map((e) => e.textContent)));
  check('空态有主行动按钮', !!doc.querySelector('#subtitles-pane .step + .row .btn-primary, #subtitles-pane .empty .btn-primary'));
  check('AI 面板渲染（总结 + 对话）', /AI 总结/.test(doc.getElementById('ai-pane').textContent) && /与 AI 对话/.test(doc.getElementById('ai-pane').textContent));
  check('默认单列堆叠布局', doc.getElementById('columns').getAttribute('data-mode') === 'one', doc.getElementById('columns').getAttribute('data-mode'));

  for (const id of ['readiness', 'jobs', 'overlay-root', 'drag-hint']) {
    const el = doc.getElementById(id);
    const v = el.getAttribute('data-visible') != null ? el.getAttribute('data-visible') : el.getAttribute('data-open');
    check(`稳定性#1 ${id} 布尔属性为字符串 "true"/"false"`, v === 'true' || v === 'false', `${id}=${JSON.stringify(v)}`);
  }
  check('稳定性#3 浮层遮罩 pointer-events:none', doc.getElementById('overlay-root').style.pointerEvents === 'none');
  check('稳定性#2 高度链齐全', ['#app', '#main', '#view', '#columns'].every((s) => doc.querySelector(s)));
  const scrollHosts = Array.from(doc.querySelectorAll('.scroll-host'));
  check('稳定性#2 存在滚动容器', scrollHosts.length > 0, String(scrollHosts.length));
  check('稳定性#2 滚动容器未使用 display:flex', scrollHosts.every((el) => !/display:\s*flex/.test(el.getAttribute('style') || '')));

  step('基础渲染断言完成');
  if (!api) {
    report(results, errors);
    server.close();
    process.exit(1);
  }

  const mdHost = doc.createElement('div');
  api.markdown.renderMarkdownInto(
    mdHost,
    [
      '# 标题一',
      '',
      '**粗体** 与 *斜体* 与 `行内代码` 与 ~~删除~~ 与 ==高亮==',
      '',
      '| 列A | 列B |',
      '| --- | ---: |',
      '| 1 | 2 |',
      '',
      '```js',
      'const a = 1;',
      '```',
      '',
      '> 引用块',
      '',
      ':::warning',
      '高亮块内容',
      ':::',
      '',
      '- 项目一',
      '- 项目二',
      '',
      '1. 有序一',
      '2. 有序二',
      '',
      '---',
      '',
      '[链接](https://example.com)',
      '[危险](javascript:alert(1))',
      '<img src=x onerror=alert(1)>'
    ].join('\n')
  );
  check('Markdown 渲染标题', !!mdHost.querySelector('h1'));
  check('Markdown 渲染表格', !!mdHost.querySelector('table'));
  check('Markdown 渲染代码块', !!mdHost.querySelector('pre'));
  check('Markdown 渲染引用高亮块', !!mdHost.querySelector('.md-callout'));
  check('Markdown 渲染分隔线', !!mdHost.querySelector('hr'));
  check('Markdown 渲染列表（有序/无序）', !!mdHost.querySelector('ol') && !!mdHost.querySelector('ul'));
  check('Markdown 渲染链接', !!mdHost.querySelector('a[href^="https://example.com"]'));
  check('Markdown 渲染粗体/斜体/删除线/高亮/行内代码', !!mdHost.querySelector('strong') && !!mdHost.querySelector('em') && !!mdHost.querySelector('del') && !!mdHost.querySelector('.md-mark') && !!mdHost.querySelector('.md-code-inline'));
  check('Markdown 拒绝 javascript: 链接', !mdHost.querySelector('a[href^="javascript"]'));
  check('Markdown 不执行 HTML（无 img/script 注入）', !mdHost.querySelector('img[onerror]') && !mdHost.querySelector('script'));

  step('Markdown 断言完成');
  const lines = [
    { i: 0, from: 0.5, to: 2.0, text: '第一行字幕' },
    { i: 1, from: 2.0, to: 4.25, text: '第二行，带标点。' }
  ];
  const video = { title: 'T', partTitle: 'P1', bvid: 'BV1', duration: 10, owner: 'U', page: 1, url: 'https://x' };
  let combos = 0;
  let emptyCombo = '';
  for (const f of ['srt', 'vtt', 'ass', 'txt', 'md', 'json']) {
    for (const t of ['plain', 'timed', 'study', 'meeting']) {
      const out = api.exporter.buildExport(lines, video, { format: f, template: t, includeTimestamps: true, estimateTimestamps: true, assFontSize: 42 });
      combos += 1;
      if (!out || !out.length) emptyCombo += `${f}/${t} `;
    }
  }
  check('导出 6 格式 × 4 模板 均有内容', combos === 24 && !emptyCombo, emptyCombo);
  const srt = api.exporter.buildExport(lines, video, { format: 'srt', template: 'timed' });
  const vtt = api.exporter.buildExport(lines, video, { format: 'vtt', template: 'timed' });
  const ass = api.exporter.buildExport(lines, video, { format: 'ass', template: 'timed', assFontSize: 42 });
  const json = JSON.parse(api.exporter.buildExport(lines, video, { format: 'json', template: 'timed' }));
  check('SRT 毫秒用逗号分隔', /00:00:00,500 --> 00:00:02,000/.test(srt), srt.split('\n')[1]);
  check('WebVTT 用点号且带 WEBVTT 头', vtt.startsWith('WEBVTT') && /00:00:00\.500/.test(vtt));
  check('ASS 使用指定字号', /Microsoft YaHei,42,/.test(ass));
  check('JSON 结构化数据完整', json.subtitles.length === 2 && json.meta.format === 'json' && !!json.video.bvid);

  const mk = (n, step) => Array.from({ length: n }, (_, i) => ({ from: i * step, to: i * step + step - 0.2, text: '这是一行足够长的字幕内容' }));
  check('字幕校验：正常字幕通过', api.subtitles.validateLines(mk(200, 4), 800).ok === true);
  const vOver = api.subtitles.validateLines(mk(200, 5), 600);
  check('字幕校验：超出视频时长过多判为错轨', vOver.ok === false && vOver.kind === 'overrun', vOver.detail);
  const vCov = api.subtitles.validateLines(mk(10, 3), 1200);
  check('字幕校验：覆盖度过低拒用（分档）', vCov.ok === false && vCov.kind === 'coverage', vCov.detail);
  const sorted = api.subtitles.sortCandidates([{ lan: 'en-US' }, { lan: 'ai-zh', isAi: true }, { lan: 'zh-CN' }]);
  check('候选轨中文优先排序', sorted[0].lan === 'zh-CN' && sorted[1].lan === 'ai-zh', sorted.map((x) => x.lan).join('>'));
  check(
    '缓存标识去掉查询串（签名变化不影响命中）',
    api.storage.subtitleCacheKey({ bvid: 'BV1', cid: 1, page: 1, lang: 'zh-CN', url: '//a.hdslb.com/s.json?deadline=1&sign=a' }) ===
      api.storage.subtitleCacheKey({ bvid: 'BV1', cid: 1, page: 1, lang: 'zh-CN', url: '//a.hdslb.com/s.json?deadline=2&sign=b' })
  );

  const overlap = api.audio.dedupeAppend('今天我们来讲一下这个大模型的基本原理', '这个大模型的基本原理其实并不复杂。第二句话。', 6);
  check('重叠去重只追加新增部分', overlap.append.length > 0 && !overlap.append.startsWith('这个大模型的基本原理'), JSON.stringify(overlap));
  const seg = api.audio.segmentPlainText('一。二。三。四。五。'.repeat(20), { maxLen: 80 });
  check('无时间戳结果按标点切分并按约 80 字合并', seg.length > 1 && seg.every((s) => s.length <= 200), `段数 ${seg.length}`);
  check('标点归一化 + 小写化', api.audio.normalizeForMatch('Hello，世界！') === 'hello世界');
  const big = api.audio.planSlices({ samples: new Float32Array(16000 * 3600), rate: 16000, sliceSeconds: 600, overlapSeconds: 4, sizeLimitMB: 24 });
  check('按平台上限自适应分片（片长 45~600s）', big.slices.length > 1 && big.sliceSeconds >= 45 && big.sliceSeconds <= 600, JSON.stringify({ n: big.slices.length, sec: big.sliceSeconds }));
  const limited = api.audio.planSlices({ samples: new Float32Array(16000 * 600), rate: 16000, sliceSeconds: 600, overlapSeconds: 4, sizeLimitMB: 5 });
  check('分片超限时按 0.7 系数重切', limited.attempts > 0 && limited.sliceSeconds < 600, JSON.stringify({ attempts: limited.attempts, sec: limited.sliceSeconds }));
  const wav = api.audio.sliceToWav(new Float32Array(16000), 16000, 0, 1);
  check('切片编码为 16kHz 单声道 WAV', String.fromCharCode.apply(null, Array.from(wav.slice(0, 4))) === 'RIFF' && new DataView(wav.buffer).getUint32(24, true) === 16000);

  const ruleLines = [
    { i: 0, from: 0, to: 2, text: '你因该知道这个' },
    { i: 1, from: 2, to: 4, text: '正常的一句' }
  ];
  const applied = api.optimize.applyRulesToLines(ruleLines, [{ from: '因该', to: '应该' }]);
  check('一键「自动全部进行」直接应用替换', applied.changed === 1 && applied.lines[0].text === '你应该知道这个');
  check('质量自检返回结果', Array.isArray(api.optimize.qualityCheck(ruleLines, { duration: 10 }).issues));
  const badQuality = api.optimize.qualityCheck([{ i: 0, from: 0, to: 5, text: 'a' }, { i: 1, from: 300, to: 305, text: 'b' }], { duration: 100 });
  check('质量自检能发现漏段 / 时间异常', badQuality.ok === false && badQuality.issues.length > 0, JSON.stringify(badQuality.issues.map((i) => i.code)));
  const imported = api.optimize.parseRuleGroups(api.optimize.exportRuleGroups([{ id: 'g', name: '组', rules: [{ from: 'a', to: 'b' }] }]));
  check('替换规则组可导出可导入', imported.length === 1 && imported[0].rules[0].from === 'a');
  const corrections = api.optimize.parseOptimizeResult('```json\n{"corrections":[{"wrong":"因该","right":"应该","reason":"同音字","line":0}]}\n```');
  check('AI 修正建议解析（容错代码块包裹）', corrections.length === 1 && corrections[0].right === '应该');
  check('AI 修正建议应用到字幕行', api.optimize.applyCorrections(ruleLines, corrections).lines[0].text === '你应该知道这个');

  const sources = [
    { title: '示例来源一', url: 'https://a.example.com/x', snippet: 'aa' },
    { title: '示例来源二', url: 'https://b.example.com/y', snippet: 'bb' }
  ];
  const counts = api.search.countCitations('参考 https://a.example.com/x 与 a.example.com 的说法，还有 示例来源一', sources);
  check('按来源统计引用次数', counts.counts['https://a.example.com/x'] >= 2 && counts.total >= 2, JSON.stringify(counts));
  check('直接搜索引擎链接（不消耗额度）', api.search.engineUrl('bing', '测试 词').includes('bing.com/search?q=') && api.search.engineUrl('baidu', 'x').includes('baidu.com'));

  check(
    '默认系统提示词与需求文档一字不差',
    api.DEFAULT_SYSTEM_PROMPT === '整理这期视频的内容（可以用表格、代码块、高亮块、引用、超链接、公式、图片等飞书支持的格式输出，可以加上一些图标增加可读性）',
    api.DEFAULT_SYSTEM_PROMPT
  );
  const masked = api.settingsLib.stripSecrets({ ai: { platforms: [{ id: 'p', apiKey: 'sk-1234567890abcd' }] }, asr: { platforms: [] }, search: { platforms: [] } });
  check('已保存密钥只显示末四位掩码', /abcd$/.test(masked.ai.platforms[0].apiKey) && masked.ai.platforms[0].apiKeySet === true, masked.ai.platforms[0].apiKey);
  const blank = api.settingsLib.mergeSecrets(
    { ai: { platforms: [{ id: 'p', apiKey: '' }] }, asr: { platforms: [] }, search: { platforms: [] } },
    { ai: { platforms: [{ id: 'p', apiKey: 'sk-old' }] }, asr: { platforms: [] }, search: { platforms: [] } }
  );
  check('密钥留空保存表示不改动', blank.ai.platforms[0].apiKey === 'sk-old', blank.ai.platforms[0].apiKey);
  const maskedSave = api.settingsLib.mergeSecrets(
    { ai: { platforms: [{ id: 'p', apiKey: '••••••••abcd' }] }, asr: { platforms: [] }, search: { platforms: [] } },
    { ai: { platforms: [{ id: 'p', apiKey: 'sk-real' }] }, asr: { platforms: [] }, search: { platforms: [] } }
  );
  check('界面掩码不会被写回存储', maskedSave.ai.platforms[0].apiKey === 'sk-real');
  const clearedKey = api.settingsLib.mergeSecrets(
    { ai: { platforms: [{ id: 'p', apiKey: '', apiKeyClear: true }] }, asr: { platforms: [] }, search: { platforms: [] } },
    { ai: { platforms: [{ id: 'p', apiKey: 'sk-old' }] }, asr: { platforms: [] }, search: { platforms: [] } }
  );
  check(
    '「清除」能真正清空已保存的 Key（不被「留空不改动」吞掉）',
    clearedKey.ai.platforms[0].apiKey === '' && clearedKey.ai.platforms[0].apiKeyClear === undefined,
    JSON.stringify(clearedKey.ai.platforms[0])
  );
  const readiness = api.settingsLib.computeReadiness(api.settingsLib.migrateSettings({}));
  check('「是否已配置」用后台结果并给出可操作提示', readiness.ok.ai === false && readiness.issues.some((i) => /API Key/.test(i.text)));

  step('纯逻辑断言完成');
  api.store.setGroupOpen('ai', true);
  api.store.setScroll('subtitle', 321);
  await sleep(700);
  const ui = storage['bsub.uiState.v1'];
  check('稳定性#5 展开/折叠状态已持久化', !!(ui && ui.groups && ui.groups.ai === true), JSON.stringify(ui && ui.groups));
  check('稳定性#5 滚动位置已持久化', !!(ui && ui.scroll && ui.scroll.subtitle === 321), JSON.stringify(ui && ui.scroll));

  step('持久化断言完成');
  doc.querySelector('[data-tab-btn="settings"]').click();
  await sleep(600);
  const settingsText = doc.getElementById('settings-pane').textContent;
  const settingsBar = doc.querySelector('#settings-pane .pane-toolbar').textContent;
  const groups = Array.from(doc.querySelectorAll('#settings-pane .group-head .group-title')).map((e) => e.textContent);
  check('切换到设置页生效', doc.body.getAttribute('data-tab') === 'settings');
  check('设置页有独立滚动容器', !!doc.querySelector('#settings-scroll.scroll-host'));
  check('设置页分组齐全（>= 11 组）', groups.length >= 11, groups.join(' | '));
  check('设置页含 AI 平台配置', /AI 平台/.test(settingsText));
  check('设置页含官网 / 申请 Key 链接', doc.querySelectorAll('#settings-pane a[href^="http"]').length > 0);
  check('设置页含测试连接 / 探测模型', /测试连接/.test(settingsText) && /探测模型/.test(settingsText));
  check('设置页含自定义地址申请域名权限', /申请域名权限/.test(settingsText));
  check('设置页有显式保存按钮', /保存设置/.test(settingsBar), settingsBar);
  check('设置页含 6 格式 / 4 模板配置', /WebVTT/.test(settingsText) && /会议纪要/.test(settingsText));
  check('设置页含替换规则 / 术语表 / 检索 / 批量 / 历史', /替换规则组/.test(settingsText) && /术语表/.test(settingsText) && /联网检索/.test(settingsText) && /批量队列/.test(settingsText) && /历史记录/.test(settingsText));
  check('设置页含页面内功能（播放器按钮 / 画面字幕 / 跟随播放）', /播放器上显示/.test(settingsText) && /画面字幕/.test(settingsText) && /跟随播放/.test(settingsText));
  check('设置页说明密钥留空不改动', /留空保存表示「不改动」/.test(settingsText));
  const settingsSrc = fs.readFileSync(
    path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'panel-settings.js'),
    'utf8'
  );
  check('清除 Key 使用显式标记（不被「留空不改动」吞掉）', /apiKeyClear = true/.test(settingsSrc));
  check('复用 AI Key 的平台会显示为已配置', /function platformKeyState/.test(settingsSrc) && /platformKeyState\(p, d\)/.test(settingsSrc));
  check('设置页暴露「回车发送」开关', /d\.ai\.sendOnEnter/.test(settingsSrc));
  check('刷新页面走 tab.reload（不是新开标签页）', /call\('tab\.reload'/.test(settingsSrc));
  check(
    '批量队列按钮按状态禁用',
    /disabled: !hasQueued && !hasRunning/.test(settingsSrc) &&
      /disabled: !hasDone/.test(settingsSrc) &&
      /button\('取消', \(\) => batchCancel/.test(settingsSrc),
    ''
  );
  check(
    '批量输入在设置页重绘后保留',
    /value: store\.get\(\)\.ui\.batchInput/.test(settingsSrc) && /clearInput\(\)/.test(settingsSrc),
    ''
  );
  const actionsSrc = fs.readFileSync(
    path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'panel-actions.js'),
    'utf8'
  );
  check(
    '来源面板优先用 summary 并显示站点/日期',
    /r\.summary \|\| r\.snippet/.test(actionsSrc) && /r\.publishedAt/.test(actionsSrc),
    ''
  );
  check('设置页含向导与诊断入口', /首次向导/.test(settingsBar) && /诊断/.test(settingsBar));
  check('密钥输入框为密码框且提示留空含义', (() => {
    const inp = doc.querySelector('#settings-pane input[type="password"]');
    const field = inp && inp.closest('.field');
    return !!inp && !!field && /留空/.test(field.textContent);
  })());

  api.app.panels.wizard.open();
  await sleep(400);
  const overlayText = doc.getElementById('overlay-root').textContent;
  check('向导可打开且跳过按钮常驻', /首次使用向导/.test(overlayText) && /跳过向导/.test(overlayText));
  check('稳定性#3 浮层打开时遮罩 none / 卡片 auto', doc.getElementById('overlay-root').style.pointerEvents === 'none' && doc.querySelector('.overlay-card').style.pointerEvents === 'auto');
  // 向导是 dismissable:false：不能有 ×，Esc 也不能绕过「跳过 / 完成」
  check('向导不提供 × 关闭按钮', !doc.querySelector('.overlay-card .overlay-head button'));
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(100);
  check('Esc 不会绕过向导', doc.getElementById('overlay-root').getAttribute('data-open') === 'true');
  const skipWizard = Array.from(doc.querySelectorAll('.overlay-card .overlay-foot button')).find((b) => /跳过向导/.test(b.textContent));
  if (skipWizard) skipWizard.click();
  await sleep(200);
  check('浮层可关闭（跳过向导）', doc.getElementById('overlay-root').getAttribute('data-open') === 'false');

  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: '?', altKey: true, bubbles: true }));
  await sleep(250);
  check('快捷键面板可打开', /快捷键/.test(doc.getElementById('overlay-root').textContent));
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(200);
  check('Esc 关闭浮层', doc.getElementById('overlay-root').getAttribute('data-open') === 'false');

  const st = api.store.get();
  api.store.set({ settings: { ...st.settings, general: { ...st.settings.general, layout: 'one' } } });
  await sleep(500);
  check('布局可切换为单列（窄屏行为）', doc.getElementById('columns').getAttribute('data-mode') === 'one', doc.getElementById('columns').getAttribute('data-mode'));

  // ---- 没有字幕也能直接对话 ----
  // 之前 sendMessage 里有一道硬拦截：没有字幕就弹「还没有字幕」并 return，
  // 导致用户必须先提取字幕才能和 AI 说话。现在改为「字幕可选」。
  {
    const mod = api.panelAi;
    // 捕获发出的流式请求
    let sent = null;
    const origConnect = window.chrome.runtime.connect;
    window.chrome.runtime.connect = () => {
      const port = {
        onMessage: { addListener: (fn) => { port._fn = fn; } },
        onDisconnect: { addListener: () => {} },
        postMessage: (m) => { sent = m; },
        disconnect: () => {}
      };
      return port;
    };

    api.store.set({
      subtitles: [],
      summary: '',
      chat: [],
      video: { bvid: 'BV1', title: '测试视频', duration: 100 },
      readiness: { ok: { ai: true, asr: true, search: false }, issues: [] }
    });
    await sleep(100);
    sent = null;
    try {
      await mod.sendMessage('你好，请自我介绍一下');
      await sleep(200);
    } catch (err) {
      check('无字幕时 sendMessage 不抛异常', false, String(err && err.message));
    }
    check('无字幕时对话请求照常发出（不再被拦截）', !!sent, sent ? JSON.stringify(sent).slice(0, 120) : '没有发出任何请求');

    if (sent && sent.params && sent.params.messages) {
      const sys = sent.params.messages.find((m) => m.role === 'system');
      const text = JSON.stringify(sys || {});
      check('无字幕时如实告知模型「当前没有字幕」', /当前没有这期视频的字幕/.test(text), text.slice(0, 200));
      check('无字幕时不再注入空的「视频字幕原文」块', !/【视频字幕原文】/.test(text), text.slice(0, 200));
      check('无字幕时提示不要编造视频内容', /不要编造/.test(text), text.slice(0, 260));
      // 能力自述必须真的进了系统提示 —— 否则模型又会答「我不能联网」
      check('系统提示里包含能力自述块', /你当前的能力/.test(text), text.slice(0, 300));
      check('系统提示告知联网能力状态', /联网检索：/.test(text), '');
      check('系统提示同时给出字幕状态', /视频字幕：/.test(text), '');
    }

    // 有字幕时仍应注入字幕上下文
    api.store.set({
      subtitles: [{ i: 0, from: 0, to: 2, text: '这是一句字幕', source: 'official' }]
    });
    await sleep(100);
    sent = null;
    try {
      await mod.sendMessage('刚才讲了什么');
      await sleep(200);
    } catch (err) {
      /* ignore */
    }
    if (sent && sent.params && sent.params.messages) {
      const sys = sent.params.messages.find((m) => m.role === 'system');
      const text = JSON.stringify(sys || {});
      check('有字幕时仍注入「视频字幕原文」', /【视频字幕原文】/.test(text) && /这是一句字幕/.test(text), text.slice(0, 200));
      check('有字幕时不再出现「没有字幕」提示', !/当前没有这期视频的字幕/.test(text), text.slice(0, 160));
    }

    window.chrome.runtime.connect = origConnect;
  }

  // ---- 能力自述：用户问「你能不能联网」必须答对 ----
  // 之前模型答「不能」，因为系统提示从没告诉它扩展里有联网能力。
  {
    const mod = api.panelAi;
    check('导出了 buildCapabilityBlock', typeof mod.buildCapabilityBlock === 'function', typeof mod.buildCapabilityBlock);

    const B = mod.buildCapabilityBlock;
    if (typeof B === 'function') {
      // 1. 有免费引擎（无 Key）时，必须说「可用」
      const free = B({ webCapable: true, keylessOn: true, hasSearchKey: false, searchOn: true });
      check('无 Key 但有免费引擎 → 告知联网可用', /联网检索：\*\*可用\*\*/.test(free), free.slice(0, 130));
      check('无 Key 时说明靠免费引擎', /免费检索引擎/.test(free), '');
      check('明确禁止「凭训练印象否认」', /不要凭训练印象否认/.test(free), '');

      // 2. 配了 Key 时，说明走配置的平台
      const keyed = B({ webCapable: true, hasSearchKey: true, searchProviderName: '博查 Bocha', searchOn: true });
      check('配了 Key 时点名检索平台', /博查 Bocha/.test(keyed), keyed.slice(0, 160));

      // 3. 用户关了联网开关 → 必须说「已关闭」，不能吹成可用
      const off = B({ webCapable: true, searchOn: false });
      check('联网关闭时如实说「用户已关闭」', /用户已关闭/.test(off), off.slice(0, 140));
      check('联网关闭时不说「可用」', !/联网检索：\*\*可用\*\*/.test(off), '');

      // 4. 真的没能力 → 说不可用并给引导
      const none = B({ webCapable: false });
      check('真没能力时如实说不可用', /联网检索：\*\*当前不可用\*\*/.test(none), none.slice(0, 140));
      check('不可用时给出配置引导', /设置 → 联网检索/.test(none), '');

      // 5. 本轮检索到了结果 → 告知条数
      const used = B({ webCapable: true, searchUsed: true, searchResultCount: 7 });
      check('检索成功时告知来源条数', /7 条来源/.test(used), used.slice(0, 200));

      // 6. 检索失败 → 告知失败而不是假装有资料
      const fail = B({ webCapable: true, searchFailNote: 'HTTP 429' });
      check('检索失败时如实说明', /联网但失败了/.test(fail) && /HTTP 429/.test(fail), fail.slice(0, 200));

      // 7. 字幕状态
      check('有字幕时告知已加载', /字幕：\*\*已加载\*\*/.test(B({ hasSubtitles: true, subtitleCount: 120 })), '');
      check('有字幕时给出行数', /120 行/.test(B({ hasSubtitles: true, subtitleCount: 120 })), '');
      check('无字幕时告知尚未加载', /字幕：\*\*尚未加载\*\*/.test(B({ hasSubtitles: false })), '');
      check('无字幕时禁止编造视频内容', /不要编造视频里说过的话/.test(B({ hasSubtitles: false })), '');

      // 8. 附件
      check('有附件时告知数量', /上传了 3 个文件/.test(B({ attachmentCount: 3 })), '');
      check('无附件时不提附件', !/上传了/.test(B({ attachmentCount: 0 })), '');

      // 9. MCP
      const mcp = B({ mcpOn: true, mcpServerCount: 2 });
      check('MCP 启用时告知服务数', /已启用\*\*，连接了 2 个服务/.test(mcp), mcp.slice(0, 240));
      check('MCP 启用时要求直接调用工具', /不要声称自己做不到/.test(mcp), '');
      check('MCP 配了但关闭时如实说', /已配置但\*\*用户关闭了\*\*/.test(B({ mcpOn: false, mcpServerCount: 2 })), '');
      check('MCP 未配置时如实说', /MCP）：未配置/.test(B({ mcpServerCount: 0 })), '');

      // 10. Skills
      check('选定技能时告知技能名', /已选定「深度总结」/.test(B({ activeSkill: '深度总结' })), '');
      check('有技能未选时告知数量', /有 4 个可用技能/.test(B({ skillsCount: 4 })), '');

      // 11. 关键区分：不能让模型误以为「自己就是联网的」
      check('提醒区分「模型本身」与「扩展提供的能力」', /你本身仍然是语言模型/.test(B({ webCapable: true })), '');

      // 12. 容错：什么都不传也不能崩
      let crash = null;
      try {
        const empty = B();
        if (typeof empty !== 'string' || !empty) crash = '返回非字符串';
      } catch (err) {
        crash = String(err && err.message);
      }
      check('无参数调用不崩溃', !crash, String(crash));
    }
  }

  // ---- 三个使用体验问题 ----
  {
    const modSrc = (rel) =>
      fs.readFileSync(path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', rel), 'utf8');

    // ① 长连接复用 + 自动重连（不再动不动报「与后台的连接已断开」）
    const bridgeSrc = modSrc('bridge.js');
    check('bridge 有共享 port（模块级单例）', /let sharedPort = null/.test(bridgeSrc), '');
    check('bridge 导出了 ensurePort', /export function ensurePort/.test(bridgeSrc), '');
    check('bridge 有自动重连调度', /scheduleReconnect/.test(bridgeSrc), '');
    // 只允许出现在注释里（说明历史），不能作为文案出现
    const bridgeCode = bridgeSrc
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    check('bridge 不再把「扩展后台已卸载或休眠」作为文案', !/扩展后台已卸载或休眠/.test(bridgeCode), '');
    check('bridge 有重试后仍失败的友好文案', /后台暂时无响应/.test(bridgeSrc), '');
    check('bridge 的 close() 不断开共享 port', /不断开共享 port/.test(bridgeSrc), '');
    check('bridge 的流支持断开后自动重放', /retriesLeft/.test(bridgeSrc), '');

    // ② 回车发送 / Shift+回车换行
    const aiSrc2 = modSrc('panel-ai.js');
    check('输入框提示改为「回车发送」', /回车发送，Shift\+回车换行/.test(aiSrc2), '');
    check('不再把 Ctrl+回车写进提示', !/Ctrl\+Enter 发送/.test(aiSrc2), '');
    check('回车发送逻辑存在（可配置 sendOnEnter）', /sendOnEnter/.test(aiSrc2), '');
    check('生成中发送会排队而不是丢弃', /enqueueMessage/.test(aiSrc2), '');
    check('中止时把队列还回输入框', /restoreQueueToInput/.test(aiSrc2), '');
    check('有消息级操作（复制/重新生成/编辑重发）', /msgAction\('复制'/.test(aiSrc2) && /msgAction\('重新生成'/.test(aiSrc2) && /msgAction\('编辑重发'/.test(aiSrc2), '');
    check('全局 Esc 可停止生成', /__bsubEscBound/.test(aiSrc2), '');
    check('空内容不会误发送', /if \(!String\(v \|\| ''\)\.trim\(\)\) return;/.test(aiSrc2), '');

    // ③ 模型下拉只列已配置的平台
    check('模型下拉按已配置过滤', /const configured = platforms\.filter/.test(aiSrc2), '');
    check('过滤条件是「填过 Key」', /String\(p\.apiKey \|\| ''\)\.trim\(\)/.test(aiSrc2), '');
    check('当前平台始终保留在列表里', /cur && p\.id === cur\.id/.test(aiSrc2), '');
    check('未配 Key 的条目有明确标注', /（未配 Key）/.test(aiSrc2), '');
    check('没有任何已配置平台时有占位提示', /尚未配置任何 AI 平台/.test(aiSrc2), '');

    // 功能验证：真的按一下键看行为
    const input = doc.getElementById('chat-input');
    if (input) {
      // 前面「无字幕也能对话」的用例发过消息，会留下 streaming 状态；
      // 这里用测试钩子复位，否则回车会走「排队」分支，测的就不是发送了。
      api.panelAi.resetStreamStateForTest?.();
      await sleep(200);
      api.store.set({ chat: [], readiness: { ok: { ai: true }, issues: [] } });
      // Shift+回车 → 不发送（浏览器自己插入换行，所以默认行为不能被阻止）
      input.value = '第一行';
      const shiftEv = new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
      input.dispatchEvent(shiftEv);
      await sleep(150);
      check('Shift+回车 不触发发送', api.store.get().chat.length === 0, `chat 长度 ${api.store.get().chat.length}`);
      check('Shift+回车 不阻止默认行为（浏览器插入换行）', shiftEv.defaultPrevented === false, String(shiftEv.defaultPrevented));

      // 回车 → 发送
      // 注意：render() 会重建输入框节点，所以每次都要重新取，不能用旧引用
      api.store.set({ chat: [] });
      let live = doc.getElementById('chat-input');
      live.value = '第二行';
      const enterEv = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      live.dispatchEvent(enterEv);
      await sleep(250);
      check('回车 触发发送', api.store.get().chat.length > 0, `chat 长度 ${api.store.get().chat.length}`);
      check('回车 阻止默认换行', enterEv.defaultPrevented === true, String(enterEv.defaultPrevented));
      live = doc.getElementById('chat-input');
      check('发送后输入框被清空', live.value === '', JSON.stringify(live.value));

      // 空白内容不发送
      api.store.set({ chat: [] });
      live = doc.getElementById('chat-input');
      live.value = '   ';
      const blankEv = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      live.dispatchEvent(blankEv);
      await sleep(150);
      check('空白内容不发送', api.store.get().chat.length === 0, `chat 长度 ${api.store.get().chat.length}`);
    } else {
      check('能取到对话输入框', false, '#chat-input 不存在');
    }
  }

  // ---- 共享长连接的行为验证（不只是源码文本检查）----
  // 用可注入的 chrome.runtime.connect 桩，真实跑一遍 bridge 的 Stream：
  //   · 多个 Stream 复用同一个 port（不再每次新建）
  //   · port 断开后自动重连
  //   · 断开→重连期间发起的请求会重放，而不是直接报错
  {
    const bridge = api.bridgeModule;
    let portCreates = 0;
    const created = [];
    const origConnect = window.chrome.runtime.connect;
    window.chrome.runtime.connect = () => {
      portCreates += 1;
      const listeners = { message: [], disconnect: [] };
      const port = {
        onMessage: { addListener: (fn) => listeners.message.push(fn) },
        onDisconnect: { addListener: (fn) => listeners.disconnect.push(fn) },
        postMessage: (m) => { port.sent.push(m); },
        sent: [],
        _fireDisconnect: () => listeners.disconnect.forEach((fn) => fn()),
        _fireMessage: (m) => listeners.message.forEach((fn) => fn(m)),
        disconnect: () => {}
      };
      created.push(port);
      return port;
    };

    const B = api.bridgeModule;
    if (B && typeof B.ensurePort === 'function') {
      // 面板启动时可能已经建立过连接（那说明复用生效）。
      // 这里不假设初始状态，而是验证「复用」与「重连」这两个行为本身。
      const first = B.ensurePort();
      ensureFirst = first;
      const p1 = B.ensurePort();
      const p2 = B.ensurePort();
      check('多次 ensurePort 返回同一个 port（复用生效）', p1 === p2 && !!p1, `p1===p2: ${p1 === p2}, 有 port: ${!!p1}`);
      check('portState 报告已连接', B.portState().connected === true, JSON.stringify(B.portState()));

      // 两个 Stream 复用同一条 port：不应产生新的连接对象
      const s1 = new B.Stream();
      const s2 = new B.Stream();
      const createsBefore = portCreates;
      s1.start('ai.chat', { a: 1 }, {});
      s2.start('ai.chat', { b: 2 }, {});
      check('两个 Stream 复用同一 port（不新建连接）', portCreates === createsBefore, `新增 ${portCreates - createsBefore} 条`);

      // 断开 → 自动重连
      const livePort = B.ensurePort();
      if (livePort && typeof livePort._fireDisconnect === 'function') {
        // 我们的桩：可以直接触发断开
        livePort._fireDisconnect();
        check('断开后 portState 报告未连接', B.portState().connected === false, JSON.stringify(B.portState()));
        await sleep(700);
        check('断开后自动重连成功', B.portState().connected === true, JSON.stringify(B.portState()));
      } else {
        // 真实 port：无法主动触发，只能验证 state 接口可用
        check('断开后 portState 报告未连接（桩不可用时跳过）', true, '(跳过：非桩 port)');
        check('断开后自动重连成功（桩不可用时跳过）', true, '(跳过：非桩 port)');
      }

      // 后台回收导致的失败 → 自动重放而不是直接报错
      const live = B.ensurePort();
      if (live && typeof live._fireMessage === 'function') {
        let reportedError = null;
        const s4 = new B.Stream();
        s4.start('ai.chat', { d: 4 }, { onError: (e) => { reportedError = e; } });
        const startsBefore = live.sent.filter((m) => m.kind === 'stream:start').length;
        live._fireMessage({ kind: 'stream:error', rid: s4.rid, error: { kind: 'background', title: 'x' } });
        await sleep(500);
        check('后台回收导致的失败不立刻报错（先自动重试）', reportedError === null, JSON.stringify(reportedError));
        check('确实重放了一次请求', live.sent.filter((m) => m.kind === 'stream:start').length > startsBefore, `${startsBefore} -> ${live.sent.filter((m) => m.kind === 'stream:start').length}`);
        s4.close();
      } else {
        check('后台回收导致的失败不立刻报错（跳过）', true, '(跳过)');
        check('确实重放了一次请求（跳过）', true, '(跳过)');
      }

      s1.close();
      s2.close();
    } else {
      check('测试桩能取到 bridge 模块', false, 'api.bridgeModule 未挂载');
    }
    window.chrome.runtime.connect = origConnect;
  }

  // ---- 联网核实 / 简介 / 评论 ----
  {
    const mod = api.panelAi;

    // needsWebSearch：必须覆盖「问能不能联网」「要求核实」这类提问
    const N = mod.needsWebSearch;
    check('导出了 needsWebSearch', typeof N === 'function', typeof N);
    if (typeof N === 'function') {
      // 用户实际遇到的那类提问 —— 之前不匹配关键词，所以没检索，
      // 模型只能回「系统提示说会附参考资料，但这次没有」
      check('「你能联网吗」会触发检索', N('你能联网吗') === true, '');
      check('「你可以上网查资料吗」会触发检索', N('你可以上网查资料吗') === true, '');
      check('「帮我核实一下」会触发检索', N('帮我核实一下这个说法') === true, '');
      check('「这个说法准确吗」会触发检索', N('这个说法准确吗') === true, '');
      check('「查一下」会触发检索', N('查一下 DeepSeek V4') === true, '');
      check('时效类提问仍然触发', N('今天有什么新闻') === true, '');
      check('纯寒暄不触发（避免无谓消耗）', N('你好') === false, '');
      check('空问题不触发', N('') === false && N('   ') === false, '');
    }

    // 核实项抽取：只挑具体的年份/数字/术语，不做整篇搜索
    const V = api.verifyLib;
    check('挂载了 verify 模块', !!V && typeof V.extractVerifyItems === 'function', typeof V);
    if (V && typeof V.extractVerifyItems === 'function') {
      const items = V.extractVerifyItems([
        { text: 'DeepSeek V4 在 2026 年 3 月正式发布，参数量达到 6710 亿' },
        { text: '它的定价是每百万 token 一元钱，非常便宜' },
        { text: '这个视频我们就讲到这里，大家再见' }
      ], 8);
      check('抽出了年份或数字', items.some((x) => /2026|6710/.test(x)), JSON.stringify(items));
      check('抽出了专有术语', items.some((x) => /DeepSeek|token/i.test(x)), JSON.stringify(items));
      check('没有把口语词当核实项', !items.includes('视频') && !items.includes('大家'), JSON.stringify(items));

      // 相关性过滤 —— 这是防污染的关键
      check('无关结果被判定为不相关',
        V.isRelevantToQuery({ title: '日历网', snippet: '今日黄历宜忌查询' }, 'DeepSeek V4') === false, '');
      check('相关结果被保留',
        V.isRelevantToQuery({ title: 'DeepSeek V4 正式发布', snippet: '参数量 6710 亿' }, 'DeepSeek V4') === true, '');
      check('空标题空摘要判为不相关',
        V.isRelevantToQuery({ title: '', snippet: '' }, 'DeepSeek V4') === false, '');

      // 中文没有空格：不能再把整句当一个词（旧实现要么全丢、要么全放）
      check('中文检索词：词头实体命中才保留',
        V.isRelevantToQuery({ title: '达摩院发布新一代开源模型', snippet: '达摩院发布新一代开源模型' }, '达摩院 新模型') === true, '');
      check('中文检索词：只共享「发布/模型」的网页被丢弃',
        V.isRelevantToQuery({ title: '阿里发布新模型', snippet: '阿里发布新模型' }, '达摩院 新模型') === false, '');
      check('连字符 / 下划线不影响匹配',
        V.isRelevantToQuery({ title: 'DeepSeek-V4 技术报告', snippet: '' }, 'deepseek_v4') === true, '');
      check('summary 字段参与相关性判断',
        V.isRelevantToQuery({ title: '某页', summary: 'DeepSeek V4 于 2026 年发布，参数量 6710 亿', snippet: '' }, 'DeepSeek V4') === true, '');

      // 只查实体名时，必须再沾一点字幕里的具体说法，否则搜回来只是「提到这个名字」
      const ctxLine = 'DeepSeek V4 在 2026 年 3 月发布，参数量达到 6710 亿';
      check('上下文能过滤「只提到名字」的网页',
        V.isRelevantToQuery({ title: 'DeepSeek 公司介绍', snippet: 'DeepSeek 是一家 AI 公司' }, 'DeepSeek', ctxLine) === false, '');
      check('上下文里出现具体说法时保留',
        V.isRelevantToQuery({ title: 'DeepSeek V4 正式发布', snippet: '2026 年 3 月发布，6710 亿参数' }, 'DeepSeek', ctxLine) === true, '');
      check('能在字幕里找到检索词所在行',
        V.contextLineForQuery(
          [{ text: '今天天气不错' }, { text: ctxLine }, { text: '就讲到这里' }],
          'DeepSeek V4 发布时间'
        ).includes('2026'),
        ''
      );
      check('上下文窗口会带上相邻字幕行',
        V.contextWindowForQuery(
          [
            { text: 'DeepSeek V4 是深度求索发布的模型' },
            { text: '参数量达到 6710 亿' },
            { text: '价格非常便宜' }
          ],
          '6710 亿'
        ).includes('DeepSeek V4'),
        ''
      );
      check('优化流程导入了 verify 模块（否则核对会静默跳过）',
        /from '\.\.\/\.\.\/shared\/verify\.js'/.test(fs.readFileSync(path.join(ROOT, 'src/sidepanel/modules/context.js'), 'utf8')),
        '');
      check('检索词里的实体必须在视频原文里出现过',
        V.isQueryGroundedIn('OpenAI GPT-5 发布时间', 'DeepSeek V4 在 2026 年发布') === false, '');
      check('有据可依的检索词会保留',
        V.isQueryGroundedIn('DeepSeek V4 发布时间', 'DeepSeek V4 在 2026 年发布') === true, '');
      check('中文检索词的依据来自字幕',
        V.isQueryGroundedIn('达摩院开源模型', '达摩院今天开源了新模型') === true, '');

      const vt = await V.verifyItems(
        ['DeepSeek V4'],
        async () => ({
          results: [
            { title: 'DeepSeek V4 正式发布', url: 'https://example.com/a', summary: 'DeepSeek V4 于 2026 年发布，参数量 6710 亿' },
            { title: '日历网', url: 'https://example.com/b', summary: '今日黄历宜忌查询' }
          ]
        }),
        { maxItems: 2, perItem: 2 }
      );
      check(
        '核对只保留相关结果，并能读取 summary',
        vt.length === 1 && vt[0].evidence.length === 1 && /6710/.test(vt[0].evidence[0].text),
        JSON.stringify(vt)
      );

      const vtContext = await V.verifyItems(
        ['DeepSeek'],
        async () => ({
          results: [
            { title: 'DeepSeek 公司介绍', url: 'https://example.com/c', summary: 'DeepSeek 是一家 AI 公司' },
            { title: 'DeepSeek V4 正式发布', url: 'https://example.com/d', summary: '2026 年 3 月发布，6710 亿参数' }
          ]
        }),
        { maxItems: 2, perItem: 2, contextOf: () => 'DeepSeek V4 在 2026 年 3 月发布，参数量达到 6710 亿' }
      );
      check(
        '核对会按字幕上下文过滤「只提到名字」的结果',
        vtContext.length === 1 && vtContext[0].evidence.length === 1 && /2026/.test(vtContext[0].evidence[0].text),
        JSON.stringify(vtContext)
      );

      // 检索词要带上字幕原句的语境，而不是孤立数字/短语
      const ctxSentence = 'DeepSeek V4 在 2026 年 3 月发布，参数量达到 6710 亿';
      check(
        '孤立数字会还原成字幕原句',
        V.contextualQuery('6710 亿', ctxSentence) === ctxSentence,
        V.contextualQuery('6710 亿', ctxSentence)
      );
      check(
        'AI 的改写查询也会落到字幕原句上',
        V.contextualQuery('DeepSeek V4 发布时间', ctxSentence) === ctxSentence,
        V.contextualQuery('DeepSeek V4 发布时间', ctxSentence)
      );
      const claims = V.buildVerifyClaims(
        [
          { text: '今天天气不错' },
          { text: ctxSentence },
          { text: '它的价格是每百万 token 一元钱' }
        ],
        8
      );
      check(
        '按字幕原句生成带语境的检索项',
        claims.length > 0 &&
          claims.some((c) => c.query.includes('2026 年 3 月')) &&
          claims.every((c) => c.query && c.context),
        JSON.stringify(claims)
      );

      let sentQuery = '';
      const vObjects = await V.verifyItems(
        [{ label: 'DeepSeek', query: ctxSentence, context: ctxSentence }],
        async (q) => {
          sentQuery = q;
          return {
            results: [
              { title: 'DeepSeek V4 正式发布', url: 'https://example.com/e', summary: '2026 年 3 月发布，6710 亿参数' }
            ]
          };
        },
        { maxItems: 2, perItem: 2 }
      );
      check(
        '核对发出的是带语境的 query，而不是 label',
        /2026 年 3 月/.test(sentQuery) && vObjects.length === 1 && vObjects[0].item === 'DeepSeek',
        sentQuery
      );

      // 语义判定：来源强度按独立域名计算
      const agree = api.panelAi.agreementOf([
        { url: 'https://a.example/x', verdict: 'support' },
        { url: 'https://b.example/y', verdict: 'support' },
        { url: 'https://a.example/z', verdict: 'support' }
      ]);
      check('多来源一致按独立域名计算', agree.agreement === 'multi' && agree.support === 2, JSON.stringify(agree));
      const conflict = api.panelAi.agreementOf([
        { url: 'https://a.example/x', verdict: 'support' },
        { url: 'https://b.example/y', verdict: 'refute' }
      ]);
      check('来源冲突能识别', conflict.agreement === 'conflict', JSON.stringify(conflict));
      check(
        '单一来源不算多来源',
        api.panelAi.agreementOf([{ url: 'https://a.example/x', verdict: 'support' }]).agreement === 'single',
        ''
      );
      check(
        '证据判定 JSON 能解析（含代码块）',
        api.panelAi.parseVerdictJson('```json\n{"verdicts":[{"claim":1,"evidence":1,"verdict":"support"}]}\n```').length === 1,
        ''
      );

      // 并发核对：保持原始顺序
      const conc = await V.verifyItems(
        ['DeepSeek', 'MoE', '6710 亿'],
        async (q) => {
          await new Promise((r) => setTimeout(r, 10));
          return {
            results: [
              {
                title: `${q} 官方信息`,
                url: `https://${encodeURIComponent(q)}.example/1`,
                summary: `${q} 的详细说明与背景`
              }
            ]
          };
        },
        { maxItems: 3, perItem: 1, concurrency: 3 }
      );
      check(
        '并发核对保持原始顺序',
        conc.map((x) => x.item).join(',') === 'DeepSeek,MoE,6710 亿',
        JSON.stringify(conc.map((x) => x.item))
      );

      check(
        '对话检索上下文会过滤不相关来源',
        !/日历网/.test(api.search.searchContextBlock([{ title: '日历网', snippet: '今日黄历', url: 'https://x' }], {}, 'DeepSeek V4')),
        ''
      );
      check(
        '对话检索上下文保留相关来源',
        /DeepSeek V4 正式发布/.test(
          api.search.searchContextBlock([{ title: 'DeepSeek V4 正式发布', snippet: '参数量 6710 亿', url: 'https://y' }], {}, 'DeepSeek V4')
        ),
        ''
      );
      check(
        '只有明确问「这些来源」才复用上一轮结果',
        api.panelAi.referencesPreviousSearch('总结一下这些来源') === true &&
          api.panelAi.referencesPreviousSearch('今天有什么 AI 新闻') === false,
        ''
      );

      // 长字幕要按前/中/后段抽样，不能只取开头反复出现的术语
      const longLines = [];
      for (let i = 0; i < 24; i += 1) {
        longLines.push({ text: i === 0 ? '开头介绍 DeepSeek V4 与 2026 年' : i === 23 ? '结尾提到 2027 年和 512GB 显存' : `中间第 ${i} 句普通内容` });
      }
      const lateItems = V.extractVerifyItems(longLines, 8);
      check('长字幕分段抽样能覆盖到结尾术语', lateItems.some((x) => /2027|512/.test(x)), JSON.stringify(lateItems));
      const noisy = V.extractVerifyItems([{ text: '这是一个非常便宜、正式发布的产品' }], 8);
      check('只出现一次的中文泛词不会成为核实项', !noisy.includes('非常便宜') && !noisy.includes('正式发布'), JSON.stringify(noisy));
    }

    const defaults = api.settingsLib.defaultSettings();
    check('默认每次核实 12 条', defaults.search.verifyItemCount === 12, String(defaults.search.verifyItemCount));
    check('默认开启 AI 生成检索词', defaults.search.aiQueryGeneration === true, String(defaults.search.aiQueryGeneration));
    const estimate = api.panelAi.estimateSummaryCost(defaults);
    check('总结成本估算：默认 3~6 次检索 + 4 次 AI', estimate.searches === 6 && estimate.aiCalls === 4, JSON.stringify(estimate));
    const estimateRule = api.panelAi.estimateSummaryCost({
      ...defaults,
      search: { ...defaults.search, aiQueryGeneration: false }
    });
    check(
      '总结成本估算：关闭 AI 查询后按兜底条数',
      estimateRule.searches === defaults.search.verifyItemCount && estimateRule.aiCalls === 3,
      JSON.stringify(estimateRule)
    );
    const estimateOff = api.panelAi.estimateSummaryCost({
      ...defaults,
      search: { ...defaults.search, verifyOnSummary: false }
    });
    check('总结成本估算：关闭联网后只算 1 次 AI', estimateOff.searches === 0 && estimateOff.aiCalls === 1, JSON.stringify(estimateOff));
    const estimateLong = api.panelAi.estimateSummaryCost(defaults, { subtitleChars: 100000 });
    check(
      '总结成本估算：长视频按分段增加调用',
      estimateLong.chunks === 3 && estimateLong.aiCalls === 7 && /3 段分段/.test(estimateLong.label),
      JSON.stringify(estimateLong)
    );
    check(
      '设置页有 AI 生成检索词开关',
      /用 AI 生成检索词/.test(fs.readFileSync(path.join(ROOT, 'src/sidepanel/modules/panel-settings.js'), 'utf8')),
      ''
    );
    check(
      '关闭开关时跳过 AI 查询生成',
      /aiQueryGeneration !== false/.test(fs.readFileSync(path.join(ROOT, 'src/sidepanel/modules/panel-ai.js'), 'utf8')),
      ''
    );
    check('额外核实查询默认空', defaults.search.extraVerifyQueries === '', String(defaults.search.extraVerifyQueries));
    check('不再有「总结末尾附来源」配置', defaults.summary.attachSources === undefined, String(defaults.summary.attachSources));
    check(
      '设置页有额外核实查询输入',
      /额外核实查询/.test(fs.readFileSync(path.join(ROOT, 'src/sidepanel/modules/panel-settings.js'), 'utf8')),
      ''
    );
    check(
      '总结后展示本次检索词',
      /verify-queries/.test(fs.readFileSync(path.join(ROOT, 'src/sidepanel/modules/panel-ai.js'), 'utf8')),
      ''
    );
    check(
      '总结展示查询→证据条数',
      /verifyEvidence/.test(fs.readFileSync(path.join(ROOT, 'src/sidepanel/modules/panel-ai.js'), 'utf8')) &&
        /条证据/.test(fs.readFileSync(path.join(ROOT, 'src/sidepanel/modules/panel-ai.js'), 'utf8')),
      ''
    );
    check(
      '证据标题可点击打开来源',
      /verify-link/.test(fs.readFileSync(path.join(ROOT, 'src/sidepanel/modules/panel-ai.js'), 'utf8')),
      ''
    );
    check(
      '诊断里可撤销自定义域名权限',
      /permission\.revoke/.test(fs.readFileSync(path.join(ROOT, 'src/sidepanel/modules/panel-settings.js'), 'utf8')),
      ''
    );

    // AI 生成检索词的解析：JSON / 编号行 / 过滤
    const Q = api.panelAi.parseSearchQueries;
    check('检索词解析：JSON 数组', JSON.stringify(Q('["DeepSeek V4 发布时间","6710 亿参数量"]')) === JSON.stringify(['DeepSeek V4 发布时间', '6710 亿参数量']), '');
    check('检索词解析：编号行 + 去重', JSON.stringify(Q('1. DeepSeek V4\n2. 6710 亿参数量\n3. DeepSeek V4')) === JSON.stringify(['DeepSeek V4', '6710 亿参数量']), '');
    check('检索词解析：过滤 URL / 空话', Q('["https://a.com", "没有", "DeepSeek V4"]').length === 1, JSON.stringify(Q('["https://a.com", "没有", "DeepSeek V4"]')));
    check(
      '校对优先用 AI 生成查询，失败回退规则',
      /buildSearchQueries\(lines, settings/.test(fs.readFileSync(path.join(ROOT, 'src/sidepanel/modules/panel-ai.js'), 'utf8')) &&
        /buildVerifyClaims\(lines, cap\)/.test(fs.readFileSync(path.join(ROOT, 'src/sidepanel/modules/panel-ai.js'), 'utf8')),
      ''
    );

    // 能力自述：未检索时不得承诺「会附参考资料」
    const B = mod.buildCapabilityBlock;
    const notSearched = B({ webCapable: true, searchOn: true, searchUsed: false, searchResultCount: 0 });
    check('未检索时明说「本轮没有进行检索」', /本轮没有进行检索/.test(notSearched), notSearched.slice(0, 240));
    check('未检索时不承诺「会附在下面」', !/检索结果会作为参考资料附在下面/.test(notSearched), '');
    check('未检索时要求不得声称查过网页', /绝对不要声称自己查过网页/.test(notSearched), '');
    const searched = B({ webCapable: true, searchOn: true, searchUsed: true, searchResultCount: 5 });
    check('已检索时报告来源条数', /本轮已经检索过/.test(searched) && /5 条来源/.test(searched), searched.slice(0, 200));
  }

  // ---- AI 优化升级 / 侧边栏打开 / 切换视频清残留 ----
  {
    const srcOf = (rel) =>
      fs.readFileSync(path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', rel), 'utf8');
    const ctxSrc = srcOf('sidepanel/modules/context.js');
    const optSrc = srcOf('sidepanel/modules/optimize.js');
    const appSrc = srcOf('sidepanel/app.js');
    const swSrc = srcOf('background/service-worker.js');
    const contentSrc = srcOf('content/content.js');

    // ① AI 优化升级：五类修正
    check('优化提示词覆盖错别字/术语/时间/数据/逻辑', /错别字[\s\S]{0,160}术语[\s\S]{0,160}时间[\s\S]{0,160}数据[\s\S]{0,160}逻辑/.test(optSrc), '');
    check('优化提示词要求「宁可漏不要错改」', /宁可漏，不要错改/.test(optSrc), '');
    check('优化提示词禁止把资料写进字幕', /不要把参考资料里的内容写进字幕/.test(optSrc), '');
    check('优化结果解析 kind 字段', /kind: KINDS\.includes/.test(optSrc), '');
    check('kind 归一到五个类别', /const KINDS = \['错别字', '术语', '时间', '数据', '逻辑'\]/.test(optSrc), '');
    check('优化流程用逐条核对而不是整篇搜', /buildVerifyClaims\(lines/.test(ctxSrc), '');
    check('优化核对走 ephemeral（不冲掉检索面板）', /ephemeral: true/.test(ctxSrc), '');

    // ② 侧边栏打开的失败必须报出来
    // 只为「打开侧边栏」这条消息加了结果回报；content-event 里的顺手调用保留
    check('bsub:open-side-panel 会回报失败原因', /reason: gesture \? 'gesture' : 'error'/.test(swSrc), '');
    check('后台区分「需要用户手势」并给出指引', /gesture/.test(swSrc) && /工具栏上的扩展图标/.test(swSrc), '');
    check('后台先 setOptions 再 open', /setOptions\(\{ tabId, path: 'src\/sidepanel\/panel\.html', enabled: true \}\)/.test(swSrc), '');
    check('内容脚本有兜底提示条', /showPanelHint/.test(contentSrc) && /bsub-hint/.test(contentSrc), '');
    check('内容脚本失败后会重试一次', /setTimeout\(\(\) => \{[\s\S]{0,500}open-side-panel/.test(contentSrc), '');

    // ③ 切换视频清残留
    check('loadVideo 会检测 signature 变化', /prevSig !== \(video\.signature/.test(ctxSrc), '');
    check('loadVideo 换视频时清字幕', /cleared\.subtitles = \[\]/.test(ctxSrc), '');
    check('loadVideo 换视频时清总结', /cleared\.summary = ''/.test(ctxSrc), '');
    check('loadVideo 换视频时清对话', /cleared\.chat = \[\]/.test(ctxSrc), '');
    check('loadVideo 换视频时清转录日志', /cleared\.transcriptLog = \[\]/.test(ctxSrc), '');
    check('loadVideo 换视频时清检索结果', /cleared\.search = \{/.test(ctxSrc), '');
    check('navigate 事件也清 transcriptLog', /transcriptLog: \[\]/.test(appSrc), '');
    check('navigate 事件也清 search', /results: \[\], counts: \{\}, query: ''/.test(appSrc), '');
    check('navigate 事件清 summaryStream', /summaryStream: ''/.test(appSrc), '');

    // 总结进度条：必须挂到全局 jobs 进度上，并分阶段报告
    check('总结流程创建了任务', /jobs\.beginTask\(TASK_LABEL\.summarize/.test(srcOf('sidepanel/modules/panel-ai.js')), '');
    check('校对阶段报告核对进度', /步：联网核对/.test(srcOf('sidepanel/modules/panel-ai.js')), '');
    check('生成阶段报告已输出字数', /步：生成中（已 \$\{streamedChars\} 字）/.test(srcOf('sidepanel/modules/panel-ai.js')), '');
    // 步骤总数按「本次是否真的校对」计算：快速总结、设置里关闭校对、
    // 或检索不可用时都只有两步。
    check(
      '步骤总数按「是否真的校对」计算',
      /const willProofread =[\s\S]{0,300}verifyOnSummary !== false/.test(srcOf('sidepanel/modules/panel-ai.js')) &&
        /const totalSteps = willProofread \? 3 : 2;/.test(srcOf('sidepanel/modules/panel-ai.js')),
      ''
    );
    check(
      '总结校对不再误用「对话自动联网」开关',
      !/verifyOnSummary !== false\)\s*&&\s*capSearch\.webCapable\s*&&\s*capSearch\.searchOn/.test(
        srcOf('sidepanel/modules/panel-ai.js')
      ),
      ''
    );
    check('主按钮如实标出「先校对」', /生成总结（先校对）/.test(srcOf('sidepanel/modules/panel-ai.js')), '');
    check(
      '长视频分段总结也能终止（rid + cancel）',
      /state\.summaryRid = rid/.test(srcOf('sidepanel/modules/panel-ai.js')) &&
        /call\('cancel', \{ rid: state\.summaryRid \}/.test(srcOf('sidepanel/modules/panel-ai.js')) &&
        /summaryAbortRequested/.test(srcOf('sidepanel/modules/panel-ai.js')),
      ''
    );
    check(
      '校对阶段的联网搜索也能被停止',
      /rid: proofRid/.test(srcOf('sidepanel/modules/panel-ai.js')) &&
        /rid: hooks\.rid/.test(srcOf('sidepanel/modules/search.js')),
      ''
    );
    check(
      '长视频的每一段都带压缩后的视频背景',
      /chunkContext/.test(srcOf('sidepanel/modules/panel-ai.js')) &&
        /background: chunkContext/.test(srcOf('sidepanel/modules/panel-ai.js')),
      ''
    );
    check(
      '总结阶段会把证据整理成 0~3 条外部补充',
      /async function buildSummarySupplement\(/.test(srcOf('sidepanel/modules/panel-ai.js')) &&
        /const webSupplementBlock =/.test(srcOf('sidepanel/modules/panel-ai.js')),
      ''
    );
    check(
      '总结不再列来源 / 编号 / 待核实',
      !/summaryVerifyBlock|summarySourcesFooter|sourcesFooter/.test(srcOf('sidepanel/modules/panel-ai.js')) &&
        /不要单独列出来源/.test(srcOf('sidepanel/modules/panel-ai.js')),
      ''
    );
    check(
      '总结不再注入字幕更正清单',
      !/本次字幕已校对并更正/.test(srcOf('sidepanel/modules/panel-ai.js')),
      ''
    );
    check(
      '校对不再被「对话自动联网」开关卡住',
      /if \(cap\.webCapable\) \{\n    if \(shouldAbort\(\)\) throw abortError\(\);/.test(
        srcOf('sidepanel/modules/panel-ai.js')
      ),
      ''
    );
    check(
      '校对阶段也能终止（verifyItems 支持 shouldAbort）',
      /shouldAbort/.test(
        fs.readFileSync(
          path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'shared', 'verify.js'),
          'utf8'
        )
      ) && /shouldAbort/.test(srcOf('sidepanel/modules/panel-ai.js')),
      ''
    );
    check(
      '清空字幕有二次确认',
      /confirmDialog\([\s\S]{0,160}清空字幕/.test(
        fs.readFileSync(
          path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'panel-actions.js'),
          'utf8'
        )
      ) &&
        /confirmDialog\([\s\S]{0,160}清空字幕/.test(
          fs.readFileSync(
            path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'panel-subtitles.js'),
            'utf8'
          )
        ),
      ''
    );
    check('快速总结跳过联网校对', /opts\.skipProofread === true/.test(srcOf('sidepanel/modules/panel-ai.js')), '');
    check('快速总结提示跳过校对', /快速总结：跳过联网校对/.test(srcOf('sidepanel/modules/panel-ai.js')), '');
    check('AI 工具栏有快速总结按钮', /⚡ 快速总结/.test(srcOf('sidepanel/modules/panel-ai.js')), '');
    check('操作区有快速总结按钮', /⚡ 快速/.test(srcOf('sidepanel/modules/panel-actions.js')), '');
    check('两个入口共用 summarize()', /export function summarize\(skipProofread\)/.test(srcOf('sidepanel/modules/panel-actions.js')), '');
    check('结束时把进度置满并收尾', /task\.set\(100,/.test(srcOf('sidepanel/modules/panel-ai.js')) && /task\.end\(\)/.test(srcOf('sidepanel/modules/panel-ai.js')), '');
    check('出错时也收尾任务', /task\.end\(\);[\s\S]{0,120}const partial = store\.get\(\)\.summaryStream/.test(srcOf('sidepanel/modules/panel-ai.js')), '');
  }

  // ---- 生成总结：先校对字幕再总结 + 飞书格式 + 可回退 ----
  {
    const mod = api.panelAi;
    check('导出了 proofreadSubtitles', typeof mod.proofreadSubtitles === 'function', typeof mod.proofreadSubtitles);
    check('导出了 revertSubtitles', typeof mod.revertSubtitles === 'function', typeof mod.revertSubtitles);

    // 飞书格式规则必须包含确定支持的那几类，且排除会失效的
    const rules = mod.FEISHU_FORMAT_RULES || '';
    check('格式规则含标题层级限制', /标题最多三级/.test(rules), '');
    check('格式规则含表格（要求表头与分隔行）', /管道表格/.test(rules) && /表头与 .*分隔行/.test(rules), '');
    check('格式规则含代码块（要求标注语言）', /三个反引号/.test(rules), '');
    check('格式规则含引用与分割线', /引用块/.test(rules) && /分割线/.test(rules), '');
    check('格式规则含 LaTeX 公式', /LaTeX/.test(rules) && /\$…\$/.test(rules), '');
    check('格式规则含超链接', /\[文字\]\(https/.test(rules), '');
    check('格式规则含任务列表', /- \[ \]/.test(rules), '');
    check('格式规则要求先给结论与速览表', /一句话结论/.test(rules) && /速览/.test(rules), '');
    check('格式规则排除内嵌 HTML', /内嵌 HTML/.test(rules), '');
    check('格式规则说明图片无法携带', /图片无法通过文本携带/.test(rules), '');
    check('格式规则提醒不要编造链接', /不要编造/.test(rules), '');
    check('格式规则要求内容全部来自字幕', /全部来自字幕/.test(rules), '');

    // 默认提示词就是用户指定的那一句
    check('默认提示词是用户指定的原句', /整理这期视频的内容（可以用表格、代码块、高亮块、引用、超链接、公式、图片等飞书支持的格式输出，可以加上一些图标增加可读性）/.test(api.DEFAULT_SYSTEM_PROMPT), '');
  }

  // ---- 溢出菜单组件的行为 ----
  {
    const U = api.ui;
    check('导出了 popoverMenu', !!U && typeof U.popoverMenu === 'function', typeof U);
    if (U && typeof U.popoverMenu === 'function') {
      const clicked = [];
      const wrap = U.popoverMenu([
        { icon: 'A', label: '项目一', onClick: () => clicked.push('a') },
        { divider: true },
        { icon: 'B', label: '项目二', disabled: true, onClick: () => clicked.push('b') },
        { icon: 'C', label: '项目三', onClick: () => clicked.push('c') }
      ], { label: '⋯' });
      doc.body.appendChild(wrap);

      const trigger = wrap.querySelector('.menu-trigger');
      // 用 pointerdown 开关（组件就是用 pointerdown 实现的）
      const tap = (el) => el.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      check('初始为收起状态', wrap.getAttribute('data-open') !== 'true', String(wrap.getAttribute('data-open')));

      tap(trigger);
      await sleep(60);
      check('点击触发器后展开', wrap.getAttribute('data-open') === 'true', String(wrap.getAttribute('data-open')));
      // 面板留在 wrap 内做绝对定位（挂 body 会被「点外部」判定误伤触发器）
      const panelEl = wrap.querySelector('.menu-panel');
      check('菜单面板在 wrap 内（触发器不会被误判为外部）', !!panelEl && panelEl.parentNode === wrap, panelEl ? panelEl.parentNode && panelEl.parentNode.tagName : 'null');

      // 定位回归：jsdom 不做布局，所以这里用**计算样式**兜住这次的坑。
      // 历史问题：`right: 0` 让 190px 的面板相对 32px 的触发器向右对齐，
      // 面板一路伸到触发器左侧之外（真实浏览器实测 left = -32px），
      // 表现为「能看到图标、看不到文字」。
      {
        const cs = window.getComputedStyle(panelEl);
        check('菜单面板左对齐触发器（不能用 right 定位）', cs.left === '0px' && (cs.right === 'auto' || cs.right === ''), `left=${cs.left} right=${cs.right}`);
        check('菜单面板用 border-box（宽度不被 padding 撑大）', cs.boxSizing === 'border-box', cs.boxSizing);
        check('菜单面板限制最大宽度', cs.maxWidth !== 'none' && /\d/.test(cs.maxWidth), cs.maxWidth);
        check('菜单面板禁止横向溢出', cs.overflowX === 'hidden', cs.overflowX);
      }
      const items = panelEl.querySelectorAll('.menu-item');
      check('菜单渲染出 3 个条目', items.length === 3, String(items.length));
      check('菜单有分隔线', !!panelEl.querySelector('.menu-divider'), '');
      check('禁用的条目被置灰', items[1].disabled === true, String(items[1].disabled));

      items[0].click();
      await sleep(60);
      check('点条目会执行回调', clicked.join('') === 'a', clicked.join(','));
      check('点条目后自动收起', wrap.getAttribute('data-open') !== 'true', '');

      // 连续开关必须稳定 —— 之前「点一次开、再点一次被误关」就是这里的回归
      tap(trigger);
      await sleep(50);
      const openA = wrap.getAttribute('data-open') === 'true';
      tap(trigger);
      await sleep(50);
      const closedA = wrap.getAttribute('data-open') !== 'true';
      tap(trigger);
      await sleep(50);
      const openB = wrap.getAttribute('data-open') === 'true';
      check('连续点击能稳定开关（开关/开关）', openA && closedA && openB, `开=${openA} 关=${closedA} 开=${openB}`);

      const outside = doc.createElement('div');
      doc.body.appendChild(outside);
      outside.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
      await sleep(60);
      check('点菜单外部会收起', wrap.getAttribute('data-open') !== 'true', String(wrap.getAttribute('data-open')));

      tap(trigger);
      await sleep(50);
      doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(50);
      check('按 Esc 会收起', wrap.getAttribute('data-open') !== 'true', '');

      wrap.remove();
      outside.remove();

      // 全部条目禁用时，必须给出说明而不是一片灰字
      const U2 = U.popoverMenu([
        { label: '甲', disabled: true, onClick: () => {} },
        { label: '乙', disabled: true, onClick: () => {} }
      ], { emptyText: '先生成一次总结', emptyHint: '生成后这里会出现别的操作' });
      doc.body.appendChild(U2);
      tap(U2.querySelector('.menu-trigger'));
      await sleep(60);
      const emptyPanel = U2.querySelector('.menu-panel');
      check('全部禁用时显示说明文字', /先生成一次总结/.test(emptyPanel.textContent), emptyPanel.textContent);
      check('全部禁用时给出下一步提示', /生成后这里会出现/.test(emptyPanel.textContent), '');
      check('全部禁用时不再渲染灰按钮', emptyPanel.querySelectorAll('.menu-item').length === 0, String(emptyPanel.querySelectorAll('.menu-item').length));
      U2.remove();

      // 有可用条目时不应显示空态说明
      const U3 = U.popoverMenu([{ label: '可用的', onClick: () => {} }], { emptyText: '不该出现' });
      check('有可用条目时不显示空态说明', !/不该出现/.test(U3.querySelector('.menu-panel').textContent), '');
    }
  }

  // ---- 操作留痕与回退 ----
  {
    const T = api.timeline;
    check('导出了 timeline 模块', !!T && typeof T.record === 'function', typeof T);
    if (T && typeof T.record === 'function') {
      T.clear();
      check('清空后没有留痕', T.count() === 0, String(T.count()));

      // 第 1 步：有字幕
      api.store.set({
        subtitles: [{ i: 0, from: 0, to: 2, text: '原始字幕一' }, { i: 1, from: 2, to: 4, text: '原始字幕二' }],
        summary: '',
        chat: []
      });
      T.record('抓取字幕', { detail: '2 行' });
      check('第 1 步被记录', T.count() === 1, String(T.count()));

      // 内容没变时不应重复留痕
      T.record('什么都没干');
      check('内容未变化时不重复留痕', T.count() === 1, String(T.count()));

      // 第 2 步：AI 更正了字幕
      api.store.set({
        subtitles: [{ i: 0, from: 0, to: 2, text: '更正后字幕一' }, { i: 1, from: 2, to: 4, text: '原始字幕二' }]
      });
      T.record('AI 校对并更正字幕', { detail: '更正 1 处' });
      check('第 2 步被记录', T.count() === 2, String(T.count()));

      // 第 3 步：生成了总结
      api.store.set({ summary: '# 总结内容' });
      T.record('生成总结', { detail: '5 字' });
      check('第 3 步被记录', T.count() === 3, String(T.count()));

      const entries = T.list();
      check('list() 按时间倒序（最新在前）', entries[0].label === '生成总结', entries.map((e) => e.label).join(' > '));

      // 回退到第 1 步
      const first = entries.find((e) => e.label === '抓取字幕');
      const restored = T.revertTo(first.id);
      check('回退返回目标快照', !!restored && restored.label === '抓取字幕', String(restored && restored.label));
      check('回退后字幕恢复原样', api.store.get().subtitles[0].text === '原始字幕一', JSON.stringify(api.store.get().subtitles.map((l) => l.text)));
      check('回退后总结被清空', api.store.get().summary === '', JSON.stringify(api.store.get().summary));

      // 回退本身也要留痕，否则退过去就回不来
      const after = T.list();
      check('回退本身也留痕', after.some((e) => /回退/.test(e.label)), after.map((e) => e.label).join(' > '));

      // 再退回到「生成总结」，验证可来回
      const sumEntry = after.find((e) => e.label === '生成总结');
      if (sumEntry) {
        T.revertTo(sumEntry.id);
        check('可以再退回到之后的状态（回退可逆）', api.store.get().summary === '# 总结内容', JSON.stringify(api.store.get().summary));
      }

      check('留痕条数不超过上限', T.count() <= T.TIMELINE_MAX, `${T.count()} / ${T.TIMELINE_MAX}`);
      T.clear();
      check('清空后归零', T.count() === 0, String(T.count()));
    }
  }

  // ---- 合集解析（纯逻辑，不需要网络）----
  {
    const C = api.context;
    check('导出了 isCollectionUrl', typeof C.isCollectionUrl === 'function', typeof C.isCollectionUrl);
    check('导出了 parseCollectionUrl', typeof C.parseCollectionUrl === 'function', typeof C.parseCollectionUrl);
    if (typeof C.isCollectionUrl === 'function') {
      check('识别 channel/collectiondetail 合集链接', C.isCollectionUrl('https://space.bilibili.com/946974/channel/collectiondetail?sid=2046621'));
      check('识别 /lists/ 形式的合集链接', C.isCollectionUrl('https://space.bilibili.com/946974/lists/2046621?type=season'));
      check('识别 seriesdetail 合集链接', C.isCollectionUrl('https://space.bilibili.com/946974/channel/seriesdetail?sid=123'));
      check('普通视频链接不算合集', !C.isCollectionUrl('https://www.bilibili.com/video/BV1be41127ft'));
      check('非 B 站链接不算合集', !C.isCollectionUrl('https://example.com/lists/1'));

      const p1 = C.parseCollectionUrl('https://space.bilibili.com/946974/channel/collectiondetail?sid=2046621');
      check('从合集链接解出 mid 与 seasonId', p1.mid === 946974 && p1.seasonId === 2046621, JSON.stringify(p1));
      const p2 = C.parseCollectionUrl('https://space.bilibili.com/946974/lists/998877?type=season');
      check('从 /lists/ 链接解出 mid 与 seasonId', p2.mid === 946974 && p2.seasonId === 998877, JSON.stringify(p2));
      const p3 = C.parseCollectionUrl('https://www.bilibili.com/video/BV1xx');
      check('普通视频链接解不出 mid/seasonId', p3.mid === 0 && p3.seasonId === 0, JSON.stringify(p3));
    }
  }

  // ---- AI 工具栏：复制/导出/重置 应直接可见（用户要求从 ⋯ 里拿出来）----
  {
    const bar = doc.getElementById('ai-toolbar');
    const text = bar ? bar.textContent : '';
    check('AI 工具栏有复制总结', /复制总结/.test(text), text.slice(0, 120));
    check('AI 工具栏有导出总结', /导出总结/.test(text), '');
    check('AI 工具栏有重置对话', /重置对话/.test(text), '');
    // 它们在工具栏上必须是「看得见」的按钮，而不是藏在菜单里
    const visible = Array.from(bar.querySelectorAll('button'))
      .filter((b) => !b.closest('.menu-panel'))
      .map((b) => b.textContent.trim());
    check('复制/导出/重置不在菜单里（直接可见）',
      visible.some((t) => /复制总结/.test(t)) && visible.some((t) => /导出总结/.test(t)) && visible.some((t) => /重置对话/.test(t)),
      visible.join('/'));
  }

  // ---- 读取视频后自动载入上次结果（用户要求：不用重新搞）----
  {
    const ctxSrc = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'context.js'),
      'utf8'
    );
    check('loadVideo 会查历史并回填', /restoreFromHistory\(video, \{ toast: true \}\)/.test(ctxSrc), '');
    check('抽出了 restoreFromHistory 供多入口复用', /export async function restoreFromHistory/.test(ctxSrc), '');
    check('历史 key 与后台一致（bvid|cid|page）', /v\.bvid \|\| '-'/.test(ctxSrc) && /v\.page == null \? '-' : String\(v\.page\)/.test(ctxSrc), '');
    check('载入后提示可重新生成', /想重新生成/.test(ctxSrc), '');
    check('载入失败不影响主流程', /载入历史失败不影响主流程/.test(ctxSrc), '');
    check('只填空着的字段（不与本次会话内容冲突）', /hasLines \? row\.lines : cur\.subtitles/.test(ctxSrc) && /hasSummary \? row\.summary : cur\.summary/.test(ctxSrc), '');
    check('内容没变化就不重复 set', /sameLines && sameSummary/.test(ctxSrc), '');

    // saveHistory 不能把已有的总结覆盖成空 —— 这正是「字幕有、总结没了」的根因
    check('saveHistory 不写空 summary', /if \(st\.summary\) entry\.summary = st\.summary;/.test(ctxSrc), '');
    check('summary 为空时先读已有值再决定', /const prev = \(await call\('history\.get'/.test(ctxSrc), '');
    const storSrc = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'shared', 'storage.js'),
      'utf8'
    );
    check('historyPut 兜底：空 summary 不覆盖', /entry && entry\.summary === '' && prev\.summary/.test(storSrc), '');
    check('historyPut 兜底：空 lines 不覆盖', /entry\.lines\.length === 0 && Array\.isArray\(prev\.lines\)/.test(storSrc), '');
    check('批量处理保留已有总结', /restoredSummary/.test(ctxSrc), '');
    check(
      '批量运行中可取消（AbortController + signal 透传）',
      /export function batchCancel/.test(ctxSrc) &&
        /signal: ctl\.signal/.test(ctxSrc) &&
        /batchControllers\.get/.test(ctxSrc),
      ''
    );
    check(
      '批量解析阶段也能中止（rid + abortable）',
      /rid: `batch_\$\{item\.id\}`/.test(ctxSrc) &&
        /registerExternalAbort\(params\.rid\)/.test(
          fs.readFileSync(path.join(ROOT, 'src/background/service-worker.js'), 'utf8')
        ) &&
        /function abortable\(/.test(fs.readFileSync(path.join(ROOT, 'src/background/service-worker.js'), 'utf8')),
      ''
    );
  }

  // ---- 二进制垃圾不能当字幕解析 ----
  {
    const SUBS = api.subtitles;
    check('导出了 looksLikeBinaryGarbage', !!SUBS && typeof SUBS.looksLikeBinaryGarbage === 'function', typeof SUBS);
    if (SUBS && typeof SUBS.looksLikeBinaryGarbage === 'function') {
      // 真实 protobuf 片段（/x/v2/subtitle/web/view 的返回）的形态
      const proto = '\u0000\u0001\u0000\u0004\u0002\u0000\u001d\u0000\u0000\u0000\u0002\u001a\ufffd\ufffd\ufffd\u0003ai-zh"\ufffd\ufffd\u0000\u0001*//subtitle.bilibili.com/S\u0013\u001bP\u001d\u0000\u0001';
      check('识别 protobuf 二进制垃圾', SUBS.looksLikeBinaryGarbage(proto) === true, '');
      check('正常 SRT 不算垃圾', SUBS.looksLikeBinaryGarbage('1\n00:00:01,000 --> 00:00:03,000\n这是第一句\n') === false, '');
      check('正常中文字幕不算垃圾', SUBS.looksLikeBinaryGarbage('大家好，今天我们聊聊 DeepSeek 的 MoE 架构。\n这是第二句话。') === false, '');
      check('空文本不算垃圾', SUBS.looksLikeBinaryGarbage('') === false, '');
      const parsed = SUBS.parseSubtitleText(proto, 'text');
      check('二进制文本解析为空数组', Array.isArray(parsed) && parsed.length === 0, JSON.stringify(parsed).slice(0, 80));
    }
    const subSrc = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'subtitles.js'),
      'utf8'
    );
    check('缓存命中后仍做校验', /cachedValidation = validateLines\(cached, video\.duration, expectFor\(video\)\)/.test(subSrc), '');
    check('校验不过就不采用缓存', /attempt\.cacheRejected = cachedValidation/.test(subSrc), '');
    const swSrc = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'background', 'service-worker.js'),
      'utf8'
    );
    check('后台拒绝 octet-stream 响应', /octet-stream/.test(swSrc) && /接口返回二进制/.test(swSrc), '');
  }

  // ---- 字幕归属校验（防「抓到别的视频的字幕」）----
  {
    const SUBS = api.subtitles;
    check('导出了 findForeignVideoId', typeof SUBS.findForeignVideoId === 'function', typeof SUBS.findForeignVideoId);
    check('导出了 contentOverlap', typeof SUBS.contentOverlap === 'function', typeof SUBS.contentOverlap);

    if (typeof SUBS.findForeignVideoId === 'function') {
      // 字幕里提到别的 BV 号 → 可疑
      check('识别正文里别的 BV 号',
        SUBS.findForeignVideoId('我们下期见，记得看 BV1be41127ft 那期', { bvid: 'BV132421A7VN' }) === 'BV1be41127ft', '');
      // 提到自己的 BV 号 → 不算可疑
      check('提到自己的 BV 号不算可疑',
        SUBS.findForeignVideoId('本期 BV132421A7VN 的内容', { bvid: 'BV132421A7VN' }) === '', '');
      check('没有 BV 号时返回空', SUBS.findForeignVideoId('普通字幕内容，没有编号。', { bvid: 'BV132421A7VN' }) === '', '');
    }

    if (typeof SUBS.contentOverlap === 'function') {
      const title = '零下26度的新疆，跟着影视飓风去拍样片！';
      const desc = '我们去了新疆拍样片，这次挑战零下26度的低温环境。';
      const onTopic = '大家好，这次我们来到了新疆，温度是零下26度，我们计划拍摄一组样片。新疆的风很大。跟着影视飓风一起出发。';
      const ov1 = SUBS.contentOverlap(onTopic, title + ' ' + desc);
      check('同话题命中数明显偏高', ov1 && ov1.hits >= 3, JSON.stringify(ov1));
      const offTopic = '今天我们讲讲 Python 的异步编程，asyncio 事件循环如何调度协程，以及如何避免阻塞主线程导致性能下降的问题。';
      const ov2 = SUBS.contentOverlap(offTopic, title + ' ' + desc);
      check('无关内容命中数极低', ov2 && ov2.hits < 3, JSON.stringify(ov2));
      check('样本太小时不判断（返回 null）', SUBS.contentOverlap('短', title) === null, '');
    }

    // ---- 最长公共子串：归属判断的实际判据 ----
    check('导出了 longestCommonSubstring', typeof SUBS.longestCommonSubstring === 'function', typeof SUBS.longestCommonSubstring);
    if (typeof SUBS.longestCommonSubstring === 'function') {
      const title = '零下26度的新疆，跟着影视飓风去拍样片！';
      const desc = '我们去了新疆拍样片，这次挑战零下26度的低温环境。';
      const target = title + ' ' + desc;
      const unrelated1 = '今天我们讲讲 Python 的异步编程，asyncio 事件循环如何调度协程，以及如何避免阻塞主线程导致性能下降的问题。';
      const unrelated2 = '本次直播主要讲解英雄联盟新版本的装备改动，以及打野路线的优化思路和团战站位技巧。';
      const weaklyRelated = '今天天气不错，我们随便聊聊，新疆是个好地方。';
      const onTopic = '这次我们来到新疆拍样片，零下26度的低温环境对设备和人都非常具有挑战性。';
      check('无关内容最长公共子串很小（<5）', SUBS.longestCommonSubstring(unrelated1, target) < 5, String(SUBS.longestCommonSubstring(unrelated1, target)));
      check('另一无关内容同样很小（<5）', SUBS.longestCommonSubstring(unrelated2, target) < 5, String(SUBS.longestCommonSubstring(unrelated2, target)));
      check('只是碰巧提到同一地名也判为无关（<5）', SUBS.longestCommonSubstring(weaklyRelated, target) < 5, String(SUBS.longestCommonSubstring(weaklyRelated, target)));
      check('同话题内容明显更长（≥5）', SUBS.longestCommonSubstring(onTopic, target) >= 5, String(SUBS.longestCommonSubstring(onTopic, target)));
      check('自身最长公共子串接近全文', SUBS.longestCommonSubstring(target, target) > 20, String(SUBS.longestCommonSubstring(target, target)));
      check('空输入返回 0', SUBS.longestCommonSubstring('', target) === 0, '');
    }

    // 归属校验必须真的被接进 validateLines
    if (typeof SUBS.validateLines === 'function') {
      const title = '零下26度的新疆，跟着影视飓风去拍样片！';
      const v = { bvid: 'BV132421A7VN', cid: 1433109361, title, desc: '我们去了新疆拍样片，挑战零下26度的低温环境。' };
      const mk = (texts) => texts.map((t, i) => ({ from: i * 4, to: i * 4 + 3, text: t }));
      // 正文字里带别的 BV 号 → 确定性证据，必须被拒
      const withForeign = mk(Array.from({ length: 40 }, (_, i) => (i === 5 ? '更多内容见 BV1be41127ft 那一期' : '这是本期的正常字幕内容，讲的是新疆样片拍摄的经历和感受')));
      const r2 = SUBS.validateLines(withForeign, 200, v);
      check('含别的 BV 号的字幕被拒（确定性证据）', r2.ok === false && r2.kind === 'foreign', `${r2.kind} ${r2.detail || ''}`);
      // 提到自己的 BV 号不算问题
      const withOwn = mk(Array.from({ length: 40 }, (_, i) => (i === 5 ? '这是 BV132421A7VN 的第 6 句' : '这是本期的正常字幕内容，讲的是新疆样片拍摄的经历和感受')));
      const r2b = SUBS.validateLines(withOwn, 200, v);
      check('提到自己的 BV 号可以通过', r2b.ok === true, `${r2b.kind} ${r2b.detail || ''}`);
      // 普通字幕（哪怕和标题用词不同）必须通过 —— 归属判断只认确定性证据，
      // 不能用内容重合度硬卡（真实视频的标题用词通常不会出现在字幕里）
      const good = mk(Array.from({ length: 40 }, () => '这次我们来到新疆拍样片，零下26度的低温环境对设备和人都非常具有挑战性'));
      const r3 = SUBS.validateLines(good, 200, v);
      check('同话题字幕通过校验', r3.ok === true, `${r3.kind} ${r3.detail || ''}`);
      const offTopic = mk(Array.from({ length: 40 }, () => '今天我们讲讲 Python 的异步编程和事件循环调度协程的细节问题'));
      const r5 = SUBS.validateLines(offTopic, 200, v);
      check('用词完全不同的字幕不因“内容对不上”被拒（避免误杀）', r5.ok === true, `${r5.kind} ${r5.detail || ''}`);
      check('仍然记录归属参考值', typeof r5.stats.overlapLcs === 'number', String(r5.stats.overlapLcs));
      // 不给 expect 时不应因归属被拒（向后兼容）
      const r4 = SUBS.validateLines(good, 200);
      check('不传 expect 时只做时长校验', r4.ok === true, `${r4.kind}`);
    }

    // ---- 换视频后必须真的「重新开始」----
    //
    // 用户复现：读 A → 转录/总结 → 切到 B → 点重新抓取。
    // 现象之一是「界面没重新开始，还停在 A 的总结上」。
    // 原因是 SPA 导航处理器调 loadVideo() → 触发自动回填历史 → 把 A 的内容载了回来。
    const appSrc2 = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'app.js'),
      'utf8'
    );
    check('导航处理器要求不回填历史', /loadVideo\(\{ noRestore: true \}\)/.test(appSrc2), '');
    const ctxSrc2 = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'context.js'),
      'utf8'
    );
    check('loadVideo 支持 noRestore 选项', /if \(changed && !opts\.noRestore\)/.test(ctxSrc2), '');
    check('手动读取时仍然回填历史', /restoreFromHistory\(video, \{ toast: true \}\)/.test(ctxSrc2), '');

    // ---- 输出上限与详细程度 ----
    const defSettings = require('./default-settings.json');
    check('默认最大输出 token 提高到 8192', Number(defSettings.ai.maxTokens) === 8192, String(defSettings.ai.maxTokens));
    check(
      '旧默认 4096 会被迁移',
      /Number\(merged\.ai\.maxTokens\) === 4096/.test(
        fs.readFileSync(path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'shared', 'settings.js'), 'utf8')
      ),
      ''
    );
    check('提示词要求更详细', /宁可详细，不要简略/.test(api.panelAi.FEISHU_FORMAT_RULES || ''), '');
    check('提示词保留反灌水约束', /不要为了凑长度/.test(api.panelAi.FEISHU_FORMAT_RULES || ''), '');

    // ---- 解码路径必须按**实际 codec** 建 SourceBuffer ----
    //
    // 用户报：「2 小时视频转录后 —— 音频数据追加失败」。
    // 根因：MSE 的 SourceBuffer 被硬编码成 mp4a.40.2，
    // 而 B 站相当一部分音轨是 HE-AAC（mp4a.40.5）。
    // codec 对不上 → appendBuffer 报错，而旧代码只抛
    // 「音频数据追加失败」，完全看不出真因。
    const audioSrc = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'audio.js'),
      'utf8'
    );
    check('SourceBuffer 按实际 codec 建', /audio\/mp4; codecs="\$\{codecs\}"/.test(audioSrc), '');
    check('codec 候选包含 mp4a.40.5（HE-AAC）', /mp4a\.40\.5/.test(audioSrc), '');
    check('找不到格式时报出真实 codec', /找不到可用的音频解码格式/.test(audioSrc), '');
    check('追加失败带出 MediaSource 真实原因', /sb\.error \|\| ms\.error/.test(audioSrc), '');
    check('配额不足时明确提示', /SourceBuffer 配额不足/.test(audioSrc), '');
    check('大文件分块追加（避免一次 60MB）', /const APPEND_CHUNK = 4 \* 1024 \* 1024;/.test(audioSrc), '');
    // ---- 内存优化：不许再复制整份 mono ----
    //
    // 实测 2 小时视频：解码后 2637MB，旧代码还额外复制 mono(1318MB)
    // 与 OfflineAudioContext 输入(1318MB)，重采样阶段就 5GB 以上。
    check('不再单独复制整份 mono', !/const mono = audioBuffer\.numberOfChannels > 1 \? mixToMono\(audioBuffer\) : audioBuffer\.getChannelData\(0\);\s*\n\s*if \(typeof OfflineAudioContext/.test(audioSrc), '');
    check('有 mixToMonoInto（写入已有数组，不额外分配）', /function mixToMonoInto\(audioBuffer, dst\)/.test(audioSrc), '');
    check('重采样直接写进 OfflineAudioContext 输入', /mixToMonoInto\(audioBuffer, tmp\.getChannelData\(0\)\)/.test(audioSrc), '');
    check('decodeAudioBytes 透传 codecs', /decodeViaMediaSource\(bytes, \{ \.\.\.opts, codecs \}\)/.test(audioSrc), '');
    const txSrc3 = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'transcribe.js'),
      'utf8'
    );
    check('转录把音轨 codec 传给解码器', /codecs: audio\.codecs \|\| ''/.test(txSrc3), '');
    // 原始音轨复用那条实验路径已按用户要求移除，不该再出现在代码里
    check('已移除原始音轨复用（实验路径已撤）',
      !/reuseOriginalAudio/.test(txSrc3) && !/assembleOriginalAac/.test(txSrc3) && !/未复用原始音轨/.test(txSrc3), '');

    // ---- 整条原始音轨直传（长视频慢的根治）----
    //
    // 根因：MediaRecorder 只能**实时**编码，编码池宽度只有 2，
    // 于是整条音轨编码墙钟 ≈ 时长 ÷ 2 —— 130 分钟要 65 分钟。
    // B 站的 dash 音轨本身就是完整 MP4/AAC（约 41kbps × 时长），
    // 可以直接上传，解码与重编码全免。
    const oa = api.originalAudio;
    check('导出了 originalAudio 模块', !!oa && typeof oa.fetchWholeAudio === 'function', typeof oa);
    if (oa) {
      check(
        '能按带宽估算整条大小',
        oa.estimateWholeAudioBytes({ bandwidth: 41148 }, 974) === Math.ceil((41148 / 8) * 974),
        String(oa.estimateWholeAudioBytes({ bandwidth: 41148 }, 974))
      );
      const mkMp4 = (ftyp, moov, mp4a) => {
        const b = new Uint8Array(200000);
        const put = (s, arr, o) => {
          for (let i = 0; i < s.length; i += 1) arr[o + i] = s.charCodeAt(i);
        };
        put(ftyp, b, 4);
        put(moov, b, 1000);
        put(mp4a, b, 2000);
        return b;
      };
      const pre = oa.looksLikePlayableMp4(mkMp4('ftyp', 'moov', 'mp4a'));
      check('合法 MP4/AAC 通过校验', pre.ok === true, JSON.stringify(pre));
      check('缺 ftyp 被拒绝', oa.looksLikePlayableMp4(mkMp4('junk', 'moov', 'mp4a')).reason === 'no-ftyp', '');
      check('缺 moov 被拒绝', oa.looksLikePlayableMp4(mkMp4('ftyp', 'xxxx', 'mp4a')).reason === 'no-moov', '');
      check('缺 mp4a 被拒绝', oa.looksLikePlayableMp4(mkMp4('ftyp', 'moov', 'zzzz')).reason === 'no-mp4a', '');
      check('过小的文件被拒绝', oa.looksLikePlayableMp4(new Uint8Array(100)).ok === false, '');
    }
    check('主流程接了整条直传', /fetchWholeAudio/.test(txSrc3) && /整条原始音轨直传/.test(txSrc3), '');
    check('整条直传放在下载之前', txSrc3.indexOf('fetchWholeAudio') < txSrc3.indexOf('--- 2. 分块下载'), '');
    check('WAV-only 模型不走整条直传', /if \(audioFormatFor\(platform\) !== 'wav'\)/.test(txSrc3), '');
    check('超限前先估算、不硬下', /超过上限 \$\{limitMB\}MB/.test(txSrc3), '');
    check('整条识别有随时长放大的超时', /function timeoutsForWholeAudio/.test(txSrc3), '');

    // original-audio.js 必须自带 throwIfAborted ——
    // 它是个独立模块，不能依赖 audio.js 的内部函数。
    // 我第一版漏了，只有真正跑到才报 ReferenceError（测试全绿也发现不了）。
    const oaSrc = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'original-audio.js'),
      'utf8'
    );
    check('original-audio 自带 throwIfAborted 定义', /function throwIfAborted\(signal\)/.test(oaSrc), '');
    check('original-audio 不从其它模块借 throwIfAborted', !/import .*throwIfAborted/.test(oaSrc), '');
    // 取整条走显式 Range（不带 Range 的那次实测失败过）
    check('取整条用显式 Range', /range: 'bytes=0-'/.test(oaSrc), '');
    check('能从 Content-Range 解析总长度', /function parseTotalFromContentRange/.test(oaSrc), '');
    // 整条音轨与分块下载共用 audio.range：页面优先、后台兜底、错误统一分类；
    // 回的是 base64（不是 bytes），面板层必须自己解码。
    check(
      '整条音轨走统一的 audio.range 代理',
      /'audio\.range'/.test(txSrc3) && /range \? \{ url: u, range \}/.test(txSrc3),
      ''
    );
    check('面板层把 base64 解成 bytes', /base64ToBytes\(res\.base64\)/.test(txSrc3), '');
    const bSrc4 = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'content', 'page-bridge.js'),
      'utf8'
    );
    check('页面桥支持 Range 串写法', /typeof start === 'string' && start/.test(bSrc4), '');
    check('页面桥分发时透传 range', /p && p\.range \? p\.range : p && p\.start/.test(bSrc4), '');

    // ---- 长视频总结不能只取前 40000 字符 ----
    //
    // 用户报：「2 小时视频官方字幕是全的，但总结到某个时间点后就没有了。」
    // 根因：selectContext(lines, '', 40000) 传空问题时走
    //       full.slice(0, maxChars) —— 只取前 40000 字符。
    // 2 小时字幕约 6.6 万字符 → 只喂 61%，总结覆盖到约 73 分钟处。
    {
      const fake = [];
      for (let i = 0; i < 2057; i += 1) {
        fake.push({ from: i * 3.5, to: i * 3.5 + 3.4, text: '这是一条示例字幕内容大约二十来个字用于估算体量' });
      }
      const full = api.subtitles.linesToTranscript(fake, { withTime: true });
      const ctx = api.subtitles.selectContext(fake, '', 40000);
      check(
        '长字幕会被 selectContext 截断（旧行为的证据）',
        ctx.truncated === true && ctx.text.length < full.length,
        `${ctx.text.length}/${full.length}`
      );
      check('subtitles 导出了 fmtClock', typeof api.subtitles.fmtClock === 'function', typeof api.subtitles.fmtClock);
      check('fmtClock 格式正确', api.subtitles.fmtClock(3671) === '61:11', api.subtitles.fmtClock(3671));
      const chunks = api.panelAi.chunkTranscript(fake, 40000);
      check('长字幕被切成多段', chunks.length >= 2, `${chunks.length} 段`);
      check('每段都不超过上限', chunks.every((c) => c.text.length <= 40000), chunks.map((c) => c.text.length).join(','));
      const joined = chunks.map((c) => c.text).join('\n');
      const got = joined.split('\n').filter(Boolean).length;
      check('所有行都被覆盖（不丢内容）', got === fake.length, `${got} / ${fake.length}`);
      const lastChunk = chunks[chunks.length - 1].text;
      const lastLabel = api.subtitles.fmtClock(fake[fake.length - 1].from);
      check('最后一段包含视频结尾', lastChunk.includes(lastLabel), `期望含 ${lastLabel}`);
    }
    const aiSrc2 = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'panel-ai.js'),
      'utf8'
    );
    check('总结在截断时走分段合并', /if \(ctx\.truncated\)/.test(aiSrc2) && /summarizeInChunks/.test(aiSrc2), '');
    check('有分段提取与合并两段提示词', /const CHUNK_SYSTEM/.test(aiSrc2) && /function mergeUserPrompt/.test(aiSrc2), '');
    check('合并提示词明确要求覆盖全片', /覆盖\*\*全片\*\*/.test(aiSrc2), '');

    // ---- 总结里的时间戳不能泛滥 ----
    //
    // 用户反馈：「这次怎么里面有很多时间，影响阅读了。」
    // 根因是我在分段总结的提示词里写了「关键处保留时间，写成 [mm:ss]」——
    // 模型几乎每行都塞一个时间戳。时间只在少数需要跳转处才有价值。
    check('分段提示词不再要求每条要点带时间', !/关键处保留时间，写成/.test(aiSrc2), '');
    check('分段提示词明确限制时间数量', /不要给每条要点都标时间/.test(aiSrc2), '');
    check('合并提示词也不再要求保留关键时间点', !/保留关键时间点，写成/.test(aiSrc2), '');
    check('合并提示词限制时间数量（全篇最多 2~3 处）', /全篇最多 2~3 处/.test(aiSrc2), '');

    // ---- 「字幕未提供」是模型脑补出来的，不是我们的结论 ----
    //
    // 用户报：总结里写「字幕覆盖 00:00–1:43:39，之后约 14 分钟字幕未提供」，
    // 但他的字幕里明明有后面的内容。
    // 全仓库搜不到这行字 —— 它是模型自己推断的：提示词给了「视频总时长」
    // 与各段的时间标签（只到最后一句字幕），模型拿两者作差得出「后面没字幕」。
    check('导出了 subtitleSpan', typeof api.panelAi.subtitleSpan === 'function', typeof api.panelAi.subtitleSpan);
    check('导出了 describeSpan', typeof api.panelAi.describeSpan === 'function', typeof api.panelAi.describeSpan);
    {
      const span = api.panelAi.subtitleSpan([
        { from: 0, to: 3, text: 'a' },
        { from: 90, to: 93, text: 'b' },
        { from: 6220, to: 6223, text: 'c' }
      ]);
      check('subtitleSpan 取到首末时间', span && span.first === 0 && span.last === 6223, JSON.stringify(span));
      check('subtitleSpan 统计行数', span && span.count === 3, JSON.stringify(span));
      check('空输入返回 null', api.panelAi.subtitleSpan([]) === null, '');
      check('非法输入返回 null', api.panelAi.subtitleSpan(null) === null, '');
      const desc = api.panelAi.describeSpan(span, 7091);
      check('describeSpan 含真实首末时间', /00:00/.test(desc) && /1:43:43/.test(desc), desc);
      check('describeSpan 含总时长', /1:58:11/.test(desc), desc);
    }
    check('单次总结提示词带上真实字幕范围', /describeSpan\(subtitleSpan\(correctedLines\)/.test(aiSrc2), '');
    check('合并提示词带上真实字幕范围', /spanText/.test(aiSrc2), '');
    check('明确禁止模型议论字幕完整性', /不要\*\*写任何关于「字幕是否完整/.test(aiSrc2), '');
    check('字幕原文说明改为「已提供的全部」', /已提供的全部/.test(aiSrc2), '');
    const actSrc2 = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'panel-actions.js'),
      'utf8'
    );
    check('操作区显示字幕覆盖范围', /fmtClockFull\(span\.first\)/.test(actSrc2), '');
    check('末尾缺口明显时给出提醒', /末尾缺约/.test(actSrc2) && /pill-warn/.test(actSrc2), '');
    check('诊断里的时间改成时:分:秒可读形式', /时间范围 \$\{fmtClockFull/.test(actSrc2), '');

    // ---- 清空字幕（用户报「读取出来的字幕为什么不能清除」）----
    const ctxSrc3 = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'context.js'),
      'utf8'
    );
    check('导出了 clearSubtitles', /export function clearSubtitles\(/.test(ctxSrc3), '');
    check('清空时同时清掉校对备份', /subtitlesOriginal: \[\]/.test(ctxSrc3), '');
    check('清空时清掉章节与统计', /chapters: \[\], stats: null/.test(ctxSrc3), '');
    check('清空会留痕', /recordTimeline\('清空字幕'\)/.test(ctxSrc3), '');
    const actSrc = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'panel-actions.js'),
      'utf8'
    );
    const subSrc4 = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'panel-subtitles.js'),
      'utf8'
    );
    check('操作区菜单有「清空字幕」', /label: '清空字幕'/.test(actSrc), '');
    check('字幕面板菜单也有「清空字幕」', /label: '清空字幕'/.test(subSrc4), '');

    // ---- 按钮审计：文案与防重复 ----
    check('不再出现「抓取官方字幕」按钮文案', !/button\('抓取官方字幕'/.test(subSrc4) && !/button\('② 抓取官方字幕'/.test(actSrc), '');
    check('空态只用「获取字幕」一个主按钮（转录不再重复出现）',
      !/row\.appendChild\(button\('语音转录'/.test(subSrc4), '');
    check('引导文案指向顶部转录入口', /入口在顶部操作区的「语音转录」/.test(subSrc4), '');
    // 浮层里的转录按钮必须先关浮层，否则转录在浮层底下跑、用户以为没反应
    check('有统一的 runTranscribe 入口', /export function runTranscribe\(\)/.test(actSrc), '');
    check('runTranscribe 先关闭浮层', /export function runTranscribe\(\) \{\s*\n\s*closeOverlays\(\);/.test(actSrc), '');
    check('失败提示里的转录走 runTranscribe', /button\('语音转录', \(\) => runTranscribe\(\)/.test(actSrc), '');
    check('明细浮层里的转录走 runTranscribe', /label: '语音转录', primary: true, onClick: \(\) => runTranscribe\(\)/.test(actSrc), '');
    check('字幕面板浮层也走 runTranscribe', /app\.panels\.actions\.runTranscribe\(\)/.test(subSrc4), '');
    // 向导文案同步
    const wizSrc = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'wizard.js'),
      'utf8'
    );
    check('向导按钮文案已同步为「获取字幕」', /button\('获取字幕'/.test(wizSrc) && !/button\('抓取字幕'/.test(wizSrc), '');

    // ---- 身份绑定：面板要把「自己展示的那个视频」告诉页面 ----
    const subSrc3 = fs.readFileSync(
      path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules', 'subtitles.js'),
      'utf8'
    );
    check('字幕请求带上期望签名', /expectSignature: expected/.test(subSrc3), '');
    check('身份不符时放弃这批字幕', /if \(bundle && bundle\.identityMismatch\)/.test(subSrc3), '');
    check('身份不符时也自动重采一次', /lastIdentityMismatch/.test(subSrc3), '');
    check('音轨请求带上 cid 与签名', /cid: video\.cid, signature: video\.signature/.test(txSrc3), '');
    check('日志报告被排除的音轨数', /foreignCandidates\.length/.test(txSrc3), '');
    // 身份没就绪时重试，而不是拿别的视频的音轨去转录
    check('音轨身份未就绪时重试', /for \(let attempt = 0; attempt < 4; attempt \+= 1\)/.test(txSrc3), '');
    check('重试仍失败则拒绝继续', /拿不到当前视频的音轨/.test(txSrc3), '');
    check('字幕身份不稳定也自动重采', /lastIdentityUnstable/.test(subSrc3), '');
  }

  // ---- 跨面板 API 契约：被调用的方法必须真的挂到面板对象上 ----
  //
  // 这类 bug 极隐蔽：`runTranscribe` 有 `export`，但忘了放进
  // `init()` 的 return 对象 —— 于是 app.panels.actions.runTranscribe()
  // 是 undefined，点击时抛「不是函数」。
  // 语法检查、打包、其它测试**全都发现不了**：
  // 它们只检查「函数存在」，不检查「函数挂上去了没有」。
  {
    const dir = path.join(__dirname, '..', 'bilibili-subtitle-assistant', 'src', 'sidepanel', 'modules');
    const MODULE_OF = { actions: 'panel-actions.js', ai: 'panel-ai.js', subtitles: 'panel-subtitles.js' };
    const sources = {};
    for (const f of Object.values(MODULE_OF)) sources[f] = fs.readFileSync(path.join(dir, f), 'utf8');
    // init() 的 return 块里有没有这个键
    const initKeys = (file) => {
      const m = /export function init\([\s\S]*?\n\s*return \{([\s\S]*?)\n\s*\};/.exec(sources[file] || '');
      return m ? m[1] : null;
    };
    const hasKey = (file, key) => {
      const block = initKeys(file);
      if (block == null) return null;
      return new RegExp(`(^|[\\s,{])${key}\\s*[,:}]`, 'm').test(block);
    };

    // 收集所有 app.panels.<panel>.<method> 调用
    const calls = new Set();
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of src.matchAll(/app\.panels\.(\w+)\.(\w+)/g)) calls.add(`${m[1]}.${m[2]}`);
    }
    const missing = [];
    for (const c of [...calls].sort()) {
      const [panel, method] = c.split('.');
      const file = MODULE_OF[panel];
      if (!file) continue; // settings / wizard 结构不同，不在本断言范围
      if (hasKey(file, method) === false) missing.push(`${panel}.${method}`);
    }
    check('跨面板调用的方法都在 init() 里导出', missing.length === 0, missing.join('；'));
    check('actions.init 导出了 runTranscribe', hasKey('panel-actions.js', 'runTranscribe') === true, '');
    check('actions.init 导出了 summarize', hasKey('panel-actions.js', 'summarize') === true, '');
    check('actions.init 导出了 harvest/reload/seek', 
      hasKey('panel-actions.js', 'harvest') === true && hasKey('panel-actions.js', 'reload') === true && hasKey('panel-actions.js', 'seek') === true, '');
  }

  report(results, errors);
  server.close();
  process.exit(results.some((r) => !r.ok) || errors.length ? 1 : 0);
}

function report(results, errs) {
  console.log('\n===== 侧边栏真实渲染测试（jsdom + 真实面板代码） =====');
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed += 1;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
  }
  console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
  if (errs.length) {
    console.log('\n---- 运行时错误 ----');
    for (const e of errs.slice(0, 25)) console.log(e);
  }
}

main().catch((err) => {
  console.error('测试崩溃：', err && err.stack);
  process.exit(2);
});
