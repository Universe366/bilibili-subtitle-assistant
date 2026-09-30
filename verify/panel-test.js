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
        const html = skeleton.replace('__BUNDLE__', fs.readFileSync(BUNDLE, 'utf8'));
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
  'build.info': { app: 'B站字幕助手', version: '1.28.0', contentVersion: '1.28.0', modules: 8, buildTime: '2025-06-01T00:00:00Z' },
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
    tabs: [{ tabId: 1, url: 'https://www.bilibili.com/video/BV1xx411c7mD', title: '测试视频标题', pageType: 'video', scriptVersion: '1.28.0', stale: false }],
    contentVersion: '1.28.0'
  },
  diagnostics: {
    extensionVersion: '1.28.0',
    contentVersion: '1.28.0',
    modules: 8,
    buildTime: '2025-06-01T00:00:00Z',
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
      getManifest: () => ({ version: '1.28.0', manifest_version: 3 }),
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
  check('构建指纹（版本 + 模块数 + 构建时间）', /构建指纹 1\.28\.0 · 8 模块 · 2025-06-01/.test(doc.getElementById('fingerprint').textContent), doc.getElementById('fingerprint').textContent);
  check('配置状态常驻提示可见且说明原因', doc.getElementById('readiness').getAttribute('data-visible') === 'true' && /API Key/.test(doc.getElementById('readiness').textContent));
  check('操作区渲染出抓取字幕', /抓取字幕/.test(doc.getElementById('actionbar').textContent));
  check('语音转录入口常驻可见', /语音转录/.test(doc.getElementById('actionbar').textContent));
  check('检索入口常驻可见（服务商 + 直接搜索）', /服务商检索/.test(doc.getElementById('actionbar').textContent) && /直接搜索/.test(doc.getElementById('actionbar').textContent));
  const subEmpty = doc.getElementById('subtitles-pane').textContent;
  check('字幕面板空态渲染（含引导清单）', /还没有拿到视频信息|读取当前视频/.test(subEmpty));
  check('空态给出 4 步流程引导', (doc.querySelectorAll('#subtitles-pane .step').length >= 3) && /抓取官方字幕/.test(subEmpty) && /语音转录/.test(subEmpty) && /生成总结/.test(subEmpty), JSON.stringify(Array.from(doc.querySelectorAll('#subtitles-pane .step-title')).map((e) => e.textContent)));
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
  doc.querySelector('.overlay-card .overlay-head button').click();
  await sleep(200);
  check('浮层可关闭', doc.getElementById('overlay-root').getAttribute('data-open') === 'false');

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
