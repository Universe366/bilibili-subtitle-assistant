// 用真实 Cherry Studio 的 SKILL.md 验证解析器。
// 这些文件是 Anthropic Skills 约定的实现，也是我们要兼容的格式。
import fs from 'node:fs';
import path from 'node:path';

const S = await import('../shizi-extension/src/shared/skills.js');

const results = [];
const check = (n, ok, extra = '') => results.push({ n, ok: !!ok, extra });

// ---------- 1. 合成用例：标准 frontmatter ----------
{
  const md = `---
name: demo-skill
description: >-
  当用户需要把表格的某一块抽成新文件时使用。
  该技能不会修改源文件。
version: 1.2.3
allowed-tools: Bash(agent-browser:*), Read
---

# Demo

正文第一段。

## 步骤
1. 先做这个
2. 再做那个
`;
  const sk = S.skillFromMarkdown(md, { folderName: 'demo' });
  check('解析出 name', sk.name === 'demo-skill', sk.name);
  check('解析出 version', sk.version === '1.2.3', String(sk.version));
  check('description 折行块被合并成一行', /^当用户需要把表格的某一块抽成新文件时使用。\s*该技能不会修改源文件。$/.test(sk.desc), sk.desc);
  check('正文保留 Markdown 结构', /^# Demo/.test(sk.body) && /## 步骤/.test(sk.body), sk.body.slice(0, 60));
  check('记录 allowed-tools', /Bash\(agent-browser:\*\)/.test(sk.allowedTools || ''), String(sk.allowedTools));
  check('标记来源为导入', sk.source === 'imported' && sk.sourceFormat === 'skill.md', `${sk.source}/${sk.sourceFormat}`);
  check('识别出需要本地执行的依赖', Array.isArray(sk.execDeps) && sk.execDeps.includes('Bash(...) 工具声明'), JSON.stringify(sk.execDeps));
}

// ---------- 2. 无 frontmatter：用文件名兜底 ----------
{
  const sk = S.skillFromMarkdown('# 只有正文\n\n做点什么。', { folderName: 'plain' });
  check('无 frontmatter 时用文件名作名称', sk.name === 'plain', sk.name);
  check('无 frontmatter 时不报错且正文正确', /只有正文/.test(sk.body), sk.body.slice(0, 40));
  check('hasFrontmatter 为 false', sk.hasFrontmatter === false, String(sk.hasFrontmatter));
}

// ---------- 3. 只有 frontmatter、无正文 → 必须报错 ----------
{
  let err = null;
  try {
    S.skillFromMarkdown('---\nname: x\ndescription: y\n---\n', {});
  } catch (e) {
    err = e;
  }
  check('缺少正文时抛出可读错误', !!err && /没有正文/.test(err.message), String(err && err.message));
}

// ---------- 4. 引号与单行 description ----------
{
  const sk = S.skillFromMarkdown('---\nname: q\ndescription: "带引号的说明"\n---\n正文', {});
  check('去掉 description 的成对引号', sk.desc === '带引号的说明', sk.desc);
}

// ---------- 5. 纯脚本型技能要被识别出来（浏览器无法执行）----------
{
  const sk = S.skillFromMarkdown(
    '---\nname: runner\ndescription: 跑脚本\n---\n执行 `python3 scripts/run.py --anchor x`，或 `npx agent-browser open`。',
    {}
  );
  const deps = sk.execDeps || [];
  check('识别 scripts/ 依赖', deps.includes('scripts/ 目录'), JSON.stringify(deps));
  check('识别本地脚本运行时', deps.includes('本地脚本运行时'), JSON.stringify(deps));
}

// ---------- 6. 技能菜单（渐进式披露：只给名称+描述）----------
{
  const menu = S.buildSkillMenu([
    { name: 'A', desc: '做 A 的事', body: '这里是 A 的完整正文，菜单里不应该出现' },
    { name: 'B', desc: '做 B 的事', body: '这里是 B 的完整正文，菜单里不应该出现' }
  ]);
  check('菜单包含【可用技能】标题', /【可用技能】/.test(menu), menu.slice(0, 40));
  check('菜单只列名称与描述（不塞正文）', /- A：做 A 的事/.test(menu) && !/完整正文/.test(menu), menu);
  check('空列表返回空串', S.buildSkillMenu([]) === '', '');
}

// ---------- 7. 真实 Cherry Studio 技能文件 ----------
{
  const dir = path.join(process.env.APPDATA || '', 'CherryStudio', 'Data', 'Skills');
  if (fs.existsSync(dir)) {
    const dirs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
    let parsed = 0;
    let failed = [];
    for (const d of dirs) {
      const file = path.join(dir, d.name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      try {
        const txt = fs.readFileSync(file, 'utf8');
        const sk = S.skillFromMarkdown(txt, { folderName: d.name });
        if (!sk.name || !sk.body) throw new Error('字段缺失');
        parsed += 1;
      } catch (err) {
        failed.push(`${d.name}: ${err.message}`);
      }
    }
    check('能解析真实 Cherry Studio 的 SKILL.md', parsed > 0 && failed.length === 0, `成功 ${parsed} 个，失败: ${failed.join(' | ')}`);
    if (parsed > 0) console.log(`\n（已解析 ${parsed} 个真实 SKILL.md）`);
  } else {
    console.log('\n（未找到本机 Cherry Studio 技能目录，跳过真实文件用例）');
  }
}

let failedCount = 0;
for (const r of results) {
  if (!r.ok) failedCount += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
}
console.log(`\n合计 ${results.length} 项，失败 ${failedCount} 项`);
process.exit(failedCount ? 1 : 0);
