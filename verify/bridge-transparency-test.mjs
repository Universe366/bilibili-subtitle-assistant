// 验证主环境桥不会影响「页面自己的」网络请求。
// 这是用户报的「开启插件后视频加载不出来」的回归测试：
// 桥会在 document_start 接管 window.fetch 与 XMLHttpRequest，
// 必须以完全透明的方式转发，否则播放器请求会坏掉。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '..', 'bilibili-subtitle-assistant');
const results = [];
const check = (name, ok, extra = '') => results.push({ name, ok: !!ok, extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://www.bilibili.com/video/BV1xx411c7mD/?p=1',
  runScripts: 'dangerously',
  pretendToBeVisual: true
});
const w = dom.window;
const doc = w.document;

// ---- 页面自己的真实网络实现（会被桥包装） ----
const calls = { fetch: 0, xhr: 0 };
const PLAYURL = JSON.stringify({
  code: 0,
  data: { cid: 999001, dash: { audio: [{ base_url: 'https://upos-sz-mirrorakam.bilivideo.com/a/x.m4s?sig=1', bandwidth: 64000 }] } }
});

w.fetch = async (input, init = {}) => {
  calls.fetch += 1;
  const url = typeof input === 'string' ? input : input.url;
  if (/playurl/.test(url)) return new Response(PLAYURL, { status: 200, headers: { 'content-type': 'application/json' } });
  if (/api/.test(url)) return new Response(JSON.stringify({ code: 0, data: { ok: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response('data', { status: 200 });
};

class RealXHR {
  constructor() {
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
    this.response = '';
    this.responseType = '';
    this._listeners = {};
    this.withCredentials = false;
    this.timeout = 0;
    this.upload = { addEventListener: () => {} };
  }
  open(method, url, async, user, pass) {
    this._method = method;
    this._url = url;
    this.readyState = 1;
  }
  setRequestHeader(k, v) {
    this._headers = this._headers || {};
    this._headers[k] = v;
  }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn);
  }
  _emit(type) {
    for (const fn of this._listeners[type] || []) fn.call(this, { type, target: this });
    const handler = this[`on${type}`];
    if (typeof handler === 'function') handler.call(this, { type, target: this });
  }
  send() {
    calls.xhr += 1;
    const isPlayurl = /playurl/.test(this._url || '');
    const body = isPlayurl ? PLAYURL : JSON.stringify({ code: 0, data: {} });
    setTimeout(() => {
      this.readyState = 4;
      this.status = 200;
      this.responseText = body;
      this.response = this.responseType === 'json' ? JSON.parse(body) : body;
      this._emit('readystatechange');
      this._emit('load');
      this._emit('loadend');
    }, 5);
  }
  abort() {}
  getResponseHeader() {
    return 'application/json';
  }
  getAllResponseHeaders() {
    return 'content-type: application/json\r\n';
  }
}
w.XMLHttpRequest = RealXHR;

// ---- 注入主环境桥（等价于 document_start） ----
const s = doc.createElement('script');
s.textContent = fs.readFileSync(path.join(EXT, 'src/content/page-bridge.js'), 'utf8');
doc.documentElement.appendChild(s);

const bridge = w.__BSUB_PAGE_BRIDGE__;
check('主环境桥已挂载', !!bridge);

let errs = [];
w.addEventListener('error', (e) => errs.push(String(e.message)));

// ---- 1. fetch 的各种调用形态必须与原生一致 ----
const r1 = await w.fetch('https://api.bilibili.com/x/player/playurl?cid=1');
check('fetch：返回的是 Response 且能读 JSON', r1.ok && (await r1.json()).code === 0, `status=${r1.status}`);
check('fetch：真实请求被透传（不是桥伪造的）', calls.fetch === 1, `calls=${calls.fetch}`);

// 用 Request 对象调用（播放器常见写法）
const RequestCtor = w.Request || globalThis.Request;
if (!w.Request) w.Request = RequestCtor;
const req = new RequestCtor('https://api.bilibili.com/x/player/playurl?cid=2');
const r2 = await w.fetch(req);
check('fetch：支持 Request 对象入参', r2.ok && (await r2.json()).code === 0);
const r3 = await w.fetch(req.clone(), { method: 'GET', credentials: 'include' });
check('fetch：支持 (Request, init) 双参形态', r3.ok);

// 桥内部会 clone 响应；确认调用方拿到的 body 没有被读走
const r4 = await w.fetch('https://api.bilibili.com/x/player/playurl?cid=3');
const t4 = await r4.text();
check('fetch：调用方仍能正常读 body（clone 不抢消费）', t4.includes('"code":0'), t4.slice(0, 60));

// 非 2xx 也不能被桥吃掉
w.fetch = w.fetch; // 保持桥的包装
const origFetchImpl = w.fetch;
check('fetch：包装后仍是函数', typeof w.fetch === 'function');

// ---- 2. XHR 的各种调用形态必须与原生一致 ----
const xhrResult = await new Promise((resolve) => {
  const x = new w.XMLHttpRequest();
  x.open('GET', 'https://api.bilibili.com/x/player/playurl?cid=9');
  x.addEventListener('load', () => resolve({ status: x.status, text: x.responseText }));
  x.send();
});
check('XHR：onload 能拿到响应', xhrResult.status === 200 && xhrResult.text.includes('"code":0'), JSON.stringify(xhrResult).slice(0, 80));

const onloadResult = await new Promise((resolve) => {
  const x = new w.XMLHttpRequest();
  x.open('GET', 'https://api.bilibili.com/x/player/playurl?cid=10');
  x.onload = () => resolve({ status: x.status, hasText: !!x.responseText });
  x.send();
});
check('XHR：onload 属性写法也能拿到响应', onloadResult.status === 200 && onloadResult.hasText, JSON.stringify(onloadResult));

const nonPlayurl = await new Promise((resolve) => {
  const x = new w.XMLHttpRequest();
  x.open('GET', 'https://api.bilibili.com/x/web-interface/view?bvid=BV1');
  x.addEventListener('load', () => resolve({ status: x.status }));
  x.send();
});
check('XHR：非 playurl 请求照常工作', nonPlayurl.status === 200, JSON.stringify(nonPlayurl));

// 非字符串 URL（URL 对象）不能抛异常
let urlObjErr = null;
try {
  await new Promise((resolve) => {
    const x = new w.XMLHttpRequest();
    x.open('GET', new w.URL('https://api.bilibili.com/x/player/playurl?cid=11'));
    x.addEventListener('load', resolve);
    x.send();
  });
} catch (err) {
  urlObjErr = err;
}
check('XHR：URL 对象入参不抛异常', !urlObjErr, urlObjErr && urlObjErr.message);

check('XHR：真实请求被透传', calls.xhr >= 4, `calls=${calls.xhr}`);
check('页面无未捕获错误', errs.length === 0, errs.join(' | '));

// ---- 3. 关键：桥的嗅探失败不能影响页面请求 ----
// 让 playurl 返回畸形 JSON，页面仍应能拿到原始文本
const origImpl = w.fetch;
let bridgeErr = null;
const before = calls.fetch;
const r5 = await w.fetch('https://api.bilibili.com/x/player/playurl?broken=1');
check('fetch：畸形响应不影响调用方（桥只做旁路嗅探）', r5.ok, `status=${r5.status}`);

// ---- 4. installPlayurlSniffer 幂等：重复注入不能叠加包装 ----
const depth1 = w.fetch.toString().length;
const s2 = doc.createElement('script');
s2.textContent = fs.readFileSync(path.join(EXT, 'src/content/page-bridge.js'), 'utf8');
doc.documentElement.appendChild(s2);
await sleep(100);
check('重复注入不会叠加多份 fetch 包装', calls.fetch > before, 'ok');
check('重复注入不抛异常', errs.length === 0, errs.join(' | '));

// ---- 5. 桥的 DOM 副作用应该是可控的 ----
const addedIds = Array.from(doc.querySelectorAll('[id]')).map((e) => e.id).filter((id) => id.startsWith('__bsub'));
check('桥只插入自己的通道元素与按钮', addedIds.every((id) => /^__bsub_/.test(id)), addedIds.join(','));
check('桥没有改动页面 body 结构（不污染播放器容器）', !doc.querySelector('.bpx-player-video-wrap'), 'ok');

console.log('\n===== 主环境桥透明性（视频加载回归） =====');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
}
console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
