import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Copy, Download, Loader2, Sparkles } from 'lucide-react';
import type { PageDocument } from '../../../shared/types';
import { buildReaderMarkdown, readerParagraphs } from '../lib/reader';

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function ReaderMode({
  open,
  onClose,
  onAskAi
}: {
  open: boolean;
  onClose: () => void;
  onAskAi: (text: string) => void;
}) {
  const [doc, setDoc] = useState<PageDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fontScale, setFontScale] = useState(1);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError('');
    setNotice('');
    setDoc(null);
    void window.bsub.getPageDocument().then((response) => {
      if (!alive) return;
      setLoading(false);
      if (response.ok) setDoc(response.data);
      else setError(response.error);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const markdown = doc ? buildReaderMarkdown(doc) : '';

  const copy = async () => {
    if (!markdown) return;
    await window.bsub.writeClipboard(markdown);
    setNotice('已复制 Markdown');
    window.setTimeout(() => setNotice(''), 2000);
  };

  const save = async () => {
    if (!markdown || !doc) return;
    const filename = `${(doc.title || '页面').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.md`;
    const response = await window.bsub.saveTextFile({ content: markdown, filename });
    if (!response.ok) setError(response.error);
    else if ('path' in response.data) setNotice('已保存 Markdown');
  };

  return (
    <div className="reader-overlay">
      <div className="reader-sheet" role="dialog" aria-label="阅读模式">
        <div className="reader-toolbar">
          <button className="icon-btn" title="退出阅读模式" onClick={onClose}>
            <ArrowLeft size={15} />
          </button>
          <div className="reader-brand">
            <BookOpen size={13} /> 阅读模式
          </div>
          <div className="reader-tools">
            <button className="mini-btn" onClick={() => setFontScale((value) => Math.max(0.8, value - 0.1))}>
              A-
            </button>
            <button className="mini-btn" onClick={() => setFontScale(1)}>
              {Math.round(fontScale * 100)}%
            </button>
            <button className="mini-btn" onClick={() => setFontScale((value) => Math.min(1.6, value + 0.1))}>
              A+
            </button>
            <button className="mini-btn" onClick={() => void copy()} disabled={!doc}>
              <Copy size={12} /> 复制
            </button>
            <button className="mini-btn" onClick={() => void save()} disabled={!doc}>
              <Download size={12} /> 保存
            </button>
            <button
              className="mini-btn primary"
              disabled={!doc}
              onClick={() => {
                onClose();
                onAskAi('用 5 条要点总结这个页面，先给结论，再列依据。');
              }}
            >
              <Sparkles size={12} /> AI 总结
            </button>
          </div>
        </div>

        <div className="reader-scroll">
          {loading && (
            <div className="reader-loading">
              <Loader2 size={16} className="spin" /> 提取正文…
            </div>
          )}
          {error && <div className="reader-error">{error}</div>}
          {doc && (
            <article className="reader-article" style={{ fontSize: `${16 * fontScale}px` }}>
              <h1>{doc.title || '未命名页面'}</h1>
              <div className="reader-meta">
                {siteOf(doc.url)}
                {doc.text ? ` · ${doc.text.length.toLocaleString('zh-CN')} 字` : ''}
                <a href={doc.url} onClick={(event) => { event.preventDefault(); void window.bsub.openExternal(doc.url); }}>
                  打开原网页
                </a>
              </div>
              {readerParagraphs(doc.text).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </article>
          )}
        </div>
        {notice && <div className="reader-notice">{notice}</div>}
      </div>
    </div>
  );
}
