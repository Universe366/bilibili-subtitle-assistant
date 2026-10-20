// 后台 service worker 端到端测试（Node + chrome.* 桩 + fetch 桩 + fake-indexeddb）。
// 覆盖：RPC 路由、密钥掩码与留空不改动、字幕下载容错、音轨 Range 下载、
//       错误分类、SSE 流式解析、检索平台适配、超时处理。
require('fake-indexeddb/auto');

const path = require('path');
const { pathToFileURL } = require('url');

const EXT = path.resolve(__dirname, '..', 'bilibili-subtitle-assistant');
const errors = [];
const calls = [];
const fetchLog = [];
const results = [];
const check = (name, ok, extra = '') => results.push({ name, ok: !!ok, extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// chrome.* 桩
// ---------------------------------------------------------------------------

const storageData = {};
const listeners = {};
const tabMessages = [];
let tabMessageHandler = null;

function onEvent(name) {
  listeners[name] = listeners[name] || [];
  return {
    addListener: (fn) => listeners[name].push(fn),
    removeListener: (fn) => {
      listeners[name] = (listeners[name] || []).filter((f) => f !== fn);
    }
  };
}

function emit(name, ...args) {
  for (const fn of listeners[name] || []) fn(...args);
}

const fakeTab = {
  id: 7,
  url: 'https://www.bilibili.com/video/BV1xx411c7mD/?p=1',
  title: '测试视频',
  active: true,
  windowId: 1,
  status: 'complete'
};

const chromeStub = {
  runtime: {
    id: 'test-ext',
    lastError: null,
    getManifest: () => ({ version: '2.9.0', manifest_version: 3 }),
    getURL: (p) => `chrome-extension://test-ext/${p}`,
    onInstalled: onEvent('onInstalled'),
    onStartup: onEvent('onStartup'),
    onMessage: onEvent('onMessage'),
    onConnect: onEvent('onConnect'),
    sendMessage: async (msg) => {
      calls.push(msg);
      return undefined;
    }
  },
  storage: {
    local: {
      get: async (key) => {
        if (typeof key === 'string') return { [key]: storageData[key] };
        return Object.fromEntries((key || []).map((k) => [k, storageData[k]]));
      },
      set: async (obj) => {
        Object.assign(storageData, JSON.parse(JSON.stringify(obj)));
      },
      remove: async (k) => {
        delete storageData[k];
      }
    },
    onChanged: onEvent('storageChanged')
  },
  tabs: {
    query: async () => [fakeTab],
    get: async (id) => (id === fakeTab.id ? fakeTab : Promise.reject(new Error('no tab'))),
    sendMessage: async (tabId, msg) => {
      tabMessages.push({ tabId, msg });
      if (msg && msg.type === 'bsub:ping') return { ok: true, version: '2.9.0' };
      if (msg && msg.type === 'bsub:to-content') {
        if (tabMessageHandler) return tabMessageHandler(msg);
        // 模拟内容脚本：返回 {ok, data} 信封（后台 rpcPage 会拆开）
        return { ok: true, data: { ok: true, tabId, method: msg.method } };
      }
      return { ok: true };
    },
    create: async () => ({ id: 8 }),
    remove: async () => {},
    onRemoved: onEvent('tabRemoved'),
    onActivated: onEvent('tabActivated'),
    onUpdated: onEvent('tabUpdated')
  },
  permissions: {
    contains: async () => true,
    request: async () => true,
    getAll: async () => ({ origins: ['https://*.bilibili.com/*'] })
  },
  sidePanel: {
    setPanelBehavior: async () => {},
    setOptions: async () => {},
    open: async () => {}
  },
  scripting: {
    executeScript: async () => [],
    insertCSS: async () => {}
  },
  webNavigation: { onHistoryStateUpdated: onEvent('onHistoryStateUpdated') },
  windows: { WINDOW_ID_CURRENT: -2 }
};

globalThis.chrome = chromeStub;
globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));

// ---------------------------------------------------------------------------
// fetch 桩
// ---------------------------------------------------------------------------

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) }
  });
}

