import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  History as HistoryIcon,
  Loader2,
  RotateCcw,
  Search,
  Trash2
} from 'lucide-react';
import type { JobRecord, LibraryHistoryItem } from '../../../shared/types';
import { ConfirmDialog } from './ConfirmDialog';
import { Markdown } from './Markdown';
import { JOB_ITEM_LABEL, JOB_STATUS_LABEL, JOB_TYPE_LABEL } from './TaskCenter';

function fmtTime(value: number): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '';
}

function videoUrl(url: string, bvid: string | null): string {
  return url || (bvid ? `https://www.bilibili.com/video/${bvid}` : '');
}

function dayGroup(value: number): string {
  if (!value) return '更早';
  const date = new Date(value);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  if (value >= startOfToday) return '今天';
  if (value >= startOfToday - oneDay) return '昨天';
  if (value >= startOfToday - 7 * oneDay) return '本周';
  return '更早';
}

const GROUP_ORDER = ['今天', '昨天', '本周', '更早'];

export function HistoryPanel({
  onOpenLibraryItem
}: {
  onOpenLibraryItem?: (videoId: number) => void;
}) {
  const [tab, setTab] = useState<'summaries' | 'tasks'>('summaries');
  const [items, setItems] = useState<LibraryHistoryItem[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyJob, setBusyJob] = useState('');
  const [pending, setPending] = useState<
    { kind: 'one'; item: LibraryHistoryItem } | { kind: 'all' } | null
  >(null);

  const loadSummaries = useCallback(() => {
    setLoading(true);
    void window.bsub
      .getHistory()
      .then((response) => {
        if (response.ok) {
          setItems(response.data);
          setError('');
        } else {
          setError(response.error);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const loadJobs = useCallback(() => {
    void window.bsub.listJobs().then((response) => {
      if (response.ok) setJobs(response.data);
    });
  }, []);

  useEffect(() => {
    loadSummaries();
    return window.bsub.onLibraryChanged(loadSummaries);
  }, [loadSummaries]);

  useEffect(() => {
    loadJobs();
    return window.bsub.onJobsChanged(setJobs);
  }, [loadJobs]);

  const keyword = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      keyword
        ? items.filter((item) =>
            `${item.title} ${item.owner} ${item.content}`.toLowerCase().includes(keyword)
          )
        : items,
    [items, keyword]
  );

  const groups = useMemo(() => {
    const map = new Map<string, LibraryHistoryItem[]>();
    for (const item of filtered) {
      const label = dayGroup(item.updatedAt);
      if (!map.has(label)) map.set(label, []);
      map.get(label)?.push(item);
    }
    return GROUP_ORDER.filter((label) => map.has(label)).map((label) => ({
      label,
      items: map.get(label) || []
    }));
  }, [filtered]);

  const openVideo = (item: LibraryHistoryItem) => {
    const url = videoUrl(item.url, item.bvid);
    if (url) void window.bsub.openUrl(url);
  };

  const openInLibrary = (item: LibraryHistoryItem) => {
    if (onOpenLibraryItem) onOpenLibraryItem(item.videoId);
  };

  const confirmPending = async () => {
    const current = pending;
    setPending(null);
    if (!current) return;
    const response =
      current.kind === 'all'
        ? await window.bsub.clearHistory()
        : await window.bsub.deleteHistory(current.item.id);
    if (response.ok) loadSummaries();
    else setError(response.error);
  };

  const cancelJob = async (job: JobRecord) => {
    setBusyJob(job.id);
    try {
      await window.bsub.cancelJob(job.id);
    } finally {
      setBusyJob('');
    }
  };

  const retryJob = async (job: JobRecord) => {
    setBusyJob(job.id);
    try {
      const response = await window.bsub.retryJob(job.id);
      if (!response.ok) setError(response.error);
    } finally {
      setBusyJob('');
    }
  };

  const clearFinished = async () => {
    const response = await window.bsub.clearFinishedJobs();
    if (!response.ok) setError(response.error);
  };

  const finishedCount = jobs.filter(
    (job) => job.status === 'done' || job.status === 'failed' || job.status === 'cancelled'
  ).length;

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div className="panel-title">记录</div>
        <div className="toolbar-actions">
          <button
            className={`mini-btn${tab === 'summaries' ? ' is-active' : ''}`}
            onClick={() => setTab('summaries')}
          >
            总结 {items.length}
          </button>
          <button
            className={`mini-btn${tab === 'tasks' ? ' is-active' : ''}`}
            onClick={() => setTab('tasks')}
          >
            任务 {jobs.length}
          </button>
          {tab === 'summaries' ? (
            <button
              className="mini-btn"
              disabled={!items.length}
              onClick={() => setPending({ kind: 'all' })}
            >
              <Trash2 size={12} /> 清空
            </button>
          ) : (
            <button
              className="mini-btn"
              disabled={!finishedCount}
              onClick={() => void clearFinished()}
            >
              清除已结束
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="warn-card">
          <div className="warn-desc">{error}</div>
        </div>
      )}

      {tab === 'summaries' && (
        <div className="library-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、UP 或总结内容…"
            spellCheck={false}
          />
        </div>
      )}

      {tab === 'summaries' && loading && !items.length && (
        <div className="status-line">
          <Loader2 size={13} className="spin" />
          读取中…
        </div>
      )}

      {tab === 'summaries' && !items.length && (
        <div className="panel-empty">
          <HistoryIcon size={18} />
          <div>还没有总结记录</div>
          <div className="panel-hint">在「总结」面板生成后会出现在这里，并随库条目保存。</div>
        </div>
      )}

      {tab === 'summaries' && items.length > 0 && !filtered.length && (
        <div className="panel-empty">没有匹配的总结</div>
      )}

      {tab === 'summaries' && filtered.length > 0 && (
        <div className="history-list">
          {groups.map((group) => (
            <div key={group.label} className="history-group">
              <div className="history-group-label">
                {group.label} · {group.items.length}
              </div>
              {group.items.map((item) => {
                const url = videoUrl(item.url, item.bvid);
                return (
                  <div key={item.id} className="history-card">
                    <div className="history-head">
                      <div className="history-title" title={item.title}>
                        {item.title || '未命名视频'}
                      </div>
                      <div className="history-actions">
                        {onOpenLibraryItem && (
                          <button
                            className="mini-btn"
                            title="在库中查看字幕与总结"
                            onClick={() => openInLibrary(item)}
                          >
                            库
                          </button>
                        )}
                        <button
                          className="icon-btn"
                          title="打开视频"
                          disabled={!url}
                          onClick={() => openVideo(item)}
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
                    <details className="history-details" open={Boolean(keyword)}>
                      <summary>查看总结 · {item.content.length} 字</summary>
                      <div className="history-content">
                        <Markdown content={item.content} />
                      </div>
                    </details>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {tab === 'tasks' && (
        <div className="history-list">
          {jobs.map((job) => {
            const failed = job.items.filter((item) => item.status === 'failed');
            const active = job.status === 'running' || job.status === 'paused';
            return (
              <div key={job.id} className="history-card record-task">
                <div className="history-head">
                  <span className={`job-chip is-${job.status}`}>
                    {JOB_STATUS_LABEL[job.status]}
                  </span>
                  <span className="history-title" title={job.title}>
                    {job.title || '未命名任务'}
                  </span>
                  <span className="record-task-type">{JOB_TYPE_LABEL[job.type] || job.type}</span>
                </div>
                <div className="history-meta">
                  {fmtTime(job.updatedAt)}
                  {job.message ? ` · ${job.message}` : ''}
                  {job.error ? ` · ${job.error}` : ''}
                </div>
                {job.items.length > 0 && (
                  <div className="record-task-items">
                    {job.items.slice(0, 4).map((item) => (
                      <div
                        key={item.targetId}
                        className="record-task-item"
                        title={item.error || item.message || item.title}
                      >
                        <span className={`task-item-dot is-${item.status}`} />
                        <span className="record-task-item-title">
                          {item.title || item.targetId}
                        </span>
                        <span className={`task-item-status is-${item.status}`}>
                          {JOB_ITEM_LABEL[item.status]}
                        </span>
                      </div>
                    ))}
                    {job.items.length > 4 && (
                      <div className="record-task-more">
                        还有 {job.items.length - 4} 项，完整状态见任务中心
                      </div>
                    )}
                  </div>
                )}
                {(active || failed.length > 0) && (
                  <div className="record-task-actions">
                    {active && (
                      <button
                        className="mini-btn"
                        disabled={busyJob === job.id}
                        onClick={() => void cancelJob(job)}
                      >
                        取消
                      </button>
                    )}
                    {!active && failed.length > 0 && (
                      <button
                        className="mini-btn"
                        disabled={busyJob === job.id}
                        onClick={() => void retryJob(job)}
                      >
                        <RotateCcw size={11} /> 重试失败 {failed.length}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!jobs.length && (
            <div className="panel-empty">
              <HistoryIcon size={18} />
              <div>还没有任务记录</div>
              <div className="panel-hint">
                总结、转录、翻译、批量都会记录在这里，重启后仍然保留。
              </div>
            </div>
          )}
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
