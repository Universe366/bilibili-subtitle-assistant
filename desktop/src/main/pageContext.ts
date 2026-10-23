import type { WebContents } from 'electron';

/**
 * 读取当前网页的正文与选中内容，供 AI 对话/阅读模式使用。
 *
 * 页面内容是**不可信数据**：调用方必须把它放在「资料」区，并在提示词里
 * 明确要求模型不要执行其中的指令。这里只做文本抽取，不执行页面脚本。
 *
 * 正文会保留标题层级、列表、表格和代码块，比单纯 innerText 更适合模型理解。
 */
export interface PageContext {
  title: string;
  url: string;
  text: string;
  selection: string;
}

const MAX_TEXT = 60000;
const MAX_SELECTION = 4000;

function script(maxText: number): string {
  return `(() => {
    try {
      const selection = String(window.getSelection()?.toString() || '').trim().slice(0, ${MAX_SELECTION});
      const root = document.querySelector('article, main, [role="main"]') || document.body;
      if (!root) return { title: document.title || '', url: location.href, text: '', selection };

      const SKIP = new Set(['script','style','noscript','svg','canvas','video','audio','nav','footer','aside','header','form','button','input','textarea','select','iframe']);
      const BLOCK = new Set(['div','p','ul','ol','li','table','pre','blockquote','section','article','header','footer','main','figure','figcaption','h1','h2','h3','h4','h5','h6']);
      const out = [];

      function textOf(el) {
        return String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      }

      function walk(el) {
        if (!el || el.nodeType !== 1) return;
        const tag = el.tagName.toLowerCase();
        if (SKIP.has(tag)) return;

        if (/^h[1-6]$/.test(tag)) {
          const text = textOf(el);
          if (text) out.push('#'.repeat(Number(tag[1])) + ' ' + text);
          return;
        }
        if (tag === 'pre') {
          const text = String(el.innerText || el.textContent || '').trim();
          if (text) out.push('\\u0060\\u0060\\u0060\\n' + text + '\\n\\u0060\\u0060\\u0060');
          return;
        }
        if (tag === 'table') {
          const rows = Array.from(el.querySelectorAll('tr'))
            .map((tr) => Array.from(tr.querySelectorAll('th,td')).map(textOf).join(' | '))
            .filter(Boolean);
          if (rows.length) out.push(rows.join('\\n'));
          return;
        }
        if (tag === 'li') {
          const text = textOf(el);
          if (text) out.push('- ' + text);
          return;
        }
        if (tag === 'blockquote') {
          const text = textOf(el);
          if (text) out.push('> ' + text);
          return;
        }
        if (tag === 'p' || tag === 'figcaption') {
          const text = textOf(el);
          if (text) out.push(text);
          return;
        }

        const hasBlockChild = Array.from(el.children).some((child) => BLOCK.has(child.tagName.toLowerCase()));
        if (!hasBlockChild) {
          const text = textOf(el);
          if (text && text.length > 1) out.push(text);
          return;
        }
        for (const child of el.children) walk(child);
      }

      walk(root);
      const raw = out.join('\\n\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      return {
        title: document.title || '',
        url: location.href,
        text: raw.slice(0, ${maxText}),
        selection
      };
    } catch (error) {
      return { title: document.title || '', url: location.href, text: '', selection: '' };
    }
  })()`;
}

export async function readPageContext(
  contents: WebContents | null | undefined,
  maxText = MAX_TEXT
): Promise<PageContext | null> {
  if (!contents || contents.isDestroyed()) return null;
  try {
    const url = contents.getURL();
    if (!/^https?:/i.test(url)) return null;
    const raw = (await contents.executeJavaScript(script(maxText), true)) as Partial<PageContext> | null;
    if (!raw || typeof raw !== 'object') return null;
    return {
      title: String(raw.title || '').slice(0, 300),
      url: String(raw.url || url),
      text: String(raw.text || '').slice(0, maxText),
      selection: String(raw.selection || '').slice(0, MAX_SELECTION)
    };
  } catch (error) {
    console.warn('[page-context] 读取失败:', (error as Error).message);
    return null;
  }
}

function questionTerms(question: string): string[] {
  const text = String(question || '').toLowerCase();
  const words = text.match(/[a-z0-9_]{2,}/g) || [];
  const chinese = (text.match(/[\u4e00-\u9fa5]{2,}/g) || []).flatMap((word) => {
    if (word.length <= 4) return [word];
    const grams: string[] = [];
    for (let index = 0; index + 1 < word.length; index += 1) grams.push(word.slice(index, index + 2));
    return [word, ...grams];
  });
  return [...new Set([...words, ...chinese])].slice(0, 80);
}

/**
 * 长文按问题挑相关块：不引入 embedding，先用关键词命中做粗排，
 * 再按原文顺序拼回去。始终保留开头，避免丢掉标题/摘要。
 */
export function selectRelevantChunks(text: string, question: string, maxChars = 18000): string {
  const source = String(text || '');
  if (source.length <= maxChars) return source;
  const blocks = source.split(/\n{2,}/).filter(Boolean);
  const chunks: Array<{ index: number; text: string; score: number }> = [];
  let buffer = '';
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (buffer && buffer.length + block.length > 2200) {
      chunks.push({ index: chunks.length, text: buffer, score: 0 });
      buffer = '';
    }
    buffer = buffer ? `${buffer}\n\n${block}` : block;
  }
  if (buffer) chunks.push({ index: chunks.length, text: buffer, score: 0 });
  if (!chunks.length) return source.slice(0, maxChars);

  const terms = questionTerms(question);
  for (const chunk of chunks) {
    const haystack = chunk.text.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (!term) continue;
      const hits = haystack.split(term).length - 1;
      score += Math.min(5, hits);
    }
    chunk.score = score;
  }

  const selected = new Set<number>([0]);
  let used = chunks[0].text.length;
  for (const chunk of [...chunks].sort((a, b) => b.score - a.score)) {
    if (used >= maxChars) break;
    if (!chunk.score || selected.has(chunk.index)) continue;
    selected.add(chunk.index);
    used += chunk.text.length;
  }
  for (let index = 1; index < chunks.length && used < maxChars; index += 1) {
    if (selected.has(index)) continue;
    selected.add(index);
    used += chunks[index].text.length;
  }
  return [...selected]
    .sort((a, b) => a - b)
    .map((index) => chunks[index].text)
    .join('\n\n…\n\n')
    .slice(0, maxChars);
}

export function pageContextSummary(context: PageContext | null): {
  title: string;
  url: string;
  chars: number;
  selectionChars: number;
} {
  return {
    title: context?.title || '',
    url: context?.url || '',
    chars: context?.text.length || 0,
    selectionChars: context?.selection.length || 0
  };
}