function sseResponse(chunks) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c));
        await sleep(10);
      }
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const AUTO_REPLY = '整理好的内容';

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method || 'GET').toUpperCase();
  const entry = { url: u, method, headers: init.headers || {}, credentials: init.credentials || 'same-origin', body: init.body, formData: null, formFields: null, isJson: false };
  // 记录 multipart 表单字段，便于断言「到底发了哪些参数」
  if (init.body && typeof init.body.append === 'function' && typeof init.body.entries === 'function') {
    entry.formData = init.body;
    entry.formFields = {};
    for (const [k, v] of init.body.entries()) {
      entry.formFields[k] = v && v.size != null ? `<blob ${v.size}>` : String(v);
    }
  } else if (typeof init.body === 'string') {
    entry.isJson = true;
    try {
      entry.formFields = JSON.parse(init.body);
    } catch (err) {
      /* 非 JSON 字符串体 */
    }
  }
  fetchLog.push(entry);
  const key = process.env.BSUB_TEST_KEY || 'sk-test-1234567890abcd';

  // 官方字幕列表接口（页面里没解析到字幕轨时的兜底）
  if (u.includes('api.bilibili.com/x/player/v2')) {
    if (u.includes('cid=999999')) {
      return jsonResponse({ code: 0, message: '0', data: { isLogin: true, subtitle: { subtitles: [] } } });
    }
    if (u.includes('cid=888888')) {
      return jsonResponse({ code: -404, message: '啥都木有', data: null });
    }
    return jsonResponse({
      code: 0,
      message: '0',
      data: {
        isLogin: true,
        subtitle: {
          subtitles: [
            { id: 1, lan: 'zh-CN', lan_doc: '中文（简体）', subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/api-zh.json?sign=zzz', is_ai: false },
            { id: 2, lan: 'ai-zh', lan_doc: '中文（自动生成）', subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/api-aizh.json?sign=yyy', is_ai: true }
          ]
        }
      }
    });
  }

  // 字幕（协议相对地址会被补全）
  if (u.includes('aisubtitle.hdslb.com')) {
    if (u.includes('missing')) return new Response('not found', { status: 404 });
    if (u.includes('overrun')) {
      const lines = Array.from({ length: 200 }, (_, i) => ({ from: i * 8, to: i * 8 + 7, content: `第 ${i} 行字幕内容` }));
      return jsonResponse({ body: lines });
    }
    if (u.includes('sparse')) {
      const lines = Array.from({ length: 5 }, (_, i) => ({ from: i * 30, to: i * 30 + 10, content: `稀疏 ${i}` }));
      return jsonResponse({ body: lines });
    }
    if (u.includes('srt')) {
      return new Response('1\n00:00:00,500 --> 00:00:02,000\n第一句\n\n2\n00:00:02,500 --> 00:00:04,000\n第二句\n', { status: 200 });
    }
    const lines = Array.from({ length: 120 }, (_, i) => ({ from: i * 4, to: i * 4 + 3.6, content: `字幕第 ${i} 行` }));
    return jsonResponse({ body: lines });
  }

  // 音轨
  if (u.includes('bilivideo.com/audio')) {
    if (method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-length': '2048', 'content-type': 'audio/mp4' } });
    }
    const range = String(init.headers?.range || '');
    const m = range.match(/bytes=(\d+)-(\d+)/);
    const start = m ? Number(m[1]) : 0;
    const end = m ? Number(m[2]) : 1;
    const total = 2048;
    const size = Math.max(0, Math.min(end, total - 1) - start + 1);
    const buf = Buffer.alloc(size, 0x41);
    return new Response(buf, {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${start + size - 1}/${total}`, 'content-type': 'audio/mp4' }
    });
  }

  // 音轨 403（签名过期）
  if (u.includes('bilivideo.com/expired')) {
    return new Response('forbidden', { status: 403 });
  }

  // wbi 签名的 key 来源
  if (u.includes('/x/web-interface/nav')) {
    return jsonResponse({ code: 0, data: { wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } } });
  }

  // 视频信息（接口兜底会顺带拉一次）
  if (u.includes('/x/web-interface/view')) {
    return jsonResponse({ code: 0, message: 'OK', data: { aid: 123456, bvid: 'BV1xx411c7mD', cid: 999001, title: 'T', duration: 754, owner: { name: 'U' }, pages: [{ page: 1, cid: 999001, part: 'P1', duration: 754 }], subtitle: { allow_submit: true, list: [] } } });
  }

  // 字幕列表（wbi/v2 与 player/v2 共用）
  if (u.includes('/x/player/wbi/v2')) {
    if (u.includes('cid=888888')) return jsonResponse({ code: -404, message: '视频不存在', data: {} });
    if (u.includes('cid=999999')) return jsonResponse({ code: 0, message: 'OK', data: { need_login_subtitle: true, subtitle: { subtitles: [] } } });
    return jsonResponse({
      code: 0,
      message: 'OK',
      data: {
        need_login_subtitle: false,
        subtitle: {
          subtitles: [
            { id: 1, lan: 'zh-CN', lan_doc: '中文（简体）', subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/api-zh.json?sign=zzz', is_ai: false },
            { id: 2, lan: 'ai-zh', lan_doc: '中文（自动生成）', subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/api-aizh.json?sign=yyy', is_ai: true }
          ]
        }
      }
    });
  }

  // 模型列表
  if (u.endsWith('/models')) {
    if (String(init.headers?.authorization || '').includes('sk-bad')) return new Response('bad key', { status: 401 });
    return jsonResponse({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] });
  }

  // 对话（流式）
  if (u.includes('/chat/completions')) {
    if (String(init.headers?.authorization || '').includes('sk-bad')) {
      return new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 });
    }
    if (String(init.headers?.authorization || '').includes('sk-ratelimit')) {
      return new Response(JSON.stringify({ error: { message: 'rate limit' } }), { status: 429 });
    }
    if (String(init.headers?.authorization || '').includes('sk-nomodel')) {
      return new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 });
    }
    const body = JSON.parse(init.body || '{}');
    if (body.stream) {
      return sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: '# ' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: '标题' } }] })}\n\n`,
        ': keep-alive\n\n',
        `data: ${JSON.stringify({ choices: [{ delta: { content: '\n\n**要点**' } }] })}\n\n`,
        'data: [DONE]\n\n'
      ]);
    }
    return jsonResponse({ choices: [{ message: { content: AUTO_REPLY } }] });
  }

  // 语音识别
  if (u.includes('/audio/transcriptions')) {
    if (String(init.headers?.authorization || '').includes('sk-bad')) return new Response('unauthorized', { status: 401 });
    return jsonResponse({ text: '识别出来的一句话。', segments: [{ start: 0, end: 2.4, text: '识别出来的一句话。' }] });
  }

  // 检索
  if (u.includes('api.deepseek.com/v1/tools/search')) {
    return jsonResponse({
      results: [
        {
          rerank_score: 2.4,
          title: '官方高相关',
          url: 'https://ds.example.com/a',
          snippet: '短摘要A',
          summary: '这是给模型看的长摘要A，包含具体事实与数字。',
          content: '正文A',
          site_name: 'Example',
          date: '2026-10-01T00:00:00+00:00',
          authority: 3
        },
        {
          rerank_score: 0.4,
          title: '低相关',
          url: 'https://ds.example.com/b',
          snippet: '短B',
          summary: '摘要B',
          content: '',
          site_name: 'B',
          date: null,
          authority: 1
        }
      ]
    });
  }
  if (u.includes('api.deepseek.com/v1/tools/fetch')) {
    return jsonResponse({ title: '抓取页', content: '# 抓取正文\n内容' });
  }
  if (u.includes('tavily.com')) {
    return jsonResponse({ results: [{ title: '来源A', url: 'https://a.example.com/1', content: '内容A' }, { title: '来源B', url: 'https://b.example.com/2', content: '内容B' }] });
  }
  if (u.includes('bochaai.com')) {
    return jsonResponse({ data: { webPages: { value: [{ name: '博查来源', url: 'https://c.example.com/3', snippet: '片段' }] } } });
  }
  if (u.includes('google.serper.dev')) {
    return jsonResponse({ organic: [{ title: 'Serper来源', link: 'https://d.example.com/4', snippet: '片段' }] });
  }
  if (u.includes('slow.example.com')) {
    await sleep(3000);
    return jsonResponse({});
  }

  return new Response('unexpected url ' + u, { status: 500 });
};

