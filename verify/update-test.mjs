// 更新检查的纯函数与接线检查（不访问网络）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, normalizeVersion, isNewerVersion } from '../shizi-extension/src/shared/version.js';
import {
  REPO,
  RELEASES_URL,
  findPluginAsset,
  normalizeRelease
} from '../shizi-extension/src/shared/release.js';
import { extractChangelogSection, buildReleaseBody } from './tools/release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'shizi-extension');
let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}  ${detail}`);
  }
}

check('1.64.0 比 1.63.12 新', compareVersions('1.64.0', '1.63.12') === 1, String(compareVersions('1.64.0', '1.63.12')));
check('1.63.10 比 1.63.9 新（按数字而不是字符串）', compareVersions('1.63.10', '1.63.9') === 1, '');
check('v 前缀不影响比较', compareVersions('v1.64.0', '1.64.0') === 0, '');
check('相同版本相等', isNewerVersion('1.64.0', '1.64.0') === false, '');
check('normalizeVersion 去掉 v 与后缀', normalizeVersion('v1.64.0-beta.1') === '1.64.0', normalizeVersion('v1.64.0-beta.1'));

const updateSrc = fs.readFileSync(path.join(ROOT, 'src/background/update.js'), 'utf8');
check('更新源是 GitHub Releases API', /api\.github\.com\/repos\/.+\/releases\/latest/.test(updateSrc), '');
check('手动检查绕过缓存', /if \(!manual && cached/.test(updateSrc), '');
check('404 有明确提示（私有仓库/无 Release）', /not-found/.test(updateSrc), '');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
check('manifest 申请了 alarms 权限', Array.isArray(manifest.permissions) && manifest.permissions.includes('alarms'), '');
check('内容脚本只匹配 B 站域名', manifest.content_scripts.every((c) => c.matches.every((m) => /bilibili\.com/.test(m))), '');

const settingsSrc = fs.readFileSync(path.join(ROOT, 'src/shared/settings.js'), 'utf8');
check('默认开启自动检查更新', /update:\s*\{\s*autoCheck:\s*true/.test(settingsSrc), '');
check('默认没有跳过的版本', /skipVersion:\s*''/.test(settingsSrc), '');

const swSrc = fs.readFileSync(path.join(ROOT, 'src/background/service-worker.js'), 'utf8');
check('注册 update.check / update.state', /'update\.check'/.test(swSrc) && /'update\.state'/.test(swSrc), '');
check('注册 update.skip', /'update\.skip'/.test(swSrc), '');
check('启动时初始化更新检查', /initUpdateChecker\(\)/.test(swSrc), '');

// —— 合并发布：tag 是桌面版本号，插件版本只能从资产名取 ——
const ZIP = (name, tag = 'v0.38.9') =>
  `https://github.com/Universe366/shizi/releases/download/${tag}/${name}`;
const mergedRelease = {
  tag_name: 'v0.38.9',
  tag: 'v0.38.9',
  name: '桌面端 + 插件 v0.38.9',
  html_url: 'https://github.com/Universe366/shizi/releases/tag/v0.38.9',
  body: '## 桌面端 0.38.9',
  published_at: '2026-10-24T14:55:37Z',
  assets: [
    { name: 'latest.yml', browser_download_url: ZIP('latest.yml'), size: 342 },
    { name: 'shizi-0.38.9-win-x64-green.zip', browser_download_url: ZIP('shizi-0.38.9-win-x64-green.zip'), size: 205077972 },
    { name: 'shizi-extension-v2.18.6.zip', browser_download_url: ZIP('shizi-extension-v2.18.6.zip'), size: 10983765 },
    { name: 'shizi-setup-0.38.9.exe', browser_download_url: ZIP('shizi-setup-0.38.9.exe'), size: 142522740 }
  ]
};

