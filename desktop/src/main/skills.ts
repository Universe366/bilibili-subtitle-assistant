import fs from 'node:fs';
import type { AppSettings, SkillItem } from '../shared/types';

function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { data: {}, body: source.trim() };
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[kv[1]] = value;
  }
  return { data, body: source.slice(match[0].length).trim() };
}

export function parseSkillMarkdown(text: string, fallbackName = '导入技能'): SkillItem {
  const { data, body } = parseFrontmatter(text);
  if (!body.trim()) throw new Error('SKILL.md 没有正文');
  return {
    id: `skill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: String(data.name || fallbackName).trim() || fallbackName,
    description: String(data.description || '').trim().slice(0, 200),
    icon: String(data.icon || '✨').trim().slice(0, 8) || '✨',
    body: body.trim(),
    enabled: true,
    source: 'file'
  };
}

export function readSkillFile(file: string): SkillItem {
  const text = fs.readFileSync(file, 'utf8');
  const fallback = file.split(/[\\/]/).pop()?.replace(/\.md$/i, '') || '导入技能';
  return parseSkillMarkdown(text, fallback);
}

export function skillPrompt(settings: AppSettings): string {
  if (!settings.skills.enabled) return '';
  const items = settings.skills.items.filter((item) => item.enabled && item.body.trim());
  if (!items.length) return '';
  const menu = items.map((item) => `- ${item.name}：${item.description || '（无描述）'}`).join('\n');
  let budget = 12000;
  const bodies: string[] = [];
  for (const item of items) {
    if (budget <= 0) break;
    const body = item.body.slice(0, Math.min(4000, budget));
    budget -= body.length;
    bodies.push(`### ${item.name}\n${body}`);
  }
  return [
    '',
    '【可用技能】',
    '如果用户的问题明显匹配某个技能，请按对应技能正文执行：',
    menu,
    '',
    '【技能正文】',
    bodies.join('\n\n')
  ].join('\n');
}
