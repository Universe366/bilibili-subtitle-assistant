// 独立验证「字幕抓取」这一层：直接调用 harvestSubtitles，用真实结构的数据喂进去。
// 这里不牵扯面板渲染，方便定位数据链路问题。
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.com/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
// navigator 在 Node 20+ 是只读的，这里不需要覆盖

const results = [];
const check = (name, ok, extra = '') => results.push({ name, ok: !!ok, extra });

// ---- 数据 ----
const VIDEO = {
  bvid: 'BV1xx411c7mD',
  aid: 123456,
  cid: 999001,
  page: 2,
  title: '测试视频',
  duration: 754,
  url: 'https://www.bilibili.com/video/BV1xx411c7mD/?p=2'
};
const SNIFFED = Array.from({ length: 240 }, (_, i) => ({ from: i * 3, to: i * 3 + 2.6, content: `第 ${i + 1} 句` }));
const API_LINES = Array.from({ length: 60 }, (_, i) => ({ from: i * 12, to: i * 12 + 11, text: `接口第 ${i + 1} 句` }));
// 当前分 P（754s）的正确字幕
const P1_LINES = Array.from({ length: 200 }, (_, i) => ({ from: i * 3.5, to: i * 3.5 + 3.2, content: `当前分 P 第 ${i + 1} 句` }));
// 接口错给的「整段视频」字幕：824 行、到 1589s
const WRONG_PART_LINES = Array.from({ length: 824 }, (_, i) => ({ from: i * 1.93, to: i * 1.93 + 1.8, text: `整段视频第 ${i + 1} 句` }));

const cacheRows = new Map();
const rpcLog = [];

// 显式的场景配置：每个用例自己声明「页面侧给什么」「接口侧给什么」「触发后页面侧给什么」，
// 避免像之前那样靠一个共享的 mode 变量串味。
const scenario = {
  // 页面侧 getSubtitleBundle 的返回值（null = 空）
  page: null,
  // 点开播放器字幕菜单后，页面侧再读一次的返回值
  pageAfterTrigger: null,
  // 接口侧 subtitle.api 的返回值
  api: null
};

function bundleFrom(tracks, sources) {
  return {
    ok: true,
    tracks: tracks || [],
    sources: sources || ['player/v2'],
    errors: [],
    needLogin: false,
    sniffCount: (tracks || []).some((t) => t.body) ? 1 : 0,
    groups: []
  };
}

const EMPTY_BUNDLE = { ok: true, tracks: [], sources: [], errors: [], needLogin: false, sniffCount: 0, groups: [] };

const SNIFFED_TRACK = {
  id: '1',
  lan: 'zh-CN',
  lanDoc: '中文（简体）',
  url: 'https://aisubtitle.hdslb.com/a/zh.json?x=1',
  isAi: false,
  body: SNIFFED,
  from: 'page'
};
const URL_ONLY_TRACK = {
  id: '1',
  lan: 'zh-CN',
  lanDoc: '中文（简体）',
  url: 'https://aisubtitle.hdslb.com/a/zh.json?x=1',
  isAi: false,
  body: null,
  from: 'page'
};
const API_TRACK = {
  id: '9',
  lan: 'zh-Hans',
  lanDoc: '中文（简体，AI）',
  url: 'https://aisubtitle.hdslb.com/a/api.json?x=9',
  isAi: true,
  from: 'api'
};
const P1_TRACK = {
  id: '3',
  lan: 'zh-CN',
  lanDoc: '中文（简体）',
  url: 'https://aisubtitle.hdslb.com/a/p1.json?x=3',
  isAi: false,
  body: P1_LINES,
  from: 'page'
};
const API_WRONG_PART = {
  tracks: [{ id: '9', lan: 'ai-zh', lanDoc: '中文（自动生成）', url: 'https://aisubtitle.hdslb.com/a/wrongpart.json?x=9', isAi: true, from: 'api' }],
  code: 0,
  message: 'OK',
  needLogin: false,
  sources: ['wbi/v2'],
  errors: [],
  video: { duration: 1589 }
};
const API_NEED_LOGIN = {
  tracks: [],
  code: 0,
  message: 'OK',
  needLogin: true,
  sources: [],
  errors: [{ source: 'wbi/v2', code: 0, message: 'need_login_subtitle' }],
  video: { duration: 754 }
};

let triggered = false;
let pageReadCount = 0;
// 从第 N 次页面读取起，返回 pageAfterRetry（模拟「多点一次菜单才拿到」）
let scenarioFrom = 2;

