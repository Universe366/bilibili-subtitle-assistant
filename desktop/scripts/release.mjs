import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `desktop-v${version}`;

const changelog = fs.readFileSync(path.join(desktop, 'CHANGELOG.md'), 'utf8');
const lines = changelog.split(/\r?\n/);
const start = lines.findIndex((line) => line.trim().startsWith(`## ${version}`));
if (start < 0) {
  console.error(`CHANGELOG.md 里找不到版本 ${version}`);
  process.exit(1);
}
let end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
if (end < 0) end = lines.length;
const body = lines.slice(start + 1, end).join('\n').trim();

const outDir = path.join(desktop, 'release');
fs.mkdirSync(outDir, { recursive: true });
const notesFile = path.join(outDir, 'release-notes.md');
fs.writeFileSync(notesFile, `# 桌面端 ${version}\n\n${body}\n`, 'utf8');

console.log(`tag=${tag}`);
console.log(`notes=${path.relative(desktop, notesFile)}`);
console.log(
  `assets=release/bsub-desktop-setup-${version}.exe release/latest.yml ` +
    `release/bsub-desktop-setup-${version}.exe.blockmap ` +
    `release/B站字幕助手-${version}-win-x64-green.zip`
);
console.log('\n--- release notes ---\n');
console.log(body);
