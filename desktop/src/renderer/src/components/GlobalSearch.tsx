import { useEffect, useMemo, useRef, useState } from 'react';
import { Captions, FileText, Layers, Loader2, Search, Video } from 'lucide-react';
import type {
  CollectionSearchHit,
  GlobalSearchResult,
  LibrarySearchMatch,
  LibraryVideo,
  SummarySearchHit
} from '../../../shared/types';

type Row =
  | { key: string; kind: 'item'; video: LibraryVideo }
  | { key: string; kind: 'line'; line: LibrarySearchMatch }
  | { key: string; kind: 'summary'; summary: SummarySearchHit }
  | { key: string; kind: 'collection'; collection: CollectionSearchHit };

function fmtTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function GlobalSearch({
  open,
  onClose,
  onOpenItem,
  onOpenLine,
  onOpenCollection
}: {
  open: boolean;
  onClose: () => void;
  onOpenItem: (videoId: number, tab: 'subtitles' | 'summary') => void;
  onOpenLine: (url: string, start: number) => void;
  onOpenCollection: (collectionId: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResult(null);
    setError('');
    setActive(0);
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const text = query.trim();
    if (!text) {
      seqRef.current += 1;
      setResult(null);
      setLoading(false);
      setActive(0);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const response = await window.bsub.globalSearch(text);
      if (seq !== seqRef.current) return;
      setLoading(false);
      if (response.ok) {
        setResult(response.data);
        setActive(0);
        setError('');
      } else {
        setError(response.error);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  const rows = useMemo<Row[]>(() => {
    if (!result) return [];
    return [
      ...result.items.map((video) => ({
        key: `v-${video.id}`,
        kind: 'item' as const,
        video
      })),
      ...result.lines.map((line, index) => ({
        key: `l-${line.videoId}-${line.start}-${index}`,
        kind: 'line' as const,
        line
      })),
      ...result.summaries.map((summary) => ({
        key: `s-${summary.videoId}`,
        kind: 'summary' as const,
        summary
      })),
      ...result.collections.map((collection) => ({
        key: `c-${collection.collectionId}`,
        kind: 'collection' as const,
        collection
      }))
    ];
  }, [result]);

  const run = (row: Row) => {
    if (row.kind === 'item') {
      onOpenItem(row.video.id, 'subtitles');
    } else if (row.kind === 'summary') {
      onOpenItem(row.summary.videoId, 'summary');
    } else if (row.kind === 'collection') {
      onOpenCollection(row.collection.collectionId);
    } else {
      const url =
        row.line.url ||
        (row.line.bvid ? `https://www.bilibili.com/video/${row.line.bvid}` : '');
      if (url) onOpenLine(url, row.line.start);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (!rows.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((value) => (value + 1) % rows.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((value) => (value - 1 + rows.length) % rows.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const row = rows[active];
        if (row) run(row);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, rows, active, onClose]);

  if (!open) return null;

  let index = 0;
  const groupLabel = (label: string, count: number) =>
    count > 0 ? (
      <div className="gs-group">
        {label} · {count}
      </div>
    ) : null;

  return (
    <div
      className="gs-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="gs-panel" role="dialog" aria-label="全局搜索">
        <div className="gs-search">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索库、字幕、总结、笔记、合集对比…"
            spellCheck={false}
          />
          {loading && <Loader2 size={14} className="spin" />}
          <kbd>Esc</kbd>
        </div>

        {error && <div className="status-line error">{error}</div>}

        {!query.trim() && (
          <div className="gs-empty">
            输入关键词，同时搜索库内视频（含标签/合集/笔记）、字幕正文、已保存总结与合集对比
            <div className="gs-hint">↑ ↓ 选择 · Enter 打开</div>
          </div>
        )}

        {query.trim() && !loading && result && !rows.length && (
          <div className="gs-empty">没有找到与「{query.trim()}」相关的内容</div>
        )}

        {rows.length > 0 && (
          <div className="gs-results">
            {groupLabel('视频', result?.items.length || 0)}
            {result?.items.map((video) => {
              const current = index++;
              return (
                <button
                  key={`v-${video.id}`}
                  className={`gs-row${active === current ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(current)}
                  onClick={() => onOpenItem(video.id, 'subtitles')}
                >
                  <Video size={13} className="gs-icon" />
                  <span className="gs-main">
                    <span className="gs-title">{video.title || '未命名视频'}</span>
                    <span className="gs-meta">
                      {video.owner || '未知 UP'} · {video.lineCount} 行
                    </span>
                  </span>
                  {video.summaryUpdatedAt != null && <span className="lib-badge">已总结</span>}
                </button>
              );
            })}

            {groupLabel('字幕', result?.lines.length || 0)}
            {result?.lines.map((line, lineIndex) => {
              const current = index++;
              return (
                <button
                  key={`l-${line.videoId}-${line.start}-${lineIndex}`}
                  className={`gs-row${active === current ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(current)}
                  onClick={() => {
                    const url =
                      line.url ||
                      (line.bvid ? `https://www.bilibili.com/video/${line.bvid}` : '');
                    if (url) onOpenLine(url, line.start);
                  }}
                >
                  <Captions size={13} className="gs-icon" />
                  <span className="gs-time">{fmtTime(line.start)}</span>
                  <span className="gs-main">
                    <span className="gs-title gs-line-text">{line.text}</span>
                    <span className="gs-meta">{line.title}</span>
                  </span>
                </button>
              );
            })}

            {groupLabel('总结', result?.summaries.length || 0)}
            {result?.summaries.map((summary) => {
              const current = index++;
              return (
                <button
                  key={`s-${summary.videoId}`}
                  className={`gs-row${active === current ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(current)}
                  onClick={() => onOpenItem(summary.videoId, 'summary')}
                >
                  <FileText size={13} className="gs-icon" />
                  <span className="gs-main">
                    <span className="gs-title">{summary.title || '未命名视频'}</span>
                    <span className="gs-meta gs-snippet">{summary.snippet}</span>
                  </span>
                </button>
              );
            })}
            {groupLabel('合集对比', result?.collections.length || 0)}
            {result?.collections.map((collection) => {
              const current = index++;
              return (
                <button
                  key={`c-${collection.collectionId}`}
                  className={`gs-row${active === current ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(current)}
                  onClick={() => onOpenCollection(collection.collectionId)}
                >
                  <Layers size={13} className="gs-icon" />
                  <span className="gs-main">
                    <span className="gs-title">{collection.name || '未命名合集'}</span>
                    <span className="gs-meta gs-snippet">{collection.snippet}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="gs-foot">↑ ↓ 选择 · Enter 打开 · Esc 关闭</div>
      </div>
    </div>
  );
}