const settings = {
  behavior: { useLocalCache: true },
  optimize: { autoApplyAfter: false },
  asr: {}
};

function rpc(method, params) {
  rpcLog.push({ method, params });
  switch (method) {
    case 'page.call': {
      if (params.name === 'getSubtitleBundle') {
        pageReadCount += 1;
        // 页面侧只有在「点了字幕菜单之后」才可能读到字幕，而且第一次读取必定是空的
        const target = scenario.pageAfterRetry || scenario.pageAfterTrigger;
        if (target && triggered && pageReadCount >= scenarioFrom) {
          return Promise.resolve(bundleFrom(target, ['network-sniff']));
        }
        return Promise.resolve(scenario.page ? bundleFrom(scenario.page) : EMPTY_BUNDLE);
      }
      return Promise.resolve({ ok: true });
    }
    case 'subtitle.trigger':
      triggered = true;
      return Promise.resolve({ ok: true, count: 1 });
    case 'subtitle.api':
      if (!scenario.api) return Promise.reject(new Error('本用例不应调用接口'));
      return Promise.resolve(scenario.api);
    case 'subtitle.fetch': {
      const lines = /wrongpart/.test(params.url) ? WRONG_PART_LINES : API_LINES;
      return Promise.resolve({ format: 'json-array', lines, url: params.url });
    }
    case 'subtitle.cache.get': {
      const row = cacheRows.get(params.lang);
      return Promise.resolve(row ? { hit: true, key: params.lang, row } : { hit: false, key: params.lang });
    }
    case 'subtitle.cache.put':
      cacheRows.set(params.lang, { savedAt: Date.now(), payload: params.payload, meta: params.meta });
      return Promise.resolve({ key: params.lang });
    default:
      return Promise.resolve({ ok: true });
  }
}

globalThis.chrome = {
  runtime: {
    id: 'test',
    lastError: null,
    sendMessage: (msg, cb) => {
      if (msg && msg.kind === 'rpc') {
        rpc(msg.method, msg.params || {}).then((data) => cb({ kind: 'rpc:res', id: msg.id, ok: true, data })).catch((err) => cb({ kind: 'rpc:res', id: msg.id, ok: false, error: { title: String(err.message) } }));
      } else if (typeof cb === 'function') {
        cb({ ok: true });
      }
    },
    onMessage: { addListener: () => {}, removeListener: () => {} },
    connect: () => ({ onMessage: { addListener: () => {} }, onDisconnect: { addListener: () => {} }, postMessage: () => {}, disconnect: () => {} })
  },
  storage: {
    local: { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() },
    onChanged: { addListener: () => {} }
  }
};

const { harvestSubtitles } = await import('../shizi-extension/src/sidepanel/modules/subtitles.js');

// 每个用例开始前重置场景，避免上一个用例的状态串味
function resetCase(next = {}) {
  cacheRows.clear();
  rpcLog.length = 0;
  triggered = false;
  pageReadCount = 0;
  scenarioFrom = next.from || 2;
  scenario.page = next.page || null;
  scenario.pageAfterTrigger = next.pageAfterTrigger || null;
  scenario.pageAfterRetry = next.pageAfterRetry || null;
  scenario.api = next.api || null;
}

// ---- 用例 1：页面嗅探已带正文，应直接用正文（240 行），不再下载 ----
resetCase({ page: [SNIFFED_TRACK, { ...SNIFFED_TRACK, id: '2', lan: 'ai-zh', lanDoc: '中文（自动生成）', isAi: true, body: null }] });
let out = await harvestSubtitles(VIDEO, settings, { onProgress: () => {} });
check('页面已带正文时直接用正文（240 行）', out.ok && out.lines.length === 240, `ok=${out.ok} lines=${out.lines ? out.lines.length : 0}`);
check('不再调用 subtitle.fetch 下载', !rpcLog.some((r) => r.method === 'subtitle.fetch'), rpcLog.map((r) => r.method).join(','));
check('命中 zh-CN 而不是 AI 轨', out.meta && out.meta.lang === 'zh-CN', JSON.stringify(out.meta && out.meta.lang));
check('attempts 记录 stage=sniffed', (out.attempts || []).some((a) => a.stage === 'sniffed'), JSON.stringify((out.attempts || []).map((a) => a.stage)));
check('写入缓存（zh-CN）', cacheRows.has('zh-CN'), [...cacheRows.keys()].join(','));
check('时长校验通过', !!(out.meta && out.meta.validation && out.meta.validation.ok), JSON.stringify(out.meta && out.meta.validation));

