// Ensure vendor/ffmpeg works inside an MV3 extension page, and verify the constraints
// that Chrome enforces. Re-runnable; idempotent.
//
// Background / constraints discovered the hard way:
//   1. Chrome REJECTS loading an extension whose extension_pages CSP contains
//      `blob:` in script-src ("Insecure CSP value"). So script-src stays 'self'.
//   2. @ffmpeg/ffmpeg's FFmpeg class spawns `new Worker(new URL(classWorkerURL, import.meta.url),
//      { type: 'module' })`. `import.meta.url` is illegal in a classic script, and if
//      classWorkerURL is omitted it falls back to a relative "./worker.js" which cannot be
//      resolved when the api bundle itself was imported from a blob: URL.
//      => we must pass an absolute chrome-extension:// classWorkerURL, and we must strip
//         `type: 'module'`-adjacent import.meta usage from the api bundle.
//   3. The worker MUST stay an ES module: it loads the core with `await import(coreURL)`,
//      and the ESM core contains `import.meta`. Replacing that with importScripts() fails with
//      "Cannot use 'import.meta' outside a module". So we do NOT patch the worker.
//      Chrome does permit a module worker created from a chrome-extension:// URL.
//
// So this script only patches the api bundle, then asserts every constraint above.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'bilibili-subtitle-assistant');
const VENDOR = path.join(ROOT, 'vendor', 'ffmpeg');

const results = [];
const check = (n, ok, extra = '') => results.push({ n, ok: !!ok, extra });

// ---------- api bundle: remove module-worker + import.meta usage ----------
{
  const file = path.join(VENDOR, 'ffmpeg-api.js');
  let src = fs.readFileSync(file, 'utf8');
  const before = src;

  src = src.replace(
    /new Worker\(new URL\(classWorkerURL, import\.meta\.url\), \{\s*type: "module"\s*\}\)/,
    'new Worker(classWorkerURL)'
  );
  src = src.replace(
    /new Worker\(new URL\("\.\/worker\.js", import\.meta\.url\), \{\s*type: "module"\s*\}\)/,
    'new Worker(classWorkerURL, { type: "module" })'
  );
  if (src !== before) fs.writeFileSync(file, src);

  check('api bundle uses no import.meta.url', !/import\.meta\.url/.test(src), 'import.meta.url present');
  check('api bundle still exports FFmpeg', /export \{[\s\S]*?FFmpeg[\s\S]*?\}/.test(src), 'FFmpeg export missing');
  check('api bundle has no mojibake', !/[\uFFFD]/.test(src), 'replacement characters present');
}

// ---------- worker: MUST remain an ES module ----------
{
  const file = path.join(VENDOR, 'ffmpeg-worker.js');
  const src = fs.readFileSync(file, 'utf8');
  check('worker keeps dynamic core import (ESM path)', /await import\(/.test(src), 'await import( missing');
  check('worker has no mojibake', !/[\uFFFD]/.test(src), 'replacement characters present');
  const open = (src.match(/\{/g) || []).length;
  const close = (src.match(/\}/g) || []).length;
  check('worker braces balanced', open === close, `open=${open} close=${close}`);
}

// ---------- loader ----------
{
  const loader = fs.readFileSync(path.join(ROOT, 'src', 'sidepanel', 'modules', 'ffmpeg.js'), 'utf8');
  check('loader passes classWorkerURL', /classWorkerURL/.test(loader), 'classWorkerURL missing');
  check('loader does not import api via blob URL', !/import\([\s\S]{0,60}toBlobUrl/.test(loader), 'blob import found');
  check('loader passes absolute core/wasm URLs', /coreURL: extUrl\(/.test(loader) && /wasmURL: extUrl\(/.test(loader), 'core/wasm URL not via extUrl');
}

// ---------- manifest CSP ----------
{
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const csp = manifest.content_security_policy.extension_pages;
  // Chrome 拒绝扩展页 CSP 在 script-src / worker-src 里出现 blob:（会直接拒绝加载扩展）
  check('CSP script-src has no blob:', !/script-src[^;]*blob:/.test(csp), csp);
  check('CSP worker-src has no blob:', !/worker-src[^;]*blob:/.test(csp), csp);
  // WebAssembly.instantiate 需要 wasm-unsafe-eval，否则 ffmpeg.wasm 报
  // "Compiling or instantiating WebAssembly module violates ... script-src"
  check('CSP allows WebAssembly (wasm-unsafe-eval)', /wasm-unsafe-eval/.test(csp), csp);
  // 未使用内联脚本（扩展页 CSP 不允许 inline）
  check('manifest 未使用 unicode 转义写 CSP', !/\\u0027/.test(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')), 'manifest 里出现了 \\u0027 转义');
}

// ---------- required files present ----------
{
  for (const f of ['ffmpeg-api.js', 'ffmpeg-worker.js', 'ffmpeg-core.js', 'ffmpeg-core.wasm']) {
    check(`vendor 文件存在：${f}`, fs.existsSync(path.join(VENDOR, f)), 'missing');
  }
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
}
console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
