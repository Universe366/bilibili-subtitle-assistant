import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const src = path.resolve(desktop, '../bilibili-subtitle-assistant/src/content/page-bridge.js');
const dest = path.resolve(desktop, 'resources/page-bridge.js');

if (!fs.existsSync(src)) {
  console.error(`[sync-bridge] 找不到 page-bridge.js: ${src}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log(`[sync-bridge] ${fs.statSync(dest).size} bytes -> ${path.relative(desktop, dest)}`);

// 托盘图标：复用扩展的 32px 图标
const traySrc = path.resolve(desktop, '../bilibili-subtitle-assistant/icons/icon32.png');
const trayDest = path.resolve(desktop, 'resources/tray.png');
if (fs.existsSync(traySrc)) {
  fs.copyFileSync(traySrc, trayDest);
  console.log(`[sync-bridge] tray icon -> ${path.relative(desktop, trayDest)}`);
} else {
  console.warn('[sync-bridge] 找不到扩展图标，跳过托盘图标');
}