// ---- 用例 2：只有地址 -> 走下载 ----
resetCase({ page: [URL_ONLY_TRACK] });
out = await harvestSubtitles(VIDEO, settings, { onProgress: () => {} });
check('只有地址时会下载正文', out.ok && rpcLog.some((r) => r.method === 'subtitle.fetch'), JSON.stringify(rpcLog.map((r) => r.method)));
check('下载得到 60 行', out.ok && out.lines.length === 60, `lines=${out.lines ? out.lines.length : 0}`);

// ---- 用例 3：页面空 + 接口兜底 ----
resetCase({ api: { tracks: [API_TRACK], code: 0, message: 'OK', needLogin: false, sources: ['wbi/v2'], errors: [], video: { duration: 754 } } });
out = await harvestSubtitles(VIDEO, settings, { onProgress: () => {} });
check('页面空时会走接口兜底', rpcLog.some((r) => r.method === 'subtitle.api'), rpcLog.map((r) => r.method).join(','));
check('接口兜底也能拿到字幕', out.ok && out.lines.length === 60, `ok=${out.ok} lines=${out.lines ? out.lines.length : 0}`);

// ---- 用例 4：完全没有字幕 -> 给出可操作原因 ----
resetCase({ api: API_NEED_LOGIN });
out = await harvestSubtitles(VIDEO, settings, { onProgress: () => {} });
check('完全没有字幕时返回 ok=false', out.ok === false, JSON.stringify(out.meta || out.lines && out.lines.length));
check('原因包含「登录」提示', /登录/.test((out.reason && out.reason.detail) || ''), (out.reason && out.reason.detail || '').slice(0, 200));
check('原因包含来源明细', /wbi\/v2|来源|need_login/.test((out.reason && out.reason.detail) || ''), (out.reason && out.reason.detail || '').slice(0, 200));
check('给出了下一步操作', !!(out.reason && out.reason.action), out.reason && out.reason.action);
check('诊断里能看到接口 needLogin 标记', !!out.diagnostic && out.diagnostic.apiNeedLogin === true, JSON.stringify(out.diagnostic && out.diagnostic.apiNeedLogin));

// ---- 用例 5：接口返回的是「整段视频 / 其它分 P」的字幕 → 触发播放器重新拉取 ----
// 这是用户实际遇到的情况：视频只有 568s，接口字幕却到 1589s。
// 页面侧一开始（以及点了菜单之后）都读不到，所以只能先用接口的超长字幕，
// 被时长校验拒用后再点一次播放器菜单，才拿到当前分 P 的正确字幕。
resetCase({
  page: null,
  pageAfterTrigger: null, // 第一次触发也读不到
  api: API_WRONG_PART, // 接口给的是整段视频的字幕（824 行 / 到 1589s）
  pageAfterRetry: [P1_TRACK], // 重试时（第 3 次读取起）拿到当前分 P 的正确字幕
  from: 3
});

out = await harvestSubtitles(VIDEO, settings, { onProgress: () => {} });
check('先试了接口给的超长字幕', (out.attempts || []).some((a) => a.from === 'api' && a.stage === 'rejected'), JSON.stringify((out.attempts || []).map((a) => [a.lan, a.from, a.stage])));
check('被拒用的候选标记了 wrongPart', (out.attempts || []).some((a) => a.wrongPart), JSON.stringify((out.attempts || []).map((a) => [a.lan, a.stage, !!a.wrongPart])));
check('分 P 不匹配时会去点播放器菜单重新拉取', rpcLog.filter((r) => r.method === 'subtitle.trigger').length >= 2, rpcLog.map((r) => r.method).join(','));
check('诊断里记录了重试结果', !!out.diagnostic && !!out.diagnostic.triggerRetry, JSON.stringify(out.diagnostic && out.diagnostic.triggerRetry));
check('重新拉取后采用当前分 P 的字幕', out.ok === true, JSON.stringify(out.reason || out.meta));
if (out.ok) {
  const last = Math.max(...out.lines.map((l) => l.to || 0));
  check('采用的字幕没有超出视频时长', last <= 754, `last=${last}`);
  check('采用的是页面侧（带 cid）的那一份', (out.meta && out.meta.from) === 'network-sniff', JSON.stringify(out.meta));
}

console.log('\n===== 字幕抓取层测试 =====');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
}
console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
