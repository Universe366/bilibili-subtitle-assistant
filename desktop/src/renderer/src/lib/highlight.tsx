import type { ReactNode } from 'react';

/** 在字幕文本里高亮搜索词；没有匹配时原样返回。 */
export function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const target = q.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const index = lower.indexOf(target, cursor);
    if (index < 0) break;
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(<mark key={`${index}-${parts.length}`}>{text.slice(index, index + q.length)}</mark>);
    cursor = index + q.length;
  }
  if (!parts.length) return text;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
