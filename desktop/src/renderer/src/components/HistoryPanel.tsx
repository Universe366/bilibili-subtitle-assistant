import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, History as HistoryIcon, Trash2 } from 'lucide-react';
import type { LibraryHistoryItem, LibraryTranscriptionItem } from '../../../shared/types';
import { ConfirmDialog } from './ConfirmDialog';
import { Markdown } from './Markdown';

function fmtTime(value: number): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '';
}

function videoUrl(url: string, bvid: string | null): string {
  return url || (bvid ? `https://www.bilibili.com/video/${bvid}` : '');
}

export function HistoryPanel() {
  const [tab, setTab] = useState<'summaries' | 'transcripts'>('summaries');
  const [items, setItems] = useState<LibraryHistoryItem[]>([]);
  const [transcripts, setTranscripts] = useState<LibraryTranscriptionItem[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<
    { kind: 'one'; item: LibraryHistoryItem } | { kind: 'all' } | null
  >(null);

  // 两个请求必须一起成功/一起保留旧数据，避免一个先返回把另一个的错误清掉。
  const load = useCallback(() => {
    void Promise.all([window.bsub.getHistory(), window.bsub.getTranscriptions()]).then(
      ([history, transcriptions]) => {
        let problem = '';
        if (history.ok) setItems(history.data);
        else problem = history.error;
        if (transcriptions.ok) setTranscripts(transcriptions.data);
        else problem = problem || transcriptions.error;
        setError(problem);
      }
    );
  }, []);

  useEffect(() => {
    load();
    return window.bsub.onLibraryChanged(load);
  }, [load]);

  const openSummary = (item: LibraryHistoryItem) => {
    const url = videoUrl(item.url, item.bvid);
    if (url) void window.bsub.openUrl(url);
  };

  const openTranscript = (item: LibraryTranscriptionItem) => {
    const url = videoUrl(item.url, item.bvid);
    if (url) void window.bsub.openUrl(url);
  };

  const confirmPending = async () => {
    const current = pending;
    setPending(null);
    if (!current) return;
    const response =
      current.kind === 'all'
        ? await window.bsub.clearHistory()
        : await window.bsub.deleteHistory(current.item.id);
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
            <button
              className="mini-btn"
              disabled={!items.length}
              onClick={() => setPending({ kind: 'all' })}
            >
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
          {items.map((item) => {
            const url = videoUrl(item.url, item.bvid);
            return (
              <div key={item.id} className="history-card">
                <div className="history-head">
                  <div className="history-title" title={item.title}>
                    {item.title || '未命名视频'}
                  </div>
                  <div className="history-actions">
                    <button
                      className="icon-btn"
                      title="打开视频"
                      disabled={!url}
                      onClick={() => openSummary(item)}
                    >
                      <ExternalLink size={13} />
                    </button>
                    <button
                      className="icon-btn"
                      title="删除总结"
                      onClick={() => setPending({ kind: 'one', item })}
                    >
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
            );
          })}
        </div>
      )}

      {tab === 'transcripts' && (
        <div className="history-list">
          {transcripts.map((item) => {
            const url = videoUrl(item.url, item.bvid);
            return (
              <div key={item.videoId} className="history-card">
                <div className="history-head">
                  <div className="history-title" title={item.title}>
                    {item.title || '未命名视频'}
                  </div>
                  <button
                    className="icon-btn"
                    title="打开视频"
                    disabled={!url}
                    onClick={() => openTranscript(item)}
                  >
                    <ExternalLink size={13} />
                  </button>
                </div>
                <div className="history-meta">
                  {item.owner || '未知 UP'} · {item.trackCount} 轨 · {item.lineCount} 行
                  {item.lanDoc ? ` · ${item.lanDoc}` : ''} · {fmtTime(item.updatedAt)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.kind === 'all' ? '清空全部总结？' : '删除这条总结？'}
        description={
          pending?.kind === 'all'
            ? `将删除 ${items.length} 条总结（包括库条目上的那一份），字幕和视频不受影响；无法撤销。`
            : pending?.kind === 'one'
              ? `「${pending.item.title || '未命名视频'}」的总结会被删除；字幕仍保留在库中。`
              : undefined
        }
        confirmText="删除"
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
