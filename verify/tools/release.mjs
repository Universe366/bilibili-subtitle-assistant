#!/usr/bin/env node
// 从 CHANGELOG 提取当前版本的发布说明；可选直接创建 GitHub Release。
//
// 用法：
//   node tools/release.mjs                 # 只生成 release-notes-v<版本>.md
//   node tools/release.mjs --create        # 生成并创建 Release + 上传 zip
//
// --create 需要环境变量 GITHUB_TOKEN（repo 权限）；脚本不会把 token 写进仓库。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const EXT = path.join(ROOT, 'bilibili-subtitle-assistant');
const REPO = 'Universe366/bilibili-subtitle-assistant';

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
    '3. 已安装用户：下载覆盖后刷新扩展，并刷新 B 站页面'
  ].join('\n');
}

async function api(url, opts = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('缺少 GITHUB_TOKEN 环境变量');
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'bilibili-subtitle-assistant-release',
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    /* 非 JSON */
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${(json && json.message) || text.slice(0, 300)}`);
  }
  return json;
}

async function main() {
  const version = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version;
  const changelog = fs.readFileSync(path.join(EXT, 'CHANGELOG.md'), 'utf8');
  const section = extractChangelogSection(changelog, version);
  const body = buildReleaseBody(version, section);
  const notesPath = path.join(ROOT, `release-notes-v${version}.md`);
  fs.writeFileSync(notesPath, body + '\n');
  console.log(`已生成 ${notesPath}`);

  if (!process.argv.includes('--create')) {
    console.log('\n' + body);
    return;
  }

  if (execFileSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) {
    throw new Error('工作区不干净；先提交，或去掉 --create 只生成说明');
  }

  const zipPath = path.join(ROOT, `bilibili-subtitle-assistant-v${version}.zip`);
  execFileSync('git', ['-C', ROOT, 'archive', '--format=zip', '--output', zipPath, 'HEAD:bilibili-subtitle-assistant']);
  console.log(`已打包 ${zipPath}`);

  const release = await api(`https://api.github.com/repos/${REPO}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: `v${version}`,
      target_commitish: 'master',
      name: `v${version}`,
      body,
      draft: false,
      prerelease: false
    })
  });
  console.log(`已创建 Release：${release.html_url}`);

  const asset = await api(
    `https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(path.basename(zipPath))}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: fs.readFileSync(zipPath)
    }
  );
  console.log(`已上传附件：${asset.browser_download_url}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('发布失败：', err.message);
    process.exitCode = 1;
  });
}
