// 打包前把浏览器扩展复制到 desktop/resources/extension，
// 供桌面端「安装浏览器插件」直接使用。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const source = path.resolve(desktop, '..', 'bilibili-subtitle-assistant');
const dest = path.join(desktop, 'resources', 'extension');

if (!fs.existsSync(path.join(source, 'manifest.json'))) {
  console.warn('[sync-extension] 未找到扩展源码，跳过:', source);
  process.exit(0);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

let files = 0;
let bytes = 0;
const skip = new Set(['.git', 'node_modules', '.DS_Store']);

function copy(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const out = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(out, { recursive: true });
      copy(src, out);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, out);
      files += 1;
      bytes += fs.statSync(src).size;
    }
  }
}

copy(source, dest);
console.log(
  `[sync-extension] ${files} files / ${(bytes / 1024 / 1024).toFixed(1)} MB -> ${path.relative(desktop, dest)}`
);
