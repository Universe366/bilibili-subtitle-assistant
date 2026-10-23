import type { WebContents } from 'electron';

/**
 * 读取当前网页的正文与选中内容，供 AI 对话使用。
 *
 * 页面内容是**不可信数据**：调用方必须把它放在「资料」区，并在提示词里
 * 明确要求模型不要执行其中的指令。这里只做文本抽取，不执行页面脚本。
 */
export interface PageContext {
  title: string;
  url: string;
  text: string;
  selection: string;
}

const MAX_TEXT = 20000;
const MAX_SELECTION = 4000;

function script(maxText: number): string {
  return `(() => {
    try {
      const selection = String(window.getSelection()?.toString() || '').trim().slice(0, ${MAX_SELECTION});
      const root = document.querySelector('article, main, [role="main"]') || document.body;
      if (!root) return { title: document.title || '', url: location.href, text: '', selection };
      const clone = root.cloneNode(true);
      clone.querySelectorAll('script,style,noscript,svg,canvas,video,audio,nav,footer,aside,header,form,button,input,textarea,select').forEach((node) => node.remove());
      const raw = String(clone.innerText || clone.textContent || '')
        .replace(/\\r/g, '')
        .replace(/[ \\t]+/g, ' ')
        .replace(/\\n{3,}/g, '\\n\\n')
        .trim();
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
