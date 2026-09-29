// 验证主环境桥的「网络嗅探」：页面自己请求字幕时能被截获
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXT = path.resolve(__dirname, '..', 'bilibili-subtitle-assistant');
const results = [];
const check = (name, ok, extra = '') => results.push({ name, ok: !!ok, extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SUBTITLE_JSON = JSON.stringify({
  body: [
    { from: 0.5, to: 2.0, content: '嗅探到的第一句' },
    { from: 2.0, to: 4.0, content: '嗅探到的第二句' }
  ]
});

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://www.bilibili.com/video/BV1xx411c7mD/?p=1',
  runScripts: 'dangerously',
  pretendToBeVisual: true
});
const w = dom.window;
const doc = w.document;

// 注入一个「假播放器」：它会用 fetch 和 XHR 各请求一次字幕
w.eval(`
  window.__realFetches = 0;
  window.__xhrStatus = 'pending';
  window.__playerMock = function () {
    // ① 用 fetch 拉字幕
    var p1 = window.fetch('https://aisubtitle.hdslb.com/bfs/subtitle/zh.json?auth_key=abc', { credentials: 'include' });
    // ② 用 XHR 拉另一条字幕
    var x = new XMLHttpRequest();
    x.open('GET', 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/ai-zh.json?auth_key=def');
    x.onload = function () { window.__xhrStatus = x.status; };
    x.send();
    return p1;
  };
`);

// 提供一个最简 fetch / XHR 实现（页面侧真实逻辑，桥只做包装）
w.fetch = async (url) => {
  w.__realFetches += 1;
  return new Response(SUBTITLE_JSON, { status: 200, headers: { 'content-type': 'application/json' } });
};
w.XMLHttpRequest = class {
  open(method, url) {
    this._url = url;
  }
  addEventListener(type, fn) {
    if (type === 'load') this._onload = fn;
  }
  send() {
    this.status = 200;
    this.responseType = '';
    this.responseText = SUBTITLE_JSON;
    setTimeout(() => {
      try {
        if (this._onload) this._onload();
      } catch (e) { /* sniff 回调异常不影响页面 */ }
      try {
        if (this.onload) this.onload();
      } catch (e) { /* ignore */ }
    }, 30);
  }
};

// 注入主环境桥（document_start 时机的等价物）
const s = doc.createElement('script');
s.textContent = fs.readFileSync(path.join(EXT, 'src/content/page-bridge.js'), 'utf8');
doc.documentElement.appendChild(s);

const bridge = w.__BSUB_PAGE_BRIDGE__;
check('主环境桥已挂载', !!bridge);

// 让页面自己发起字幕请求
w.eval('window.__playerMock();');
await sleep(300);

check('fetch 钩子仍在调用真实 fetch', w.__realFetches === 1, `realFetches=${w.__realFetches}`);
check('XHR 仍正常完成', w.__xhrStatus === 200, `status=${w.__xhrStatus}`);

const sniff = bridge.sniffStatus();
check('嗅探到字幕正文（fetch + XHR 各一份）', sniff.count === 2, `count=${sniff.count}`);

// 通过通道取 bundle，确认嗅探内容进入了候选轨
const contentEl = doc.getElementById('__bsub_content_channel__');
const pageEl = doc.getElementById('__bsub_page_channel__');
contentEl.textContent = JSON.stringify({ id: 'q1', method: 'getSubtitleBundle', params: {} });
contentEl.setAttribute('data-seq', '1');
await sleep(900);
let payload = null;
try {
  payload = JSON.parse(pageEl.textContent);
} catch (err) {
  payload = null;
}
const tracks = (payload && payload.data && payload.data.tracks) || [];
check('getSubtitleBundle 返回嗅探到的轨道', tracks.length === 2, JSON.stringify(tracks.map((t) => t.lanDoc)));
check('嗅探轨道自带正文（无需再下载）', tracks.every((t) => Array.isArray(t.body) && t.body.length === 2), JSON.stringify(tracks.map((t) => (t.body || []).length)));
check('bundle 标记了 network-sniff 来源', ((payload && payload.data && payload.data.sources) || []).includes('network-sniff'), JSON.stringify(payload && payload.data && payload.data.sources));

