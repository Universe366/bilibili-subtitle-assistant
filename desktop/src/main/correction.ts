import type { AppSettings, CorrectionRule, GlossaryTerm, SubtitleLine } from '../shared/types';

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyRule(text: string, rule: CorrectionRule): string {
  if (!rule.pattern) return text;
  if (rule.pattern.length > 500) return text;
  try {
    const source = rule.regex ? rule.pattern : escapeRegExp(rule.pattern);
    const flags = rule.caseSensitive ? 'g' : 'gi';
    return text.replace(new RegExp(source, flags), () => rule.replacement);
  } catch {
    // 非法正则可视作“本条不生效”，不影响其它规则。
    return text;
  }
}

export function applyCorrectionToText(text: string, settings: AppSettings): string {
  if (!settings.correction.enabled) return String(text || '');
  let out = String(text || '');
  for (const group of settings.correction.groups) {
    if (!group.enabled) continue;
    for (const rule of group.rules) {
      out = applyRule(out, rule);
    }
  }
  if (settings.correction.glossary.enabled) {
    for (const term of settings.correction.glossary.terms) {
      if (!term.from || !term.to) continue;
      out = out.split(term.from).join(term.to);
    }
  }
  return out;
}

export function applyCorrectionToLines(
  lines: SubtitleLine[],
  settings: AppSettings
): SubtitleLine[] {
  if (!settings.correction.enabled) return lines;
  return lines.map((line) => ({
    ...line,
    text: applyCorrectionToText(line.text, settings)
  }));
}

export function glossaryTerms(settings: AppSettings): GlossaryTerm[] {
  if (!settings.correction.glossary.enabled) return [];
  return settings.correction.glossary.terms.filter((term) => term.from.trim() && term.to.trim());
}
