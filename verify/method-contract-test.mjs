// 交叉核对：主环境桥（page-bridge）支持的方法、内容脚本（content.js）转发的方法、
// 后台（service-worker）会请求的方法，三者必须一致。
//
// 这三者是各自独立维护的白名单，曾经漏同步过一次，导致
// 「内容脚本不支持该方法 getAudioCandidates」——
// 而真正的音轨方法在桥里其实是有的。这个脚本把它变成会失败的检查。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '..', 'bilibili-subtitle-assistant');

const results = [];
const check = (name, ok, extra = '') => results.push({ name, ok: !!ok, extra });

function read(rel) {
  return fs.readFileSync(path.join(EXT, rel), 'utf8');
}

// ---- 从 `const handlers = {` 起，按花括号配平取出对象体 ----
function extractHandlers(src) {
  const start = src.indexOf('const handlers = {');
  if (start < 0) return [];
  let i = src.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = src.slice(src.indexOf('{', start), end + 1);
  // 顶层键：以 4 空格缩进的 `name:`（含 async / 箭头函数写法）
  const names = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^ {4}([A-Za-z_$][\w$]*)\s*:/);
    if (m) names.push(m[1]);
  }
  return names;
}

// ---- content.js 里 PASSTHROUGH 的键 + switch 的 case ----
function extractContentMethods(src) {
  const out = new Set();
  const ps = src.indexOf('const PASSTHROUGH = {');
  if (ps >= 0) {
    const pe = src.indexOf('};', ps);
    for (const m of src.slice(ps, pe).matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\d+/g)) out.add(m[1]);
  }
  for (const m of src.matchAll(/case '([\w$]+)'/g)) out.add(m[1]);
  return out;
}

// ---- 后台会转发给内容脚本的方法：rpcPage('X') 与 page.call 传入的名字 ----
function extractBackgroundMethods(src) {
  const out = new Set();
  for (const m of src.matchAll(/rpcPage\(\s*'([\w$]+)'/g)) out.add(m[1]);
  // page.call 的 params.name 由侧边栏决定，这里只收后台自己转发的那批
  return out;
}

const bridgeSrc = read('src/content/page-bridge.js');
const contentSrc = read('src/content/content.js');
const swSrc = read('src/background/service-worker.js');

const bridgeMethods = extractHandlers(bridgeSrc);
const contentMethods = extractContentMethods(contentSrc);
const bgMethods = extractBackgroundMethods(swSrc);

// 内容脚本自己实现（不转发给桥）的方法 —— 这些是本地逻辑，不是桥的能力
const CONTENT_ONLY = new Set(['applyOptions', 'setOverlayLines', 'clearOverlay', 'getOptions']);

check('解析出桥的方法列表（非空）', bridgeMethods.length >= 8, `${bridgeMethods.length}: ${bridgeMethods.join(',')}`);
check('解析出内容脚本转发的方法（非空）', contentMethods.size >= 8, `${contentMethods.size}`);

// 1) 内容脚本必须转发桥的每一个方法（否则后台调用会得到「内容脚本不支持该方法」）
const notForwarded = bridgeMethods.filter((m) => !contentMethods.has(m));
check('内容脚本转发了桥的全部方法', notForwarded.length === 0, notForwarded.length ? `漏了: ${notForwarded.join(', ')}` : 'ok');

// 2) 内容脚本不能转发桥不存在的方法（否则桥会返回 stale-bridge）
const bridgeSet = new Set(bridgeMethods);
const bogus = [...contentMethods].filter((m) => !bridgeSet.has(m) && !CONTENT_ONLY.has(m));
check('内容脚本没有转发桥不存在的方法（本地实现除外）', bogus.length === 0, bogus.length ? `多余: ${bogus.join(', ')}` : 'ok');

// 3) 后台会请求的方法必须在桥里存在
const bgMissing = [...bgMethods].filter((m) => !bridgeSet.has(m));
check('后台请求的页面方法桥都支持', bgMissing.length === 0, bgMissing.length ? `桥缺: ${bgMissing.join(', ')}` : 'ok');

// 4) 后台请求的方法也必须被内容脚本转发
const bgNotForwarded = [...bgMethods].filter((m) => !contentMethods.has(m));
check('后台请求的页面方法内容脚本都转发', bgNotForwarded.length === 0, bgNotForwarded.length ? `漏了: ${bgNotForwarded.join(', ')}` : 'ok');

// 5) 关键方法必须真的在桥里（防止重构时误删）
for (const key of ['getInfo', 'getSubtitles', 'getSubtitleBundle', 'getAudioCandidates', 'fetchAudioRange', 'refreshAudio']) {
  check(`桥包含关键方法 ${key}`, bridgeSet.has(key), bridgeMethods.join(','));
}

console.log('\n===== 桥 / 内容脚本 / 后台 方法一致性 =====');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
}
console.log(`\n桥方法(${bridgeMethods.length}) / 内容脚本转发(${contentMethods.size}) / 后台请求(${bgMethods.size})`);
console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
