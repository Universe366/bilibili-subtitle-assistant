// 跨模块「用了但没导入」体检。
//
// 为什么需要：第十一轮我修 `runTranscribe` 没挂到面板上时，
// 已经吃过一次「所有测试通过、代码却跑不起来」的亏；
// 这一次（分段总结）我又引用了 subtitles.js 的 `fmtClock`，
// 而它当时只是本文件内的 `function` —— **没导出、也没导入**。
//
// 语法检查、esbuild 打包、静态体检**都发现不了**：
//   · esbuild 只会报「导入不存在的东西」，不会报「直接用了别的模块的函数」
//   · 因为它看起来就是个**未声明的标识符**，语法上完全合法
//
// 这个检查专门盯这一类：**在 A 模块里调用了一个名字，
// 该名字既不在 A 的声明里，也不在 A 的导入里，但在 B 模块里被导出了。**
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', 'bilibili-subtitle-assistant', 'src');

const results = [];
const errors = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok: !!ok, extra });
  if (!ok) errors.push(`${name}${extra ? ' -> ' + extra : ''}`);
};

function collectFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectFiles(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');

// 1) 收集每个文件导出的名字
const files = collectFiles(ROOT);
const exportedBy = new Map(); // name -> [files]
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n);
    }
  }
  for (const n of names) {
    if (!exportedBy.has(n)) exportedBy.set(n, []);
    exportedBy.get(n).push(path.relative(ROOT, f));
  }
}

// 2) 只检查「A 确实导入了 B 的某些东西，却用了 B 的另一个没导入的导出」
//
// 这样限定范围是为了**零误报**：
//   · 不去判断「某个裸名字是不是方法名」（`.get(`、`.clear(` 会误报）
//   · 只在「A 已经 import 了 B」这条**明确的依赖边**上查漏
// 用户遇到的那次（panel-ai 用了 subtitles 的 fmtClock 却没导入）
// 正好落在这个范围内 —— 因为 panel-ai 本来就 import 了 subtitles。
const suspects = [];
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const src = strip(raw);
  const self = path.relative(ROOT, f);
  // 本文件已声明的名字
  const declared = new Set();
  for (const m of src.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s*[[{]([^\]}]*)[\]}]/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().replace(/[:=].*$/, '').replace(/^\.\.\./, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n);
    }
  }
  for (const m of src.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().replace(/[:=].*$/, '').replace(/^\.\.\./, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n);
    }
  }
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  const imported = new Set();
  for (const m of src.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]/g)) {
    const clause = m[1];
    // 默认导入 / 命名空间导入：import X from / import * as X from
    const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (ns) imported.add(ns[1]);
    for (const part of clause.replace(/[{}]/g, ' ').split(',')) {
      // `a as b` → b 是本地名；`{ a as b }` 同理
      const local = part.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(local)) imported.add(local);
    }
  }
  // 对象字面量简写 `{ harvest }` 等价于 `{ harvest: harvest }`，
  // 所以本文件所有出现的对象键也算「已声明/已用别名」——
  // 直接把对象键收进 declared，避免把 `{ harvest: contextHarvest }`
  // 里的键名 harvest 误判成未导入的标识符。
  for (const m of src.matchAll(/(^|[{,]\s*)([A-Za-z_$][\w$]*)\s*:/gm)) declared.add(m[2]);

  // 本文件 import 的模块 → 它们导出的名字
  const importedModules = new Set();
  for (const m of raw.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(f), spec);
    importedModules.add(resolved);
  }
  for (const mod of importedModules) {
    const rel = path.relative(ROOT, mod);
    const modFile = files.find((x) => path.relative(ROOT, x) === rel);
    if (!modFile) continue;
    const modSrc = fs.readFileSync(modFile, 'utf8');
    // 该模块导出的名字
    const modExports = new Set();
    for (const m of modSrc.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) modExports.add(m[1]);
    for (const m of modSrc.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) modExports.add(m[1]);
    for (const m of modSrc.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const n = part.trim().split(/\s+as\s+/).pop().trim();
        if (/^[A-Za-z_$][\w$]*$/.test(n)) modExports.add(n);
      }
    }
    for (const name of modExports) {
      if (declared.has(name) || imported.has(name)) continue;
      if (name.length < 4) continue; // 短名字太容易与方法名/属性撞，跳过
      // 该名字在本文件里被**当作值使用**（前面不是点/字母数字，
      // 后面不是 : —— 排除对象键）
      const used = new RegExp(`(?<![.\\w$])${name}\\b(?!\\s*:)`);
      if (used.test(src)) {
        suspects.push({ file: self, name, definedIn: rel });
      }
    }
  }
}

const uniq = new Map();
for (const s of suspects) uniq.set(`${s.file}::${s.name}`, s);
const list = [...uniq.values()];

check(
  '没有「用了别的模块的函数但没导入」',
  list.length === 0,
  list.length
    ? list.map((s) => `${s.file} 用了 ${s.name}（定义在 ${s.definedIn}）但未导入`).join('；')
    : ''
);

// 明确锁住这次修的那个
check(
  'panel-ai 导入了 fmtClock',
  /import\s*\{[^}]*\bfmtClock\b[^}]*\}\s*from\s*['"]\.\/subtitles\.js['"]/.test(
    fs.readFileSync(path.join(ROOT, 'sidepanel', 'modules', 'panel-ai.js'), 'utf8')
  ),
  ''
);

console.log('\n===== 跨模块导入体检 =====');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? '  -> ' + r.extra : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
if (failed) {
  console.log('\n提示：这类问题运行时才会抛 ReferenceError，语法检查与打包都发现不了。');
}
process.exit(failed ? 1 : 0);
