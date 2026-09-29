// 端到端复现用户报的 ASR 400：
// 直接加载真实的 service-worker.js，模拟硅基流动的两个接口：
//   POST /v1/audio/transcriptions → 400 且空响应体（模型名不对时就是这样）
//   GET  /v1/models              → 返回该平台真正支持的模型列表
// 断言：错误里必须出现「模型列表里没有 xxx」+ 可用模型，而不是只有静态建议。
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '..', 'bilibili-subtitle-assistant');

const results = [];
const check = (name, ok, extra = '') => results.push({ name, ok: !!ok, extra });

// ---- 假的硅基流动服务端 ----
const SILICONFLOW_MODELS = ['FunAudioLLM/SenseVoiceSmall', 'TeleAI/TeleSpeechASR', 'Qwen/Qwen2.5-7B-Instruct', 'BAAI/bge-m3'];
const requestLog = [];
let asrResponse = () => new Response('', { status: 400 });
// chat/completions 分支独立控制：默认也拒绝（用于「所有形态都失败」的用例）
let emptySpeechResponse = () => new Response('', { status: 400 });
let modelsResponse = () =>
  new Response(JSON.stringify({ object: 'list', data: SILICONFLOW_MODELS.map((id) => ({ id, object: 'model' })) }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const entry = { url: u, method: (init.method || 'GET').toUpperCase(), fields: null, headers: init.headers || {} };
  if (init.body && typeof init.body.entries === 'function') {
    entry.fields = {};
    for (const [k, v] of init.body.entries()) entry.fields[k] = v && v.size != null ? `<blob ${v.size}>` : String(v);
  }
  requestLog.push(entry);
  // 三种传输方式都拒绝（这才是「所有形态都试过仍失败」的场景）
  if (/\/audio\/transcriptions$/.test(u)) return asrResponse(entry);
  if (/\/chat\/completions$/.test(u)) return emptySpeechResponse();
  if (/\/models$/.test(u)) return modelsResponse(entry);
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};

// ---- chrome 桩 ----
const settings = {
  schema: 1,
  general: { theme: 'system', fontScale: 1, layout: 'one', autoFollow: true, showInlineActions: 'hover', firstRun: false, wizardDone: true },
  ai: { activeId: 'deepseek', platforms: [{ id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-x', models: [] }], temperature: 0.3, maxTokens: 4096, stream: true },
  asr: {
    activeId: 'siliconflow',
    platforms: [
      {
        id: 'siliconflow',
        name: '硅基流动（SiliconFlow）',
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'XingChenAGI/XingChenASR-V3.2',
        transport: 'multipart',
        paramStyle: 'minimal',
        keyField: 'file',
        apiKey: 'sk-test-key',
        models: []
      }
    ],
    concurrency: 2,
    timeoutSeconds: 180,
    sizeLimitMB: 50,
    sliceSeconds: 300,
    overlapSeconds: 4,
    autoOptimizeAfter: false,
    autoApplyAfter: false
  },
  prompt: { activeId: 'd', templates: [{ id: 'd', name: 'd', text: 'x' }], chatPrefix: '' },
  optimize: { activeGroupId: 'g', groups: [{ id: 'g', name: 'g', rules: [] }], glossary: [], useSearch: false, searchMaxResults: 3 },
  search: { activeId: 't', platforms: [{ id: 't', name: 'Tavily', baseUrl: 'https://api.tavily.com/search', apiKey: 'x', kind: 'tavily' }], engine: 'bing', maxResults: 6, fetchPageContent: false },
  exportCfg: {},
  page: {},
  behavior: {},
  batch: {},
  cache: {},
  diagnostics: { verbose: false }
};

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const storage = { 'bsub.settings.v1': settings };
globalThis.chrome = {
  runtime: {
    id: 'test',
    lastError: null,
    getManifest: () => ({ version: '1.3.0' }),
    getURL: (p) => `chrome-extension://test/${p}`,
    onInstalled: { addListener: () => {} },
    onMessage: { addListener: (fn) => (globalThis.__bsubTestListeners = (globalThis.__bsubTestListeners || []).concat(fn)) },
    onConnect: { addListener: () => {} },
    sendMessage: () => Promise.resolve()
  },
  storage: {
    local: {
      get: (k) => Promise.resolve(typeof k === 'string' ? { [k]: storage[k] } : Object.fromEntries((k || []).map((x) => [x, storage[x]]))),
      set: (o) => {
        Object.assign(storage, o);
        return Promise.resolve();
      },
      remove: () => Promise.resolve()
    },
    onChanged: { addListener: () => {} }
  },
  tabs: { query: () => Promise.resolve([]), sendMessage: () => Promise.resolve({ ok: false, error: { title: 'no tab' } }), onRemoved: { addListener: () => {} }, onActivated: { addListener: () => {} }, onUpdated: { addListener: () => {} } },
  permissions: { contains: () => Promise.resolve(true), request: () => Promise.resolve(true), getAll: () => Promise.resolve({ origins: [] }) },
  sidePanel: { setPanelBehavior: () => Promise.resolve(), setOptions: () => Promise.resolve() },
  webNavigation: { onHistoryStateUpdated: { addListener: () => {} }, onCommitted: { addListener: () => {} } },
  declarativeNetRequest: { updateSessionRules: () => Promise.resolve(), getSessionRules: () => Promise.resolve([]) },
  action: { onClicked: { addListener: () => {} } },
  windows: { WINDOW_ID_CURRENT: -2 },
  scripting: { executeScript: () => Promise.resolve([]) }
};
globalThis.self = globalThis;
globalThis.window = dom.window;
globalThis.document = dom.window.document;

// 用 RPC 分发器直接调（等价于侧边栏发来的消息）
const worker = await import('../bilibili-subtitle-assistant/src/background/service-worker.js');
const send = (method, params) =>
  new Promise((resolve) => {
    const handled = worker.__dispatch
      ? worker.__dispatch({ kind: 'rpc', id: 'x', method, params })
      : null;
    if (handled && typeof handled.then === 'function') {
      handled.then(resolve);
      return;
    }
    // 没有导出分发器就直接调用内部实现：用 onMessage 监听器
    const listeners = globalThis.__bsubTestListeners || [];
    if (listeners.length) {
      listeners[0]({ kind: 'rpc', id: 'x', method, params }, {}, resolve);
      return;
    }
    resolve({ ok: false, data: { title: '无法调用' } });
  });

// 采集 service worker 注册的 onMessage 监听器
globalThis.__bsubTestListeners = [];
const origChrome = globalThis.chrome;
origChrome.runtime.onMessage = {
  addListener: (fn) => {
    globalThis.__bsubTestListeners.push(fn);
  }
};
// 重新 import 以捕获监听器（ESM 有缓存，这里直接用已加载的模块）
const { handleRpc } = await (async () => {
  try {
    return await import('../bilibili-subtitle-assistant/src/background/service-worker.js');
  } catch (err) {
    return {};
  }
})();

void handleRpc;
void send;

// 走到这里如果拿不到分发器，就退化成直接测 providers（仍然覆盖核心逻辑）
const providers = await import('../bilibili-subtitle-assistant/src/background/providers.js');

let err = null;
try {
  await providers.testAsrPlatform(settings.asr.platforms[0]);
} catch (e) {
  err = e;
}

check('测试连接会失败（模型名不属于该平台）', !!err, err && err.message);
check('失败原因分类为参数错误', !!err && err.kind === 'badparams', err && err.kind);

const detail = (err && err.payload && err.payload.detail) || '';
check('错误详情里带上请求方法与地址', /POST https:\/\/api\.siliconflow\.cn\/v1\/audio\/transcriptions/.test(detail), detail.slice(0, 160));
check('错误详情里带上实际发送的模型名', /XingChenAGI\/XingChenASR-V3\.2/.test(detail), detail.slice(0, 160));
check('自动查了 /models', requestLog.some((r) => /\/models$/.test(r.url)), requestLog.map((r) => r.method + ' ' + r.url).join(' | '));
check('明确指出模型不在该平台的列表里', /模型列表里没有/.test(detail), detail.slice(0, 400));
check('列出了可用的语音识别模型', /FunAudioLLM\/SenseVoiceSmall/.test(detail) && /TeleAI\/TeleSpeechASR/.test(detail), detail.slice(0, 500));
check('extra.available 带回完整模型列表（供 UI 使用）', !!(err && err.payload && err.payload.extra && Array.isArray(err.payload.extra.available) && err.payload.extra.available.length === 4), JSON.stringify(err && err.payload && err.payload.extra));
// 用户应该能看到的两句关键话（1.3.0 新增）
check('用户可见文案：「模型列表里没有 "XingChenAGI/XingChenASR-V3.2"」', detail.includes('模型列表里没有 "XingChenAGI/XingChenASR-V3.2"'), detail.slice(0, 400));
check('用户可见文案：可用的语音识别模型', detail.includes('可用的语音识别模型：FunAudioLLM/SenseVoiceSmall、TeleAI/TeleSpeechASR'), detail.slice(0, 400));

// 请求形态本身必须是对的（否则我们会误判成配置问题）
const asrReq = requestLog.find((r) => /transcriptions$/.test(r.url));
check('请求是 multipart 且只带 file + model', !!asrReq && !!asrReq.fields && Object.keys(asrReq.fields).sort().join(',') === 'file,model', asrReq ? JSON.stringify(Object.keys(asrReq.fields || {})) : 'no request');
check('Authorization 是 Bearer', /^Bearer /.test(String((asrReq && asrReq.headers.authorization) || '')), JSON.stringify(asrReq && asrReq.headers));

// ---- 模型名正确时：不应出现「模型不在列表」的误导提示 ----
requestLog.length = 0;
const goodPlatform = { ...settings.asr.platforms[0], model: 'FunAudioLLM/SenseVoiceSmall' };
let err2 = null;
try {
  await providers.testAsrPlatform(goodPlatform);
} catch (e) {
  err2 = e;
}
const detail2 = (err2 && err2.payload && err2.payload.detail) || '';
check('模型名一致时不误报「模型不在列表」', !!err2 && !/模型列表里没有/.test(detail2), detail2.slice(0, 240));

// ---- /models 也失败时：仍然要给出可操作提示，不能崩 ----
requestLog.length = 0;
modelsResponse = () => new Response('forbidden', { status: 403 });
let err3 = null;
try {
  await providers.testAsrPlatform(settings.asr.platforms[0]);
} catch (e) {
  err3 = e;
}
check('/models 不可用时仍给出可操作错误', !!err3 && err3.kind === 'badparams', err3 && err3.kind);
check('/models 不可用时不会崩', !/undefined|Cannot read/.test((err3 && err3.payload && err3.payload.detail) || ''), (err3 && err3.payload && err3.payload.detail || '').slice(0, 200));

// ---- 服务端返回「未检测到语音」时，测试连接应视为可用 ----
// 注意：降级阶梯里 chat/completions 也会被拒，所以 chat-audio 分支也要返回同样的提示，
// 否则「最后一次尝试」的消息会盖掉「未检测到语音」这个关键信息。
modelsResponse = () =>
  new Response(JSON.stringify({ data: SILICONFLOW_MODELS.map((id) => ({ id })) }), { status: 200, headers: { 'content-type': 'application/json' } });
const emptySpeech = () =>
  new Response(JSON.stringify({ code: 20015, message: 'The audio is empty, no speech detected' }), {
    status: 400,
    headers: { 'content-type': 'application/json' }
  });
asrResponse = emptySpeech;
emptySpeechResponse = emptySpeech;
let out4 = null;
let err4 = null;
try {
  out4 = await providers.testAsrPlatform(settings.asr.platforms[0]);
} catch (e) {
  err4 = e;
}
check('「未检测到语音」被判为接口可达（不当配置错误）', !!out4 && out4.ok === true, err4 ? `threw ${err4.message}` : JSON.stringify(out4));

console.log('\n===== 语音识别 400 端到端复现 =====');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
}
console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
