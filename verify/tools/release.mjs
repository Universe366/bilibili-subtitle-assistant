#!/usr/bin/env node
// 从 CHANGELOG 提取当前版本的发布说明。
//
// 用法：
//   node tools/release.mjs                 # 只生成 release-notes-v<版本>.md
//
// 0.35 起桌面端与插件改为**合并发布**：Release 的 tag 是桌面版本号，
// 由 .github/workflows/desktop-release.yml 在 push tag 时构建并上传插件 zip。
// 因此这里只保留「生成说明」；`--create` 会直接报错退出，避免打出 v2.x tag
// 把 GitHub 的 Latest 顶掉（详见 docs/MAINTAINERS.md）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const EXT = path.join(ROOT, 'shizi-extension');

export function extractChangelogSection(text, version) {
  const src = String(text || '').replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^##\\s+v?${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(l));
  if (start < 0) return '';
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

export function buildReleaseBody(version, section) {
  return [
    `## B站字幕助手 v${version}`,
    '',
    section || '_该版本没有填写更新说明。_',
    '',
    '### 安装 / 更新',
    '',
    '1. 下载下方 zip 并解压（`manifest.json` 在根目录）',
    '2. `chrome://extensions` / `edge://extensions` → 开发者模式 → 加载已解压的扩展程序',
    '3. 已安装用户：下载覆盖后刷新扩展，并刷新 B 站页面',
    '',
    '### 作者的话',
    '',
    '> 此插件是本人 vibe coding 作品，有 bug 不代表本人能修；本人是新手，请各位大佬高抬贵手。遇到问题欢迎提 Issue，但请温柔一点 🙏'
  ].join('\n');
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('用法：node tools/release.mjs');
    console.log('  只生成 release-notes-v<版本>.md（合并发布已改由 CI 构建，见 docs/MAINTAINERS.md）');
    return;
  }
  const version = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version;
  const changelog = fs.readFileSync(path.join(EXT, 'CHANGELOG.md'), 'utf8');
  const section = extractChangelogSection(changelog, version);
  const body = buildReleaseBody(version, section);
  const notesPath = path.join(ROOT, `release-notes-v${version}.md`);
  fs.writeFileSync(notesPath, `${body}\n`);
  console.log(`已生成 ${notesPath}`);

  if (process.argv.includes('--create') || process.argv.includes('--update') || process.env.GITHUB_TOKEN) {
    throw new Error(
      '本脚本不再创建 GitHub Release：0.35 起为合并发布，插件 zip 由 desktop-release.yml ' +
        '随桌面 tag（v<桌面版本>）一起产出。请按 docs/MAINTAINERS.md 打 tag 并 push；' +
        '此前用插件版本打 v2.x tag 会顶掉 GitHub 的 Latest。'
    );
  }
  console.log(`\n${body}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('发布失败：', err.message);
    process.exitCode = 1;
  });
}
