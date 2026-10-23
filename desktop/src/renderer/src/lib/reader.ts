import type { PageDocument } from '../../../shared/types';

export function readerParagraphs(text: string): string[] {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function buildReaderMarkdown(doc: PageDocument): string {
  const title = String(doc.title || '未命名页面').trim();
  const url = String(doc.url || '').trim();
  const body = readerParagraphs(doc.text).join('\n\n');
  return [`# ${title}`, '', url ? `> 来源：${url}` : '', '', body, ''].join('\n');
}
