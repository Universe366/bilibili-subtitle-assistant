import { useEffect, useState } from 'react';
import { ExternalLink, History as HistoryIcon, Trash2 } from 'lucide-react';
import type { LibraryHistoryItem, LibraryTranscriptionItem } from '../../../shared/types';
import { Markdown } from './Markdown';

function fmtTime(value: number): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '';
}

function videoUrl(url: string, bvid: string | null): string {
  return url || (bvid ? `https://www.bilibili.com/video/${bvid}` : 'https://www.bilibili.com/');
}

export function HistoryPanel() {
  const [tab, setTab] = useState<'summaries' | 'transcripts'>('summaries');
  const [items, setItems] = useState<LibraryHistoryItem[]>([]);
  const [transcripts, setTranscripts] = useState<LibraryTranscriptionItem[]>([]);
  const [error, setError] = useState('');

  const load = () => {
    void window.bsub.getHistory().then((response) => {
      if (response.ok) setItems(response.data);
      else setError(response.error);
    });
    void window.bsub.getTranscriptions().then((response) => {
      if (response.ok) {
        setTranscripts(response.data);
        setError('');
      } else {
        setError(response.error);
      }
    });
  };

  useEffect(() => {
    load();
    return window.bsub.onLibraryChanged(load);
  }, []);

  const openSummary = (item: LibraryHistoryItem) => {
    void window.bsub.newTab(videoUrl(item.url, item.bvid));
  };

  const openTranscript = (item: LibraryTranscriptionItem) => {
    void window.bsub.newTab(videoUrl(item.url, item.bvid));
  };

  const remove = async (item: LibraryHistoryItem) => {
    if (!window.confirm(`删除「${item.title}」的总结？`)) return;
    const response = await window.bsub.deleteHistory(item.id);
    if (response.ok) load();
    else setError(response.error);
  };

  const clear = async () => {
    if (!window.confirm('清空全部总结历史？字幕和视频不会被删除。')) return;
    const response = await window.bsub.clearHistory();
    if (response.ok) load();
    else setError(response.error);
  };

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div className="panel-title">历史</div>
        <div className="toolbar-actions">
          <button
            className={`mini-btn${tab === 'summaries' ? ' is-active' : ''}`}
            onClick={() => setTab('summaries')}
          >
            总结
          </button>
          <button
            className={`mini-btn${tab === 'transcripts' ? ' is-active' : ''}`}
            onClick={() => setTab('transcripts')}
          >
            字幕
          </button>
          {tab === 'summaries' && (
            <button className="mini-btn" disabled={!items.length} onClick={() => void clear()}>
              <Trash2 size={12} /> 清空
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="warn-card">
          <div className="warn-desc">{error}</div>
        </div>
      )}

      {tab === 'summaries' && !items.length && (
        <div className="panel-empty">
          <HistoryIcon size={18} />
          <div>还没有总结历史</div>
        </div>
      )}

      {tab === 'transcripts' && !transcripts.length && (
        <div className="panel-empty">
          <HistoryIcon size={18} />
          <div>还没有入库字幕</div>
        </div>
      )}

      {tab === 'summaries' && (
        <div className="history-list">
          {items.map((item) => (
            <div key={item.id} className="history-card">
              <div className="history-head">
                <div className="history-title" title={item.title}>
                  {item.title || '未命名视频'}
                </div>
                <div className="history-actions">
                  <button className="icon-btn" title="打开视频" onClick={() => openSummary(item)}>
                    <ExternalLink size={13} />
                  </button>
                  <button className="icon-btn" title="删除总结" onClick={() => void remove(item)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div className="history-meta">
                {item.owner || '未知 UP'} · {item.model || 'AI'} · {fmtTime(item.updatedAt)}
              </div>
              <details className="history-details">
                <summary>查看总结</summary>
                <div className="history-content">
                  <Markdown content={item.content} />
                </div>
              </details>
            </div>
          ))}
        </div>
      )}

      {tab === 'transcripts' && (
        <div className="history-list">
          {transcripts.map((item) => (
            <div key={item.videoId} className="history-card">
              <div className="history-head">
                <div className="history-title" title={item.title}>
                  {item.title || '未命名视频'}
                </div>
                <button className="icon-btn" title="打开视频" onClick={() => openTranscript(item)}>
                  <ExternalLink size={13} />
                </button>
              </div>
              <div className="history-meta">
                {item.owner || '未知 UP'} · {item.trackCount} 轨 · {item.lineCount} 行
                {item.lanDoc ? ` · ${item.lanDoc}` : ''} · {fmtTime(item.updatedAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
