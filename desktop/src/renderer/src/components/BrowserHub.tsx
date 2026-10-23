import { useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  Clock,
  Download,
  ExternalLink,
  FolderOpen,
  Layers,
  Loader2,
  Pause,
  Play,
  Search,
  Trash2,
  X
} from 'lucide-react';
import type { Bookmark as BookmarkItem, DownloadRecord, HistoryEntry, TabInfo } from '../../../shared/types';
import { formatDateTime } from '../lib/format';

export type HubSection = 'history' | 'bookmarks' | 'downloads' | 'tabs';

function fmtBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const SECTIONS: Array<{ id: HubSection; label: string; icon: typeof Clock }> = [
  { id: 'history', label: '历史', icon: Clock },
  { id: 'bookmarks', label: '书签', icon: Bookmark },
  { id: 'downloads', label: '下载', icon: Download },
  { id: 'tabs', label: '标签', icon: Layers }
];

export function BrowserHub({
  open,
  initial,
  tabs,
  onClose,
  onOpenUrl,
  onSelectTab
}: {
  open: boolean;
  initial: HubSection;
  tabs: TabInfo[];
  onClose: () => void;
  onOpenUrl: (url: string) => void;
  onSelectTab: (id: string) => void;
}) {
  const [section, setSection] = useState<HubSection>(initial);
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setSection(initial);
      setQuery('');
      setError('');
    }
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const load = async () => {
      try {
        if (section === 'history') {
          const response = await window.bsub.listBrowseHistory(query);
          if (alive && response.ok) setHistory(response.data);
          else if (alive && !response.ok) setError(response.error);
        } else if (section === 'bookmarks') {
          const response = await window.bsub.listBookmarks();
          if (alive && response.ok) setBookmarks(response.data);
          else if (alive && !response.ok) setError(response.error);
        } else if (section === 'downloads') {
          const response = await window.bsub.listDownloads();
          if (alive && response.ok) setDownloads(response.data);
          else if (alive && !response.ok) setError(response.error);
        }
      } finally {
        if (alive) setLoading(false);
      }
    };
    const timer = window.setTimeout(load, section === 'history' ? 180 : 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [open, section, query]);

  useEffect(() => {
    if (!open || section !== 'downloads') return;
    return window.bsub.onDownloadsChanged(() => {
      void window.bsub.listDownloads().then((response) => {
        if (response.ok) setDownloads(response.data);
      });
    });
  }, [open, section]);

  const filteredTabs = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return tabs;
    return tabs.filter(
      (tab) =>
        tab.title.toLowerCase().includes(text) || tab.url.toLowerCase().includes(text)
    );
  }, [tabs, query]);

  if (!open) return null;

  const clearHistory = async () => {
    if (!window.confirm('清空全部浏览历史？')) return;
    const response = await window.bsub.clearBrowseHistory();
    if (response.ok) setHistory([]);
  };

  const removeBookmark = async (url: string) => {
    const response = await window.bsub.removeBookmark(url);
    if (response.ok) setBookmarks((items) => items.filter((item) => item.url !== url));
  };

  const clearDownloads = async () => {
    if (!window.confirm('清空下载记录？不会删除已经下载的文件。')) return;
    const response = await window.bsub.clearDownloads();
    if (response.ok) setDownloads([]);
  };

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        className="confirm-card browser-hub"
        role="dialog"
        aria-label="浏览器面板"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hub-head">
          <div className="hub-tabs">
            {SECTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={`mini-btn${section === item.id ? ' is-active' : ''}`}
                  onClick={() => {
                    setSection(item.id);
                    setQuery('');
                  }}
                >
                  <Icon size={12} /> {item.label}
                  {item.id === 'tabs' ? ` ${tabs.length}` : ''}
                </button>
              );
            })}
          </div>
          <button className="icon-btn" title="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {(section === 'history' || section === 'tabs') && (
          <div className="hub-search">
            <Search size={13} />
            <input
              autoFocus
              value={query}
              placeholder={section === 'history' ? '搜索历史记录…' : '搜索标签页标题或网址…'}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        )}

        {error && <div className="status-line">{error}</div>}
        {loading && (
          <div className="status-line">
            <Loader2 size={13} className="spin" /> 读取中…
          </div>
        )}

        <div className="hub-list">
          {section === 'history' &&
            history.map((item) => (
              <button
                key={item.id}
                className="hub-row"
                onClick={() => {
                  onOpenUrl(item.url);
                  onClose();
                }}
              >
                <span className="hub-main">
                  <span className="hub-title">{item.title || item.url}</span>
                  <span className="hub-sub">{item.url}</span>
                </span>
                <span className="hub-time">{formatDateTime(item.visitedAt)}</span>
              </button>
            ))}
          {section === 'history' && !loading && !history.length && (
            <div className="panel-empty">没有历史记录</div>
          )}

          {section === 'bookmarks' &&
            bookmarks.map((item) => (
              <div key={item.id} className="hub-row is-static">
                <button
                  className="hub-main"
                  onClick={() => {
                    onOpenUrl(item.url);
                    onClose();
                  }}
                >
                  <span className="hub-title">{item.title || item.url}</span>
                  <span className="hub-sub">{item.url}</span>
                </button>
                <button
                  className="icon-btn"
                  title="移除书签"
                  onClick={() => void removeBookmark(item.url)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          {section === 'bookmarks' && !loading && !bookmarks.length && (
            <div className="panel-empty">还没有书签，点地址栏右侧的星标收藏当前页面</div>
          )}

          {section === 'downloads' &&
            downloads.map((item) => {
              const percent = item.total > 0 ? Math.min(100, (item.received / item.total) * 100) : 0;
              return (
                <div key={item.id} className="hub-row is-static hub-download">
                  <span className="hub-main">
                    <span className="hub-title">{item.filename || item.url}</span>
                    <span className="hub-sub">
                      {item.state === 'progressing'
                        ? `${fmtBytes(item.received)} / ${fmtBytes(item.total)}`
                        : item.state === 'completed'
                          ? `已完成 · ${fmtBytes(item.received)}`
                          : item.state === 'cancelled'
                            ? '已取消'
                            : '已中断'}
                      {item.finishedAt ? ` · ${formatDateTime(item.finishedAt)}` : ''}
                    </span>
                    {item.state === 'progressing' && (
                      <span className="hub-progress">
                        <span style={{ width: `${percent}%` }} />
                      </span>
                    )}
                  </span>
                  <span className="hub-actions">
                    {(item.state === 'progressing' || item.state === 'paused') && (
                      <>
                        <button
                          className="icon-btn"
                          title={item.state === 'paused' ? '继续下载' : '暂停下载'}
                          onClick={() =>
                            void window.bsub
                              .controlDownload(item.id, item.state === 'paused' ? 'resume' : 'pause')
                              .then((response) => {
                                if (response.ok) {
                                  void window.bsub.listDownloads().then((list) => {
                                    if (list.ok) setDownloads(list.data);
                                  });
                                }
                              })
                          }
                        >
                          {item.state === 'paused' ? <Play size={13} /> : <Pause size={13} />}
                        </button>
                        <button
                          className="icon-btn"
                          title="取消下载"
                          onClick={() =>
                            void window.bsub.controlDownload(item.id, 'cancel').then((response) => {
                              if (response.ok) {
                                void window.bsub.listDownloads().then((list) => {
                                  if (list.ok) setDownloads(list.data);
                                });
                              }
                            })
                          }
                        >
                          <X size={13} />
                        </button>
                      </>
                    )}
                    {item.state === 'completed' && item.path && (
                      <>
                        <button
                          className="icon-btn"
                          title="打开文件"
                          onClick={() => void window.bsub.openDownload(item.id)}
                        >
                          <ExternalLink size={13} />
                        </button>
                        <button
                          className="icon-btn"
                          title="在文件夹中显示"
                          onClick={() => void window.bsub.revealDownload(item.id)}
                        >
                          <FolderOpen size={13} />
                        </button>
                      </>
                    )}
                    <button
                      className="icon-btn"
                      title="移除记录（不删除文件）"
                      onClick={() =>
                        void window.bsub.deleteDownload(item.id).then((response) => {
                          if (response.ok) {
                            setDownloads((items) => items.filter((row) => row.id !== item.id));
                          }
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
              );
            })}
          {section === 'downloads' && !loading && !downloads.length && (
            <div className="panel-empty">还没有下载记录</div>
          )}

          {section === 'tabs' &&
            filteredTabs.map((tab) => (
              <button
                key={tab.id}
                className="hub-row"
                onClick={() => {
                  onSelectTab(tab.id);
                  onClose();
                }}
              >
                <span className="hub-main">
                  <span className="hub-title">
                    {tab.title || '新标签页'}
                    {tab.active ? ' · 当前' : ''}
                  </span>
                  <span className="hub-sub">{tab.url}</span>
                </span>
                {tab.loading && <Loader2 size={13} className="spin" />}
              </button>
            ))}
          {section === 'tabs' && !filteredTabs.length && (
            <div className="panel-empty">没有匹配的标签页</div>
          )}
        </div>

        <div className="confirm-actions">
          <button className="mini-btn" onClick={onClose}>
            关闭
          </button>
          {section === 'history' && (
            <button className="mini-btn danger" disabled={!history.length} onClick={() => void clearHistory()}>
              清空历史
            </button>
          )}
          {section === 'downloads' && (
            <button
              className="mini-btn danger"
              disabled={!downloads.length}
              onClick={() => void clearDownloads()}
            >
              清空记录
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
