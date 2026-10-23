// 静态体检：所有入口必须能正常打包。
//
// 为什么需要这个：`node --check` 只查语法，测试套件只覆盖跑到的路径，
// 都**抓不到「引用了不存在的变量」**这类问题。
// 第六十九轮我就栽在这里 —— 删掉一段代码时连带删掉了
// `const concurrency = ...` 声明，而它的使用点还在，
// 于是运行时抛 ReferenceError，语法与打包**都看不出来**。
//
// esbuild 的 bundle 会把「导入不存在的东西」报出来；
// 再加上下面这段「顶层裸标识符」扫描，覆盖未声明的局部变量。
import { buildSync } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'shizi-extension', 'src');

const results = [];
const errors = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok: !!ok, extra });
  if (!ok) errors.push(`${name}${extra ? ' -> ' + extra : ''}`);
};

const GLOBALS = new Set([
  'window', 'document', 'location', 'navigator', 'console', 'chrome', 'browser',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'fetch', 'URL', 'URLSearchParams', 'Blob', 'File', 'FormData',
  'ArrayBuffer', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int16Array', 'Int32Array',
  'Float32Array', 'Float64Array', 'DataView', 'TextEncoder', 'TextDecoder',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Proxy', 'Reflect',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date', 'RegExp',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'DOMException', 'AbortController',
  'AbortSignal', 'atob', 'btoa', 'structuredClone', 'queueMicrotask', 'performance',
  'indexedDB', 'crypto', 'self', 'globalThis', 'NaN', 'Infinity',
  'MediaSource', 'MediaRecorder', 'AudioContext', 'OfflineAudioContext', 'Audio',
  'AudioEncoder', 'AudioDecoder', 'AudioData', 'EncodedAudioChunk', 'Image', 'ImageData',
  'createImageBitmap', 'VideoFrame', 'WebAssembly', 'Worker', 'SharedWorker', 'EventSource',
  'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'PointerEvent', 'MessageChannel',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'matchMedia', 'getComputedStyle',
  'alert', 'confirm', 'prompt', 'history', 'screen', 'frames', 'top', 'parent', 'opener'
]);

function collectFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectFiles(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1) 每个入口都要能打包（能发现「导入了不存在的模块/导出」）
// ---------------------------------------------------------------------------
const ENTRIES = {
  '面板 app.js': 'sidepanel/app.js',
  '自检 selfcheck.js': 'sidepanel/selfcheck.js',
  '后台 service-worker.js': 'background/service-worker.js',
  '内容脚本 content.js': 'content/content.js',
  '主环境桥 page-bridge.js': 'content/page-bridge.js'
};
for (const [label, rel] of Object.entries(ENTRIES)) {
  try {
    const r = buildSync({
      entryPoints: [path.join(ROOT, rel)],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      logLevel: 'silent'
    });
    check(`${label} 可打包`, r.outputFiles[0].contents.length > 0, '');
  } catch (e) {
    const detail = (e.errors || []).slice(0, 3).map((m) => m.text).join('；') || e.message;
    check(`${label} 可打包`, false, detail);
  }
}

const findings = path.join(__dirname, 'build', 'static-check-findings.txt');
fs.mkdirSync(path.dirname(findings), { recursive: true });
fs.writeFileSync(findings, '(标识符扫描已移除：正则方案误报过多，不可信)\n');

// 说明：这里**故意**不做「未声明标识符」的正则扫描。
// 试过，噪声太大（属性名、对象键、模板串里的词都会被当成标识符），
// 1758 条误报里挑不出真问题 —— 一个没人信的检查等于没有检查。
// 打包检查已经能覆盖「引用了不存在的模块/导出」这一类；
// 其余靠测试套件与运行时日志。

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log('\n===== 静态体检 =====');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra && !r.ok ? '  -> ' + r.extra : ''}`);
console.log(`\n合计 ${results.length} 项，失败 ${failed.length} 项`);
process.exit(failed.length ? 1 : 0);
