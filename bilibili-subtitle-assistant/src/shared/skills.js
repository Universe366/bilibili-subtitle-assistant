// SKILL.md 支持（对齐 Anthropic Skills / Cherry Studio 的约定）
//
// 文件形态：
//   ---
//   name: office-transform
//   description: 一段「何时使用」的说明（模型据此判断是否激活）
//   version: 1.0.0
//   allowed-tools: Bash(agent-browser:*)
//   ---
//
//   # 正文
//   具体的步骤/规范/示例……
//
// 与 Cherry Studio 的差异（必须让用户知道）：
//   Cherry Studio 是 Electron 桌面端，能启动本地进程执行技能里的脚本；
//   浏览器扩展**不能**运行 SKILL.md 里提到的命令行工具。
//   因此这里支持的是「**指令型**技能」—— 正文会作为提示词交给模型。
//   若技能依赖脚本（scripts/ 目录、Bash(...) 之类），会明确提示不可用。

// 极简 YAML frontmatter 解析：只处理 `key: value` 与 `key: >` 折行块。
// 不引入 yaml 依赖 —— 技能头部实际只用到这些形态。
export function parseFrontmatter(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { data: {}, body: src.trim(), hasFrontmatter: false };
  const rawHead = m[1];
  const body = src.slice(m[0].length).trim();
  const data = {};
  const lines = rawHead.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) {
      i += 1;
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      i += 1;
      continue;
    }
    const key = kv[1];
    let value = kv[2].trim();
    // 折行块：`key: >` 或 `key: |` —— 收集后续缩进行
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const parts = [];
      i += 1;
      while (i < lines.length && (/^\s+\S/.test(lines[i]) || !lines[i].trim())) {
        parts.push(lines[i].replace(/^\s+/, ''));
        i += 1;
      }
      const joined = parts.join('\n').trim();
      value = value.startsWith('>') ? joined.replace(/\n(?!\n)/g, ' ') : joined;
      data[key] = value;
      continue;
    }
    // 去掉成对引号
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    data[key] = value;
    i += 1;
  }
  return { data, body, hasFrontmatter: true };
}

// 技能里是否引用了需要本地执行的东西
export function detectExecutableDeps(skill) {
  const text = `${skill.body || ''}\n${skill.allowedTools || ''}`;
  const hits = [];
  if (/\bBash\s*\(/i.test(text)) hits.push('Bash(...) 工具声明');
  if (/\b(bash|cmd|powershell|sh)\b\s*[-/]/i.test(text)) hits.push('shell 命令');
  if (/\bpython3?\b|\bnode\b|\bnpx\b|\bpip\b/i.test(text)) hits.push('本地脚本运行时');
  if (/scripts\//i.test(text)) hits.push('scripts/ 目录');
  return hits;
}

// 把 SKILL.md 文本转成本扩展的技能对象
export function skillFromMarkdown(text, opts = {}) {
  const { data, body, hasFrontmatter } = parseFrontmatter(text);
  const folder = String(opts.folderName || data.name || '').trim();
  const name = String(data.name || folder || opts.fallbackName || '未命名技能').trim();
  const description = String(data.description || '').trim();
  if (!body.trim()) {
    throw new Error('SKILL.md 没有正文内容');
  }
  const allowedTools = String(data['allowed-tools'] || data.allowed_tools || '').trim();
  const skill = {
    id: opts.id || `skill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    icon: opts.icon || '📄',
    name,
    desc: description ? description.slice(0, 200) : '（来自 SKILL.md）',
    body: body.trim(),
    source: 'imported',
    sourceFormat: 'skill.md',
    version: String(data.version || '').trim() || undefined,
    allowedTools: allowedTools || undefined,
    hasFrontmatter
  };
  const deps = detectExecutableDeps(skill);
  if (deps.length) skill.execDeps = deps;
  return skill;
}

// 从一批文件里识别出 SKILL.md（支持用户选择整个目录）
export function pickSkillFiles(fileList) {
  const files = Array.from(fileList || []);
  return files.filter((f) => /(^|\/)SKILL\.md$/i.test(f.name || f.webkitRelativePath || ''));
}

// 由技能推导「何时使用」的提示词片段。
// Cherry Studio / Anthropic 的约定：description 就是触发条件，
// 所以技能很多时先只给模型「名称 + 描述」，由模型自己决定用哪个。
export function buildSkillMenu(skills) {
  if (!skills || !skills.length) return '';
  return (
    '\n\n【可用技能】\n' +
    '下面是可用的技能清单。如果用户的问题明显匹配某个技能的 description，请按其正文执行：\n' +
    skills.map((s) => `- ${s.name}：${s.desc || '（无描述）'}`).join('\n')
  );
}
