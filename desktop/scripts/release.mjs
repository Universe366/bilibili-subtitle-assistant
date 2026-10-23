import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
const extManifest = JSON.parse(
  fs.readFileSync(path.resolve(desktop, '../shizi-extension/manifest.json'), 'utf8')
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
  fs.readFileSync(path.resolve(desktop, '../shizi-extension/CHANGELOG.md'), 'utf8'),
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
    extensionBody || '- 插件代码无功能变更。',
    '',
    '## 安装',
    '',
    '### 桌面端',
    `- 安装版：下载 \`shizi-setup-${desktopVersion}.exe\`，运行后可选安装目录。`,
    `- 绿色版：下载 \`shizi-${desktopVersion}-win-x64-green.zip\`，解压后双击 \`拾字.exe\`。`,
    '- 数据默认在 `%APPDATA%\\bsub-desktop`；卸载页默认保留数据，勾选后才会删除。',
    '- 未签名，首次运行可能被 SmartScreen 拦截，选择「更多信息 → 仍要运行」。',
    '- 自动更新只对安装版有效，并依赖本 Release 的 `latest.yml`；绿色版请手动替换。',
    '',
    '### 浏览器插件',
    `- 下载 \`shizi-extension-v${extVersion}.zip\`，解压。`,
    '- 打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式，加载解压后的 `shizi-extension/` 目录。',
    '- 更新后请在扩展页点刷新，并刷新所有已打开的 B 站页面。',
    ''
  ].join('\n'),
  'utf8'
);

console.log(`tag=${tag}`);
console.log(`desktop=${desktopVersion} extension=${extVersion}`);
console.log(`notes=${path.relative(desktop, notesFile)}`);
console.log(
  `assets=release/shizi-setup-${desktopVersion}.exe release/latest.yml ` +
    `release/shizi-${desktopVersion}-win-x64-green.zip ` +
    `release/shizi-extension-v${extVersion}.zip`
);
console.log('\n--- release notes ---\n');
console.log(desktopBody);
if (extensionBody) console.log(`\n[插件]\n${extensionBody}`);
