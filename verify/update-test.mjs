// 更新检查的纯函数与接线检查（不访问网络）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, normalizeVersion, isNewerVersion } from '../bilibili-subtitle-assistant/src/shared/version.js';
import { extractChangelogSection, buildReleaseBody } from './tools/release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bilibili-subtitle-assistant');
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

const uiSrc = fs.readFileSync(path.join(ROOT, 'src/sidepanel/modules/panel-settings.js'), 'utf8');
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