const merged = normalizeRelease(mergedRelease);
check('合并发布：插件版本取自资产名而不是 tag', merged && merged.version === '2.18.6', merged && merged.version);
check('合并发布：不会把桌面 tag v0.38.9 当插件版本', merged && merged.version !== '0.38.9', '');
check('合并发布：已是最新不误报更新', merged && isNewerVersion(merged.version, '2.18.6') === false, '');
check('合并发布：能识别更新的插件版本', merged && isNewerVersion('2.18.7', merged.version) === true, '');
check(
  '合并发布：下载地址指向插件 zip',
  merged && /\/shizi-extension-v2\.18\.6\.zip$/.test(merged.downloadUrl),
  merged && merged.downloadUrl
);
check('合并发布：绿色包不会被当成插件包', merged && !/green\.zip$/.test(merged.downloadUrl), '');
check('合并发布：release 链接保留 Release 页', merged && merged.htmlUrl.includes('/releases/tag/v0.38.9'), '');
check('合并发布：非 legacy', merged && merged.legacy === false, '');

const desktopOnly = normalizeRelease({
  tag_name: 'v0.39.0',
  assets: [{ name: 'shizi-setup-0.39.0.exe', browser_download_url: ZIP('shizi-setup-0.39.0.exe', 'v0.39.0') }]
});
check('只发桌面端的 Release 返回 null（提示没有插件包）', desktopOnly === null, '');

const legacyRelease = normalizeRelease({ tag_name: 'v2.18.7', assets: [] });
check('旧仓库 tag v2.18.7 仍能识别', legacyRelease && legacyRelease.version === '2.18.7', legacyRelease && legacyRelease.version);
check('旧仓库标记为 legacy', legacyRelease && legacyRelease.legacy === true, '');

const noVersion = normalizeRelease({ tag_name: 'v0.38.9', assets: [] });
check('桌面 tag + 无插件资产返回 null', noVersion === null, '');
check('空 JSON 返回 null', normalizeRelease(null) === null && normalizeRelease({}) === null, '');

const bareAsset = normalizeRelease({
  tag_name: 'v0.40.0',
  assets: [{ name: 'shizi-extension-2.19.0.zip', browser_download_url: ZIP('shizi-extension-2.19.0.zip', 'v0.40.0') }]
});
check('资产名允许不带 v 前缀', bareAsset && bareAsset.version === '2.19.0', bareAsset && bareAsset.version);
check('findPluginAsset 直接可用', findPluginAsset(mergedRelease.assets).version === '2.18.6', '');
check('findPluginAsset 对空资产返回 null', findPluginAsset([]) === null && findPluginAsset(undefined) === null, '');

check('发布仓库是 Universe366/shizi', REPO === 'Universe366/shizi', REPO);
check('下载页不再指向已删除的 shizi-extension 仓库', !RELEASES_URL.includes('shizi-extension'), RELEASES_URL);
check(
  'update.js 复用 shared/release.js，不再自带 tag 解析',
  /from '\.\.\/shared\/release\.js'/.test(updateSrc) && !/tag_name[^\n]*replace\(\/\^v\/i/.test(updateSrc),
  ''
);
const uiSrc = fs.readFileSync(path.join(ROOT, 'src/sidepanel/modules/panel-settings.js'), 'utf8');
check(
  '设置页下载链接不再硬编码旧仓库',
  !/github\.com\/Universe366\/shizi-extension/.test(uiSrc),
  ''
);
check('设置页有检查更新按钮', /'检查更新'/.test(uiSrc), '');
check('设置页有下载页按钮', /'打开下载页'/.test(uiSrc), '');
check('设置页有跳过此版本按钮', /'跳过此版本'/.test(uiSrc), '');
check('设置页显示新版本说明', /新版本说明/.test(uiSrc), '');
check('设置页有自动检查开关', /自动检查更新/.test(uiSrc), '');
check(
  '发布脚本能从 CHANGELOG 提取对应版本',
  extractChangelogSection('## 2.0.0（2026-01-01）\n- A\n\n## 1.9.0（2026-01-01）\n- B', '2.0.0') === '- A',
  ''
);
check('发布脚本会补安装说明', /### 安装 \/ 更新/.test(buildReleaseBody('2.0.0', '- A')), '');
check(
  '发布脚本支持 --update 覆盖已有 Release',
  /--update/.test(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'tools/release.mjs'), 'utf8')),
  ''
);

console.log(`合计 ${pass + fail} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