// 敏感字段判定：.m4s 音轨不会被当字幕
check('敏感字段判定：.m4s 音轨不会被当字幕', !/m4s/.test(JSON.stringify(tracks)), 'ok');

// ---------------------------------------------------------------------------
// 音轨：必须在页面主环境取（Referer 由浏览器自动带）
// ---------------------------------------------------------------------------
w.__audioRequests = [];
const realFetch = w.fetch;
w.fetch = async (url, init = {}) => {
  w.__audioRequests.push({ url: String(url), headers: init.headers || {}, credentials: init.credentials });
  if (/playurl/.test(String(url))) {
    return new Response(
      JSON.stringify({
        code: 0,
        data: {
          cid: 999001,
          dash: {
            audio: [
              { base_url: 'https://upos-sz-mirrorcos.bilivideo.com/a/audio.m4s?sig=1', backup_url: ['https://upos-sz-mirrorakam.bilivideo.com/a/audio.m4s?sig=1'], bandwidth: 132000, mime_type: 'audio/mp4', codecs: 'mp4a.40.2' },
              { base_url: 'https://upos-sz-mirrorali.bilivideo.com/a/audio.m4s?sig=2', bandwidth: 64000, mime_type: 'audio/mp4', codecs: 'mp4a.40.2' }
            ]
          }
        }
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }
  if (/bilivideo\.com/.test(String(url))) {
    const range = (init.headers && (init.headers.Range || init.headers.range)) || '';
    if (/mirrorcos/.test(String(url))) {
      // 模拟防盗链：镜像 cos 节点返回 403
      return new Response('forbidden', { status: 403 });
    }
    return new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), {
      status: 206,
      headers: { 'content-type': 'audio/mp4', 'content-range': `bytes ${range.replace('bytes=', '').split('-')[0]}-7/100000` }
    });
  }
  return realFetch(url, init);
};

async function ask(method, params) {
  contentEl.setAttribute('data-seq', String(Number(contentEl.getAttribute('data-seq') || '0') + 1));
  contentEl.textContent = JSON.stringify({ id: `q${Math.random()}`, method, params: params || {} });
  await sleep(700);
  try {
    return JSON.parse(pageEl.textContent);
  } catch (err) {
    return null;
  }
}

const cands = await ask('getAudioCandidates', { aid: 123456, bvid: 'BV1xx411c7mD', cid: 999001 });
const list = (cands && cands.data && cands.data.candidates) || [];
check('getAudioCandidates 拿到音轨候选', list.length >= 2, JSON.stringify(list.map((c) => c.source)));
check('mirrorcos 节点被降权（排到最后）', list.length >= 2 && /mirrorcos/.test(list[list.length - 1].url), JSON.stringify(list.map((c) => (c.url.match(/mirror\w+/) || [''])[0])));
check('候选带 backupUrl', list.some((c) => Array.isArray(c.backupUrl) && c.backupUrl.length), 'ok');
check('候选带来源标记', list.every((c) => !!c.source), JSON.stringify(list.map((c) => c.source)));

// playurl 刷新：应该能拿到新鲜地址
const refreshed = await ask('refreshAudio', { aid: 123456, bvid: 'BV1xx411c7mD', cid: 999001 });
check('refreshAudio 重新解析出音轨', !!(refreshed && refreshed.data && refreshed.data.ok && refreshed.data.audio.length >= 2), JSON.stringify(refreshed && refreshed.data && { ok: refreshed.data.ok, n: (refreshed.data.audio || []).length }));
const playurlReqs = w.__audioRequests.filter((r) => /playurl/.test(r.url));
check('刷新时带上了 cid（不会出现 cid=null）', playurlReqs.length > 0 && playurlReqs.every((r) => !/cid=null/.test(r.url)), playurlReqs.map((r) => (r.url.match(/cid=\w+/) || ['cid=missing'])[0]).join(','));
check('拿到 wbi 密钥时自动用签名接口', playurlReqs.some((r) => /wbi\/playurl/.test(r.url)) || playurlReqs.some((r) => /\/x\/player\/playurl/.test(r.url)), playurlReqs.map((r) => (r.url.match(/\/x\/player\/\w+\/playurl/) || [''])[0]).join(','));

// 页面上下文取字节：只带 Range，不手动设 Referer/Origin/UA
const okRange = await ask('fetchAudioRange', { url: 'https://upos-sz-mirrorali.bilivideo.com/a/audio.m4s?sig=2', start: 0, end: 7 });
const rangeReq = w.__audioRequests.filter((r) => /mirrorali/.test(r.url)).pop();
check('fetchAudioRange 成功返回字节', !!(okRange && okRange.data && okRange.data.ok && okRange.data.byteLength === 8), JSON.stringify(okRange && okRange.data && { ok: okRange.data.ok, n: okRange.data.byteLength }));
check('只带 Range，不手动设 Referer（关键修复）', !!rangeReq && !!rangeReq.headers.Range && !rangeReq.headers.Referer && !rangeReq.headers.referer, JSON.stringify(rangeReq && rangeReq.headers));
check('不手动设 Origin', !!rangeReq && !rangeReq.headers.Origin && !rangeReq.headers.origin, JSON.stringify(rangeReq && rangeReq.headers));
check('credentials 用 omit（签名 URL 不需要 cookie）', !!rangeReq && rangeReq.credentials === 'omit', rangeReq && rangeReq.credentials);
check('返回 content-range（用来推断总长度）', !!(okRange && okRange.data && /\/\d+/.test(okRange.data.contentRange || '')), okRange && okRange.data && okRange.data.contentRange);

// 403 必须被如实上报，而不是当成空数据
const forbidden = await ask('fetchAudioRange', { url: 'https://upos-sz-mirrorcos.bilivideo.com/a/audio.m4s?sig=1', start: 0, end: 7 });
check('403 被如实上报为 http 失败', !!(forbidden && forbidden.data && forbidden.data.ok === false && forbidden.data.reason === 'http' && forbidden.data.status === 403), JSON.stringify(forbidden && forbidden.data));

// 200 + text/html 也算失败（防盗链页面）
w.fetch = async (url, init = {}) => {
  if (/html-intercept/.test(String(url))) {
    return new Response('<html>error</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  }
  return realFetch(url, init);
};
const htmlCase = await ask('fetchAudioRange', { url: 'https://upos-sz-mirrorali.bilivideo.com/html-intercept', start: 0, end: 7 });
check('200 + text/html 判定为防盗链页面', !!(htmlCase && htmlCase.data && htmlCase.data.ok === false && htmlCase.data.reason === 'html'), JSON.stringify(htmlCase && htmlCase.data));

// 旧版本注入脚本的场景：调用桥不存在的方法时，必须给出「刷新页面」的可操作错误，
// 而不是让上层以为「页面里真的没有音轨」。
const unknown = await ask('thisMethodDoesNotExist', {});
const unknownErr = (unknown && unknown.error) || {};
check('调用桥不支持的方法时标为 stale-bridge', unknownErr.kind === 'stale-bridge', JSON.stringify(unknownErr).slice(0, 220));
check('stale-bridge 错误里带上桥的版本', !!unknownErr.bridgeVersion, JSON.stringify(unknownErr.bridgeVersion));
check('stale-bridge 错误里列出已支持的方法', Array.isArray(unknownErr.supported) && unknownErr.supported.includes('getAudioCandidates'), JSON.stringify(unknownErr.supported));
check('stale-bridge 的操作建议是刷新页面', /刷新/.test(unknownErr.action || ''), unknownErr.action);
check('桥支持的方法列表可自查', Array.isArray(bridge.supportedMethods()) && bridge.supportedMethods().includes('fetchAudioRange'), JSON.stringify(bridge.supportedMethods()));

console.log('\n===== 网络嗅探验证 =====');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
}
console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
