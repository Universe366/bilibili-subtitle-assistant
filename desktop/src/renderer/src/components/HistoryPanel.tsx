import { useEffect, useState } from 'react';
import { ExternalLink, History as HistoryIcon, Trash2 } from 'lucide-react';
import type { LibraryHistoryItem } from '../../../shared/types';
import { Markdown } from './Markdown';

function fmtTime(value: number): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '';
}

export function HistoryPanel() {
  const [items, setItems] = useState<LibraryHistoryItem[]>([]);
  const [error, setError] = useState('');

  const load = () => {
    void window.bsub.getHistory().then((response) => {
      if (response.ok) {
        setItems(response.data);
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

  const open = (item: LibraryHistoryItem) => {
    const url =
      item.url ||
      (item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : 'https://www.bilibili.com/');
    void window.bsub.newTab(url);
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
          <button className="mini-btn" disabled={!items.length} onClick={() => void clear()}>
            <Trash2 size={12} /> 清空
          </button>
        </div>
      </div>

      {error && <div className="warn-card"><div className="warn-desc">{error}</div></div>}

      {!items.length && (
        <div className="panel-empty">
          <HistoryIcon size={18} />
          <div>还没有总结历史</div>
        </div>
      )}

      <div className="history-list">
        {items.map((item) => (
          <div key={item.id} className="history-card">
            <div className="history-head">
              <div className="history-title" title={item.title}>
                {item.title || '未命名视频'}
              </div>
              <div className="history-actions">
                <button className="icon-btn" title="打开视频" onClick={() => open(item)}>
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
    </div>
  );
}