// ---------------------------------------------------------------------------
// 运行
// ---------------------------------------------------------------------------

function rpc(method, params, opts = {}) {
  return new Promise((resolve) => {
    const id = `t${Math.random().toString(36).slice(2)}`;
    const sender = opts.sender !== undefined ? opts.sender : { tab: fakeTab };
    let settled = false;
    const handlers = listeners.onMessage || [];
    for (const fn of handlers) {
      const ret = fn({ kind: 'rpc', id, method, params }, sender, (res) => {
        if (settled) return;
        settled = true;
        resolve(res);
      });
      if (ret === true) return;
    }
    setTimeout(() => {
      if (!settled) resolve({ ok: false, error: { title: '没有监听者处理该消息' } });
    }, 12000);
  });
}

function openPort() {
  const messageListeners = [];
  const disconnectListeners = [];
  const port = {
    name: 'bsub-stream',
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    onDisconnect: { addListener: (fn) => disconnectListeners.push(fn) },
    postMessage: (m) => incoming(m),
    disconnect: () => disconnectListeners.forEach((fn) => fn())
  };
  const received = [];
  let resolveEnd = null;
  const incoming = (m) => {
    received.push(m);
    if (m.kind === 'stream:end' || m.kind === 'stream:error') {
      if (resolveEnd) resolveEnd(m);
    }
  };
  for (const fn of listeners.onConnect || []) fn(port);
  return {
    port,
    received,
    send: (m) => messageListeners.forEach((fn) => fn(m)),
    waitEnd: () => new Promise((r) => (resolveEnd = r))
  };
}

