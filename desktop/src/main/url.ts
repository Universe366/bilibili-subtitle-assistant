export type SearchEngine = 'bilibili' | 'bing' | 'google' | 'custom';

export interface SearchPreference {
  engine?: SearchEngine;
  customUrl?: string;
}

const SEARCH_TEMPLATES: Record<Exclude<SearchEngine, 'custom'>, string> = {
  bilibili: 'https://search.bilibili.com/all?keyword=',
  bing: 'https://www.bing.com/search?q=',
  google: 'https://www.google.com/search?q='
};

/** 自定义模板必须含 {q}；否则退回 B 站站内搜索。 */
function searchUrl(raw: string, pref?: SearchPreference): string {
  const engine = pref?.engine || 'bilibili';
  if (engine === 'custom') {
    const template = String(pref?.customUrl || '').trim();
    if (template.includes('{q}')) return template.replace('{q}', encodeURIComponent(raw));
    return `${SEARCH_TEMPLATES.bilibili}${encodeURIComponent(raw)}`;
  }
  return `${SEARCH_TEMPLATES[engine]}${encodeURIComponent(raw)}`;
}

export function normalizeUrl(input: string, pref?: SearchPreference): string {
  const raw = (input || '').trim();
  if (!raw) return 'https://www.bilibili.com/';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^BV[0-9A-Za-z]{10}$/i.test(raw)) return `https://www.bilibili.com/video/${raw}`;
  if (/^(www\.)?bilibili\.com(\/|$)/i.test(raw)) return `https://${raw}`;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(raw)) return `https://${raw}`;
  return searchUrl(raw, pref);
}
