import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { LibraryList, LibrarySearchResult, LibraryVideo } from '../../../shared/types';

function fmtTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function fmtBytes(bytes: number): string {
  if (!bytes) return '0 MB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(ms: number): string {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleDateString('zh-CN');
  } catch {
    return '';
  }
}

export function LibraryPanel() {
  const [list, setList] = useState<LibraryList | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<LibrarySearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await window.bsub.listLibrary();
      if (response.ok) {
        setList(response.data);
        setError(null);
      } else {
        setError(response.error);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return window.bsub.onLibraryChanged(() => {
      void load();
    });
  }, [load]);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setResult(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(async () => {
      const response = await window.bsub.searchLibrary(text);
      if (!alive) return;
      if (response.ok) setResult(response.data);
      else setError(response.error);
    }, 280);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const open = (url: string, start?: number) => {
    if (!url) return;
    try {
      const target = new URL(url);
      if (typeof start === 'number' && start > 0) target.searchParams.set('t', String(Math.floor(start)));
      void window.bsub.newTab(target.toString());
    } catch {
      void window.bsub.newTab(url);
    }
  };

  const remove = async (video: LibraryVideo) => {
    if (!window.confirm(`从库中删除「${video.title}」？`)) return;
    const response = await window.bsub.removeLibrary(video.id);
    if (response.ok) void load();
    else setError(response.error);
  };

  const stats = list?.stats;

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div className="panel-title">库</div>
        <div className="toolbar-actions">
          <button className="icon-btn" title="刷新" onClick={() => void load()}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <div className="library-search">
        <Search size={13} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索字幕内容…"
          spellCheck={false}
        />
      </div>

      {stats && (
        <div className="library-stats">
          <span>{stats.videos} 个视频</span>
          <span>{stats.segments.toLocaleString('zh-CN')} 行</span>
          <span>{fmtBytes(stats.bytes)}</span>
        </div>
      )}

      {error && <div className="status-line error">{error}</div>}
      {loading && !list && (
        <div className="status-line">
          <Loader2 size={13} className="spin" />
          读取中…
        </div>
      )}

      {result && (
        <div className="lib-results">
          <div className="lib-result-head">
            找到 {result.total} 条 · {result.mode === 'fts' ? '全文' : '模糊'}
          </div>
          {result.matches.map((match, index) => (
            <button
              key={`${match.videoId}-${match.start}-${index}`}
              className="lib-result"
              onClick={() => open(match.url, match.start)}
            >
              <span className="lib-result-time">{fmtTime(match.start)}</span>
              <span className="lib-result-body">
                <span className="lib-result-text">{match.text}</span>
                <span className="lib-result-meta">{match.title}</span>
              </span>
            </button>
          ))}
          {!result.matches.length && <div className="panel-empty">没有匹配的字幕</div>}
        </div>
      )}

      {!result && list && (
        <div className="lib-videos">
          {list.videos.map((video) => (
            <div
              key={video.id}
              className="lib-video"
              role="button"
              tabIndex={0}
              onClick={() => open(video.url)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') open(video.url);
              }}
            >
              {video.cover ? (
                <img className="lib-cover" src={video.cover} alt="" />
              ) : (
                <div className="lib-cover lib-cover-fallback">{video.title.slice(0, 1) || 'B'}</div>
              )}
              <div className="lib-meta">
                <div className="lib-title" title={video.title}>
                  {video.title}
                </div>
                <div className="lib-sub">
                  {video.owner} · {fmtTime(video.duration)} · {video.lineCount.toLocaleString('zh-CN')} 行
                </div>
                <div className="lib-sub faint">{fmtDate(video.updatedAt)}</div>
              </div>
              <button
                className="lib-delete"
                title="从库中删除"
                onClick={(event) => {
                  event.stopPropagation();
                  void remove(video);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {!list.videos.length && (
            <div className="panel-empty">
              还没有入库的视频
              <div className="panel-hint">打开视频后，在「字幕」面板点「入库」。</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
