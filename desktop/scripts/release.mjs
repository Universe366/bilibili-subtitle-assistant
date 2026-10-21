import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
const extManifest = JSON.parse(
  fs.readFileSync(path.resolve(desktop, '../bilibili-subtitle-assistant/manifest.json'), 'utf8')
);

const desktopVersion = pkg.version;
const extVersion = extManifest.version;
const tag = `v${extVersion}`;

function section(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().startsWith(`## ${version}`));
  if (start < 0) return '';
  let end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}

const desktopBody = section(fs.readFileSync(path.join(desktop, 'CHANGELOG.md'), 'utf8'), desktopVersion);
if (!desktopBody) {
  console.error(`桌面端 CHANGELOG.md 里找不到版本 ${desktopVersion}`);
  process.exit(1);
}
const extensionBody = section(
  fs.readFileSync(path.resolve(desktop, '../bilibili-subtitle-assistant/CHANGELOG.md'), 'utf8'),
  extVersion
);

const outDir = path.join(desktop, 'release');
fs.mkdirSync(outDir, { recursive: true });
const notesFile = path.join(outDir, 'release-notes.md');
fs.writeFileSync(
  notesFile,
  [
    `# 桌面端 ${desktopVersion} + 插件 ${extVersion}`,
    '',
    `## 桌面端 ${desktopVersion}`,
    '',
    desktopBody,
    '',
    `## 浏览器插件 v${extVersion}`,
    '',
    extensionBody || '- 安装包：bilibili-subtitle-assistant-v' + extVersion + '.zip',
    '',
    `- 安装包：bilibili-subtitle-assistant-v${extVersion}.zip`,
    ''
  ].join('\n'),
  'utf8'
);

console.log(`tag=${tag}`);
console.log(`desktop=${desktopVersion} extension=${extVersion}`);
console.log(`notes=${path.relative(desktop, notesFile)}`);
console.log(
  `assets=release/bsub-desktop-setup-${desktopVersion}.exe release/latest.yml ` +
    `release/bsub-desktop-${desktopVersion}-win-x64-green.zip ` +
    `release/bilibili-subtitle-assistant-v${extVersion}.zip`
);
console.log('\n--- release notes ---\n');
console.log(desktopBody);
if (extensionBody) console.log(`\n[插件]\n${extensionBody}`);