async function main() {
  await import(pathToFileURL(path.join(EXT, 'src/background/service-worker.js')).href);
  emit('onInstalled', { reason: 'install' });
  await sleep(120);

  const settingsKey = 'bsub.settings.v1';

  // ---- 1. 默认设置 ----
  let res = await rpc('settings.get', {});
  check('settings.get 返回默认配置', res.ok && res.data.ai.activeId === 'deepseek' && res.data.asr.activeId === 'siliconflow', JSON.stringify(res.error));
  check('默认 AI 平台是 DeepSeek', res.data.ai.platforms.some((p) => p.id === 'deepseek'));
  check('默认语音识别平台是 硅基流动', res.data.asr.platforms[0].name.includes('硅基流动'));
  check('默认系统提示词原文照录', res.data.prompt.templates.find((t) => t.id === 'default').text === '整理这期视频的内容（可以用表格、代码块、高亮块、引用、超链接、公式、图片等飞书支持的格式输出，可以加上一些图标增加可读性）');
  check('返回给界面的密钥是掩码', res.data.ai.platforms.find((p) => p.id === 'deepseek').apiKey === '');

  // ---- 2. 密钥保存 / 留空不改动 / 掩码回写 ----
  const withKey = JSON.parse(JSON.stringify(res.data));
  withKey.ai.platforms.find((p) => p.id === 'deepseek').apiKey = 'sk-test-1234567890abcd';
  let save = await rpc('settings.set', { settings: withKey });
  check('保存密钥成功', storageData[settingsKey].ai.platforms.find((p) => p.id === 'deepseek').apiKey === 'sk-test-1234567890abcd');
  check('保存后返回掩码（末四位）', save.data.ai.platforms.find((p) => p.id === 'deepseek').apiKey === '••••••••abcd');
  check('保存后返回 apiKeySet=true', save.data.ai.platforms.find((p) => p.id === 'deepseek').apiKeySet === true);

  const blank = JSON.parse(JSON.stringify(save.data));
  blank.ai.platforms.find((p) => p.id === 'deepseek').apiKey = '';
  await rpc('settings.set', { settings: blank });
  check('密钥留空保存表示不改动', storageData[settingsKey].ai.platforms.find((p) => p.id === 'deepseek').apiKey === 'sk-test-1234567890abcd');

  const masked = JSON.parse(JSON.stringify(save.data));
  await rpc('settings.set', { settings: masked });
  check('回写掩码不会覆盖真实密钥', storageData[settingsKey].ai.platforms.find((p) => p.id === 'deepseek').apiKey === 'sk-test-1234567890abcd');

  // ---- 3. 未配置密钥的可操作提示 ----
  // 重置为默认配置（密钥为空），走真实保存路径（后台有设置缓存，直接改 storageData 不会生效）
  await rpc('settings.reset', {});
  res = await rpc('ai.chat', { messages: [{ role: 'user', content: 'hi' }] });
  check('未配置密钥时提示可操作（nokey + 明确下一步）', res.ok === false && res.error.kind === 'nokey' && /设置/.test(res.error.action || '') && /API Key/.test(res.error.title + res.error.detail), JSON.stringify(res.error));
  res = await rpc('asr.transcribe', { platformId: 'siliconflow', base64: Buffer.alloc(8).toString('base64') });
  check('语音识别未配置密钥时也给出明确提示', res.ok === false && res.error.kind === 'nokey' && /语音识别/.test(res.error.title + res.error.action), JSON.stringify(res.error));

  const withKeys = JSON.parse(JSON.stringify(save.data));
  withKeys.ai.platforms.find((p) => p.id === 'deepseek').apiKey = 'sk-test-1234567890abcd';
  withKeys.asr.platforms.find((p) => p.id === 'siliconflow').apiKey = 'sk-test-1234567890abcd';
  withKeys.search.platforms.find((p) => p.id === 'tavily').apiKey = 'tvly-x';
  withKeys.search.platforms.find((p) => p.id === 'bocha').apiKey = 'bocha-x';
  withKeys.search.platforms.find((p) => p.id === 'serper').apiKey = 'serper-x';
  await rpc('settings.set', { settings: withKeys });
  const setKey = async (k) => {
    const next = JSON.parse(JSON.stringify(withKeys));
    next.ai.platforms.find((p) => p.id === 'deepseek').apiKey = k;
    await rpc('settings.set', { settings: next });
  };

  // ---- 4. 平台测试 / 模型探测 ----
  res = await rpc('platform.models', { kind: 'ai', id: 'deepseek' });
  check('探测模型列表', res.ok && res.data.models.length === 2 && res.data.models.includes('deepseek-reasoner'), JSON.stringify(res.error));
  res = await rpc('platform.test', { kind: 'ai', id: 'deepseek' });
  check('测试连接成功', res.ok && res.data.ok === true && typeof res.data.ms === 'number', JSON.stringify(res.error));
  res = await rpc('platform.test', { kind: 'asr', id: 'siliconflow' });
  check('语音识别测试连接（发送静音 WAV）', res.ok && res.data.ok === true, JSON.stringify(res.error));

  // ---- 5. 字幕下载 ----
  res = await rpc('subtitle.fetch', { url: '//aisubtitle.hdslb.com/bfs/subtitle/normal.json?deadline=1&sign=abc', pageUrl: 'https://www.bilibili.com/video/BV1xx411c7mD' });
  check('协议相对字幕地址补全为页面协议', res.ok && fetchLog.some((f) => f.url.startsWith('https://aisubtitle.hdslb.com/')), JSON.stringify(res.error));
  check('字幕 JSON 解析出行', res.ok && res.data.format === 'json-array' && res.data.lines.length === 120);
  // Referer / Origin 是 Fetch 的 forbidden header，在 service worker 里设置会被静默丢弃
  // （见 AGENTS.md 2.1）。这里断言**不再发送无效头**，但 Cookie 凭证必须带上。
  check(
    '字幕请求带 Cookie 凭证、不设 forbidden 头',
    fetchLog.some(
      (f) =>
        f.url.includes('aisubtitle') &&
        f.credentials === 'include' &&
        !f.headers.referer &&
        !f.headers.origin
    )
  );

  res = await rpc('subtitle.fetch', { url: '//aisubtitle.hdslb.com/srt/subtitle.srt', pageUrl: 'https://www.bilibili.com/video/BV1' });
  check('SRT 文本字幕也能解析', res.ok && res.data.format === 'text' && /00:00:00,500/.test(res.data.body));

  res = await rpc('subtitle.fetch', { url: '//aisubtitle.hdslb.com/missing.json', pageUrl: 'https://www.bilibili.com/video/BV1' });
  check('字幕下载失败给出可操作错误（download + 刷新提示）', res.ok === false && res.error.kind === 'download' && /刷新/.test(res.error.action), JSON.stringify(res.error));

  // ---- 5b. 官方字幕列表接口兜底（页面未解析到字幕轨时使用）----
  // 新实现：wbi 签名接口为主来源，失败再回退 player/v2；同时用 view 补视频信息
  await rpc('settings.set', {
    settings: {
      ...storageData['bsub.settings.v1'],
      ai: { ...storageData['bsub.settings.v1'].ai, platforms: storageData['bsub.settings.v1'].ai.platforms },
      asr: { ...storageData['bsub.settings.v1'].asr, platforms: storageData['bsub.settings.v1'].asr.platforms },
      search: { ...storageData['bsub.settings.v1'].search, platforms: storageData['bsub.settings.v1'].search.platforms }
    }
  });
  res = await rpc('subtitle.api', { aid: 123456, bvid: 'BV1xx411c7mD', cid: 999001, pageUrl: 'https://www.bilibili.com/video/BV1xx411c7mD' });
  check('字幕接口兜底：返回候选字幕轨', res.ok && res.data.tracks.length === 2 && res.data.tracks[0].lan === 'zh-CN', JSON.stringify(res.error || res.data).slice(0, 220));
  check('字幕接口兜底：识别 AI 字幕', res.ok && res.data.tracks.some((t) => t.lan === 'ai-zh' && t.isAi));
  check(
    '字幕接口兜底：带 Cookie 凭证、不设 forbidden Referer',
    fetchLog.some(
      (f) =>
        /x\/player(\/wbi)?\/v2/.test(f.url) &&
        f.credentials === 'include' &&
        !f.headers.Referer &&
        !f.headers.referer
    )
  );
  check('字幕接口兜底：协议相对地址被补全为 https', res.ok && res.data.tracks[0].url.startsWith('https://'), res.ok ? res.data.tracks[0].url : '');
  check('字幕接口兜底：记录有效来源', res.ok && Array.isArray(res.data.sources) && res.data.sources.length > 0, JSON.stringify(res.data && res.data.sources));
  check('字幕接口兜底：顺带补齐视频信息（时长/分P）', res.ok && !!res.data.video && res.data.video.duration === 754, JSON.stringify(res.data && res.data.video && { d: res.data.video.duration }));
  res = await rpc('subtitle.api', { bvid: 'BV1', cid: 999999 });
  check('接口返回空字幕轨时如实上报（不报错）', res.ok && res.data.tracks.length === 0, JSON.stringify(res.error || res.data).slice(0, 200));
  res = await rpc('subtitle.api', { bvid: 'BV1', cid: 888888 });
  check('接口业务错误码如实返回（code/message 可见）', res.ok && res.data.code === -404 && res.data.tracks.length === 0, JSON.stringify(res.data && { code: res.data.code, msg: res.data.message }));
  res = await rpc('subtitle.api', {});
  check('接口缺少视频标识时也能安全返回（不抛未分类异常）', res.ok === true && res.data.tracks.length === 0, JSON.stringify(res.error || res.data).slice(0, 160));

  // ---- 6. 缓存标识 ----
  const keyA = await rpc('subtitle.cache.put', {
    bvid: 'BV1',
    cid: 1,
    page: 1,
    lang: 'zh-CN',
    url: '//a.hdslb.com/s.json?deadline=1&sign=abc',
    payload: { lines: [{ from: 0, to: 1, text: 'x' }] },
    meta: {}
  });
  const hit = await rpc('subtitle.cache.get', { bvid: 'BV1', cid: 1, page: 1, lang: 'zh-CN', url: '//a.hdslb.com/s.json?deadline=999&sign=zzz' });
  check('缓存命中：不同签名命中同一缓存（去查询串）', hit.ok && hit.data.hit === true && keyA.data.key === hit.data.key);

  // ---- 7. 音轨 ----
  // 音轨现在走「页面主环境」取（Referer 只能由浏览器自动带，后台设置会被丢弃）。
  // 这里用 tabMessageHandler 模拟页面侧的 fetchAudioRange。
  const AUDIO_TOTAL = 2048;
  const audioBytes = (start, end) => {
    const size = end - start + 1;
    const arr = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) arr[i] = (0x41 + start + i) % 251;
    return arr;
  };
  const toBase64 = (u8) => Buffer.from(u8).toString('base64');
  let lastTabMessage = null;
  tabMessageHandler = (msg) => {
    lastTabMessage = msg;
    if (msg.method === 'getAudioCandidates') {
      return {
        ok: true,
        data: {
          ok: true,
          sniffed: 1,
          candidates: [
            { url: 'https://upos-sz-mirrorakam.bilivideo.com/audio/x.m4s?sig=1', bandwidth: 64000, mimeType: 'audio/mp4', source: 'playurl-sniff(wbi)', backupUrl: ['https://upos-sz-mirrorcos.bilivideo.com/audio/x.m4s?sig=2'] },
            { url: 'https://upos-sz-mirrorcos.bilivideo.com/audio/x.m4s?sig=2', bandwidth: 132000, mimeType: 'audio/mp4', source: 'playurl-sniff(wbi)', backupUrl: null }
          ]
        }
      };
    }
    if (msg.method === 'refreshAudio') {
      return { ok: true, data: { ok: true, code: 0, message: 'OK', cid: 1, audio: [{ base_url: 'https://upos-sz-mirrorakam.bilivideo.com/audio/x.m4s?sig=fresh', bandwidth: 64000 }] } };
    }
    if (msg.method === 'fetchAudioRange') {
      const p = msg.params || {};
      if (/expired/.test(p.url)) return { ok: true, data: { ok: false, reason: 'http', status: 403, contentType: 'text/plain' } };
      const start = Number(p.start) || 0;
      const end = Number.isFinite(p.end) ? Number(p.end) : AUDIO_TOTAL - 1;
      const bytes = audioBytes(start, Math.min(end, AUDIO_TOTAL - 1));
      return {
        ok: true,
        data: {
          ok: true,
          base64: toBase64(bytes),
          byteLength: bytes.length,
          status: 206,
          contentType: 'audio/mp4',
          contentRange: `bytes ${start}-${start + bytes.length - 1}/${AUDIO_TOTAL}`
        }
      };
    }
    return { ok: true, data: { ok: true } };
  };

  res = await rpc('audio.candidates', { aid: 123, bvid: 'BV1', cid: 1, signature: 'BV1@p1@c1' });
  check('音轨候选：返回多条并标注来源', res.ok && res.data.candidates.length === 2 && res.data.candidates.every((c) => !!c.source), JSON.stringify(res.error || res.data).slice(0, 200));
  // 身份签名必须原样到桥：丢了它，页面的「采集前/后一致性」校验会被静默跳过
  check(
    '音轨候选把 signature 透传给页面桥',
    lastTabMessage && lastTabMessage.method === 'getAudioCandidates' && lastTabMessage.params.signature === 'BV1@p1@c1',
    JSON.stringify(lastTabMessage && lastTabMessage.params)
  );
  check('音轨候选：带上 backupUrl', res.ok && Array.isArray(res.data.candidates[0].backupUrl));
  res = await rpc('audio.refresh', { aid: 123, bvid: 'BV1', cid: 1 });
  check('音轨地址可刷新（403 后重取新鲜地址）', res.ok && res.data.ok === true && res.data.audio.length === 1, JSON.stringify(res.error || res.data).slice(0, 200));
  res = await rpc('audio.head', { url: 'https://upos.bilivideo.com/audio/x.m4s', pageUrl: 'https://www.bilibili.com/video/BV1' });
  check('音轨探测拿到总长度（页面侧 1 字节探测）', res.ok && res.data.totalBytes === AUDIO_TOTAL && res.data.viaPage === true, JSON.stringify(res.error || res.data).slice(0, 200));
  res = await rpc('audio.range', { url: 'https://upos.bilivideo.com/audio/x.m4s', pageUrl: 'https://www.bilibili.com/video/BV1', start: 0, end: 511 });
  check('音轨分块下载返回 base64 与长度', res.ok && res.data.byteLength === 512 && typeof res.data.base64 === 'string' && String(res.data.contentRange).includes('/2048'), JSON.stringify(res.data || res.error).slice(0, 220));
  const decoded = Buffer.from(res.data.base64, 'base64');
  check('音轨 base64 可还原为正确字节', decoded.length === 512 && decoded[0] === 0x41);
  // 整条音轨直传也走同一入口：传 range 串，而不是绕回 page.call
  res = await rpc('audio.range', { url: 'https://upos.bilivideo.com/audio/x.m4s', range: 'bytes=0-' });
  check(
    '整条下载走 audio.range（range 串透传到页面）',
    res.ok && lastTabMessage && lastTabMessage.params.range === 'bytes=0-' && res.data.ok === true,
    JSON.stringify(lastTabMessage && lastTabMessage.params)
  );
  res = await rpc('audio.range', { url: 'https://upos.bilivideo.com/expired/x.m4s', pageUrl: 'https://www.bilibili.com/video/BV1', start: 0, end: 511 });
  check('音轨 403 归类为防盗链并提示刷新', res.ok === false && res.error.kind === 'audio-forbidden' && /刷新|重试/.test(res.error.action), JSON.stringify(res.error));

  // 没有可用页面时退回后台请求（此时可能仍失败，但不能崩）
  tabMessageHandler = () => ({ ok: false, error: { title: '页面不可用', detail: 'no-tab' } });
  res = await rpc('audio.range', { url: 'https://upos.bilivideo.com/expired/x.m4s', pageUrl: 'https://www.bilibili.com/video/BV1', start: 0, end: 511 });
  check('页面不可用时退回后台且不崩溃', typeof res.ok === 'boolean', JSON.stringify(res.error || res.data).slice(0, 160));
  tabMessageHandler = null;

  // ---- 8. 语音识别 ----
  const wav = Buffer.alloc(1024, 1);
  res = await rpc('asr.transcribe', { platformId: 'siliconflow', base64: wav.toString('base64') });
  check('语音识别返回文本与分段时间', res.ok && res.data.text.length > 0 && res.data.segments.length === 1, JSON.stringify(res.error));
  const asrReq = fetchLog.filter((f) => f.url.includes('/audio/transcriptions')).pop() || {};
  // 硅基流动只接受 multipart，且音频字段必须叫 file；多传 response_format/language 会 400
  const asrFields = asrReq.formFields || {};
  check('语音识别用 multipart（不是 JSON）', !!asrReq.formData && !asrReq.isJson, asrReq.isJson ? 'JSON' : 'multipart');
  check('硅基流动音频字段名是 file', !!asrFields.file, Object.keys(asrFields).join(','));
  check('硅基流动只发 file + model', Object.keys(asrFields).sort().join(',') === 'file,model', Object.keys(asrFields).sort().join(','));
  check('硅基流动不发 response_format', !('response_format' in asrFields));
  check('硅基流动不发 language', !('language' in asrFields));

  // ---- 9. AI 流式（SSE） ----
  const streamA = openPort();
  streamA.send({ kind: 'stream:start', rid: 'r1', route: 'ai.summarize', params: { messages: [{ role: 'user', content: '总结' }] } });
  const endA = await streamA.waitEnd();
  const deltas = streamA.received.filter((m) => m.kind === 'stream:delta').map((m) => m.text).join('');
  check('流式总结：收到 SSE 增量', deltas.includes('标题') && deltas.includes('**要点**'), JSON.stringify(deltas));
  check('流式总结：正常结束', endA.kind === 'stream:end', JSON.stringify(endA));
  check('流式总结：忽略 SSE 注释与 [DONE]', !deltas.includes('keep-alive') && !deltas.includes('[DONE]'));

  // ---- 10. 错误分类 ----
  await setKey('sk-bad-0000000000000000');
  const streamB = openPort();
  streamB.send({ kind: 'stream:start', rid: 'r2', route: 'ai.chat', params: { messages: [{ role: 'user', content: 'hi' }] } });
  const endB = await streamB.waitEnd();
  check('401 分类为「API Key 无效」并给出下一步', endB.kind === 'stream:error' && endB.error.kind === 'auth' && /设置/.test(endB.error.action || ''), JSON.stringify(endB.error));

  await setKey('sk-ratelimit-000000000');
  const streamC = openPort();
  streamC.send({ kind: 'stream:start', rid: 'r3', route: 'ai.chat', params: { messages: [{ role: 'user', content: 'hi' }] } });
  const endC = await streamC.waitEnd();
  check('429 分类为「触发限流」并建议降并发', endC.kind === 'stream:error' && endC.error.kind === 'rate' && /并发/.test(endC.error.action || ''), JSON.stringify(endC.error));

  await setKey('sk-nomodel-0000000000');
  const streamD = openPort();
  streamD.send({ kind: 'stream:start', rid: 'r4', route: 'ai.chat', params: { messages: [{ role: 'user', content: 'hi' }] } });
  const endD = await streamD.waitEnd();
  check('404 分类为「接口或模型不存在」并建议探测模型', endD.kind === 'stream:error' && endD.error.kind === 'model' && /探测模型/.test(endD.error.action || ''), JSON.stringify(endD.error));
  await setKey('sk-test-1234567890abcd');

  // ---- 11. 终止 ----
  const streamE = openPort();
  streamE.send({ kind: 'stream:start', rid: 'r5', route: 'ai.chat', params: { messages: [{ role: 'user', content: 'hi' }], timeoutMs: 5000 } });
  await sleep(20);
  streamE.send({ kind: 'stream:cancel', rid: 'r5' });
  const endE = await streamE.waitEnd();
  check('可终止流式任务', endE.kind === 'stream:error' && (endE.error.kind === 'aborted' || endE.error.kind === 'timeout'), JSON.stringify(endE.error));

  // ---- 12. 检索平台 ----
  res = await rpc('search.provider', { id: 'tavily', query: '测试', maxResults: 5 });
  check('Tavily 检索解析结果', res.ok && res.data.results.length === 2 && res.data.results[0].url.includes('a.example.com'), JSON.stringify(res.error));
  res = await rpc('search.provider', { id: 'bocha', query: '测试', maxResults: 5 });
  check('博查检索解析结果', res.ok && res.data.results.length === 1 && res.data.results[0].url.includes('c.example.com'), JSON.stringify(res.error));
  res = await rpc('search.provider', { id: 'serper', query: '测试', maxResults: 5 });
  check('Serper 检索解析结果', res.ok && res.data.results.length === 1 && res.data.results[0].url.includes('d.example.com'), JSON.stringify(res.error));

  // ---- 12b. DeepSeek 官方搜索（复用 AI Key） ----
  res = await rpc('search.provider', {
    id: 'deepseek-search',
    query: '帮我查一下 DeepSeek V4 最新进展',
    oriQuestion: '帮我查一下 DeepSeek V4 最新进展',
    maxResults: 5,
    fetchPageContent: true,
    timeRange: '2026-01-01'
  });
  const dsReq = fetchLog.filter((f) => f.url.includes('/v1/tools/search')).pop() || {};
  const dsBody = (() => {
    try {
      return JSON.parse(dsReq.body || '{}');
    } catch (err) {
      return {};
    }
  })();
  check(
    'DeepSeek 搜索：请求打到官方 tools/search',
    res.ok && /api\.deepseek\.com\/v1\/tools\/search$/.test(dsReq.url),
    JSON.stringify(res.error || dsReq.url)
  );
  check(
    'DeepSeek 搜索：复用 AI 平台的 DeepSeek Key',
    dsReq.headers &&
      dsReq.headers.authorization === 'Bearer sk-test-1234567890abcd',
    JSON.stringify(dsReq.headers)
  );
  check(
    'DeepSeek 搜索：检索词去掉口语前缀并带时间过滤',
    dsBody.query === 'DeepSeek V4 最新进展 after:2026-01-01',
    JSON.stringify(dsBody.query)
  );
  check(
    'DeepSeek 搜索：原问题作为 ori_question 透传',
    dsBody.ori_question === '帮我查一下 DeepSeek V4 最新进展',
    JSON.stringify(dsBody.ori_question)
  );
  check('DeepSeek 搜索：need_content 跟随「抓取正文」开关', dsBody.need_content === true, String(dsBody.need_content));
  check(
    'DeepSeek 搜索：保留 summary / 站点 / 发布时间 / 重排分',
    res.ok &&
      res.data.results[0].summary.includes('长摘要A') &&
      res.data.results[0].site === 'Example' &&
      res.data.results[0].publishedAt.startsWith('2026-10-01') &&
      res.data.results[0].score === 2.4 &&
      res.data.results[0].authority === 3,
    JSON.stringify(res.data && res.data.results && res.data.results[0])
  );
  check(
    'DeepSeek 搜索：结果按重排分排序',
    res.ok && res.data.results[0].url.includes('ds.example.com/a'),
    JSON.stringify(res.data && res.data.results && res.data.results.map((r) => r.url))
  );
  res = await rpc('search.fetch-page', { url: 'https://example.com/article' });
  check(
    'DeepSeek 搜索的正文抓取走官方 Fetch（Markdown）',
    res.ok && res.data.via === 'deepseek' && /抓取正文/.test(res.data.text),
    JSON.stringify(res.error || res.data)
  );

  // ---- 13. 页面桥接（候选标签页逐个降级） ----
  tabMessageHandler = null;
  res = await rpc('page.info', {});
  check(
    'page.info 通过内容脚本拿到视频信息（逐个候选降级）',
    res.ok === true && res.data && res.data.ok === true && res.data.tabId === 7,
    JSON.stringify(res.data || res.error).slice(0, 200)
  );

  tabMessageHandler = (msg) => {
    if (msg.method === 'getInfo') return { ok: false, error: { title: '页面数据不可用', detail: '播放器尚未就绪' } };
    return { ok: true, data: { ok: true } };
  };
  res = await rpc('page.info', {});
  check('页面失败时返回明细（不谎报成功）', res.ok === false && res.error.kind === 'alltabs' && /尝试/.test(res.error.detail || ''), JSON.stringify(res.error).slice(0, 260));
  // ---- 14. 超时 ----
  res = await rpc('search.fetch-page', { url: 'https://slow.example.com/x' });
  check('长请求有超时上限（不会永久等待）', !res.ok || typeof res.data.text === 'string', JSON.stringify(res.error || res.data).slice(0, 120));

  // ---- 15. 诊断 / 历史 / 缓存 ----
  res = await rpc('diagnostics', {});
  check('诊断信息包含版本 / 平台 / 权限', res.ok && res.data.extensionVersion === '2.9.0' && !!res.data.platformSummary && !!res.data.permissions);
  check('诊断信息不回传明文密钥', JSON.stringify(res.data).indexOf('sk-test-1234567890abcd') === -1);
  res = await rpc('history.put', { video: { bvid: 'BV1', cid: 1, page: 1, title: 'T' }, entry: { lines: [{ from: 0, to: 1, text: 'x' }] } });
  check('历史写入成功', res.ok);
  res = await rpc('history.list', {});
  check('历史可读取', res.ok && res.data.rows.length === 1 && res.data.rows[0].video.title === 'T');
  res = await rpc('cache.stats', {});
  check('缓存统计可用', res.ok && typeof res.data.subtitleCount === 'number');

  // ---- 16. 页面选项推送（按钮 / 画面字幕 / 跟随） ----
  res = await rpc('page.options', {});
  check('页面选项可推送到内容脚本', res.ok && res.data.pushed >= 1, JSON.stringify(res.error));
  check('推送内容包含播放器按钮与画面字幕开关', tabMessages.some((m) => m.msg?.method === 'applyOptions' && 'playerButton' in (m.msg.params || {})));

  console.log('\n===== 后台 service worker 端到端测试 =====');
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed += 1;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
  }
  console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
  if (errors.length) {
    console.log('运行时错误：', errors.slice(0, 10));
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('后台测试崩溃：', err && err.stack);
  process.exit(2);
});
