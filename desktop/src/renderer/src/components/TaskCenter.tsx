import { useEffect, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import type {
  ExportRecord,
  JobItemStatus,
  JobRecord,
  JobStatus,
  JobType
} from '../../../shared/types';

export const JOB_TYPE_LABEL: Record<JobType, string> = {
  summary: '总结',
  asr: '转录',
  translate: '翻译',
  optimize: '校对',
  'batch-summary': '批量总结',
  'url-batch': '链接批量',
  'collection-summary': '合集对比'
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  running: '进行中',
  paused: '已暂停',
  done: '完成',
  failed: '失败',
  cancelled: '已取消'
};

export const JOB_ITEM_LABEL: Record<JobItemStatus, string> = {
  pending: '等待',
  running: '进行中',
  done: '完成',
  failed: '失败',
  skipped: '跳过'
};

function fmtTime(value: number): string {
  if (!value) return '';
  try {
    const date = new Date(value);
    const now = Date.now();
    const sameDay = new Date(now).toDateString() === date.toDateString();
    return sameDay
      ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString('zh-CN');
  } catch {
    return '';
  }
}

export function TaskCenter({
  open,
  jobs,
  onClose
}: {
  open: boolean;
  jobs: JobRecord[];
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState<'tasks' | 'exports'>('tasks');
  const [exports, setExports] = useState<ExportRecord[]>([]);

  useEffect(() => {
    if (!open || tab !== 'exports') return;
    void window.bsub.listExports().then((response) => {
      if (response.ok) setExports(response.data);
    });
  }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const finished = jobs.filter(
    (job) => job.status === 'done' || job.status === 'failed' || job.status === 'cancelled'
  );

  const toggle = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const cancel = async (job: JobRecord) => {
    setError('');
    setBusy(job.id);
    try {
      await window.bsub.cancelJob(job.id);
    } finally {
      setBusy('');
    }
  };

  const retry = async (job: JobRecord) => {
    setError('');
    setBusy(job.id);
    try {
      const response = await window.bsub.retryJob(job.id);
      if (!response.ok) setError(response.error);
    } finally {
      setBusy('');
    }
  };

  const togglePause = async (job: JobRecord) => {
    setError('');
    setBusy(job.id);
    try {
      if (job.status === 'paused') await window.bsub.resumeBatch(job.id);
      else await window.bsub.pauseBatch(job.id);
    } finally {
      setBusy('');
    }
  };

  const openExport = async (item: ExportRecord) => {
    const response = await window.bsub.openExport(item.path);
    if (!response.ok) setError(response.error);
  };

  const revealExport = async (item: ExportRecord) => {
    const response = await window.bsub.revealExport(item.path);
    if (!response.ok) setError(response.error);
  };

  const removeExport = async (item: ExportRecord) => {
    const response = await window.bsub.deleteExport(item.id);
    if (!response.ok) setError(response.error);
    else setExports((previous) => previous.filter((entry) => entry.id !== item.id));
  };

  const clear = async () => {
    setError('');
    const response = await window.bsub.clearFinishedJobs();
    if (!response.ok) setError(response.error);
  };

  return (
    <div className="task-drawer" role="dialog" aria-label="任务中心">
      <div className="task-head">
        <span className="task-head-title">任务与导出</span>
        <button
          className={`mini-btn${tab === 'tasks' ? ' is-active' : ''}`}
          onClick={() => setTab('tasks')}
        >
          任务
        </button>
        <button
          className={`mini-btn${tab === 'exports' ? ' is-active' : ''}`}
          onClick={() => setTab('exports')}
        >
          导出
        </button>
        {tab === 'tasks' && (
          <button
            className="mini-btn"
            disabled={!finished.length}
            onClick={() => void clear()}
            title="清除已完成 / 失败 / 已取消的任务"
          >
            清除
          </button>
        )}
        <button className="icon-btn" title="关闭" onClick={onClose}>
          <X size={13} />
        </button>
      </div>

      {error && <div className="status-line error">{error}</div>}

      {tab === 'tasks' ? (
      <div className="task-scroll">
        {!jobs.length && (
          <div className="panel-empty">
            还没有任务
            <div className="panel-hint">总结、转录、翻译、批量抓取运行时都会出现在这里。</div>
          </div>
        )}

        {jobs.map((job) => {
          const active = job.status === 'running' || job.status === 'paused';
          const failedItems = job.items.filter((item) => item.status === 'failed');
          const canRetry = failedItems.length > 0 && !active;
          const showItems = expanded.has(job.id) ? job.items : job.items.slice(0, 5);
          return (
            <div key={job.id} className="task-card">
              <div className="task-row">
                <span className={`job-chip is-${job.status}`}>{JOB_STATUS_LABEL[job.status]}</span>
                <span className="task-title" title={job.title}>
                  {job.title || '未命名任务'}
                </span>
                <span className="task-type">{JOB_TYPE_LABEL[job.type] || job.type}</span>
              </div>

              <div className="task-meta">
                {active ? `${Math.round(job.progress)}%` : fmtTime(job.updatedAt)}
                {job.message ? ` · ${job.message}` : ''}
                {job.error ? ` · ${job.error}` : ''}
              </div>

              {active && (
                <div className="task-bar">
                  <span style={{ width: `${Math.max(2, Math.min(100, job.progress))}%` }} />
                </div>
              )}

              {job.items.length > 0 && (
                <div className="task-items">
                  {showItems.map((item) => (
                    <div
                      key={item.targetId}
                      className="task-item"
                      title={item.error || item.message || item.title}
                    >
                      <span className={`task-item-dot is-${item.status}`} />
                      <span className="task-item-title">{item.title || item.targetId}</span>
                      <span className={`task-item-status is-${item.status}`}>
                        {JOB_ITEM_LABEL[item.status]}
                      </span>
                    </div>
                  ))}
                  {job.items.length > 5 && (
                    <button className="task-more" onClick={() => toggle(job.id)}>
                      {expanded.has(job.id)
                        ? '收起'
                        : `展开全部 ${job.items.length} 项（失败 ${failedItems.length}）`}
                    </button>
                  )}
                  {job.items.length <= 5 && failedItems.length > 0 && (
                    <div className="task-item-error">{failedItems[0].error}</div>
                  )}
                </div>
              )}

              {(active || canRetry) && (
                <div className="task-actions">
                  {active && job.type === 'batch-summary' && (
                    <button
                      className="mini-btn"
                      disabled={busy === job.id}
                      onClick={() => void togglePause(job)}
                    >
                      {job.status === 'paused' ? '继续' : '暂停'}
                    </button>
                  )}
                  {active && (
                    <button
                      className="mini-btn"
                      disabled={busy === job.id}
                      onClick={() => void cancel(job)}
                    >
                      取消
                    </button>
                  )}
                  {canRetry && (
                    <button
                      className="mini-btn"
                      disabled={busy === job.id}
                      onClick={() => void retry(job)}
                    >
                      重试失败项 {failedItems.length}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      ) : (
        <div className="task-scroll">
          {exports.map((item) => (
            <div key={item.id} className="task-card">
              <div className="task-row">
                <span className="job-chip">{item.kind || '文件'}</span>
                <span className="task-title" title={item.title}>
                  {item.title || item.path.split(/[\/]/).pop()}
                </span>
              </div>
              <div className="task-meta">{item.path}</div>
              <div className="task-meta">{fmtTime(item.createdAt)}</div>
              <div className="task-actions">
                <button className="mini-btn" onClick={() => void openExport(item)}>
                  打开
                </button>
                <button className="mini-btn" onClick={() => void revealExport(item)}>
                  <FolderOpen size={11} /> 定位
                </button>
                <button className="mini-btn" onClick={() => void removeExport(item)}>
                  移除
                </button>
              </div>
            </div>
          ))}
          {!exports.length && (
            <div className="panel-empty">
              还没有导出记录
              <div className="panel-hint">导出字幕、总结、笔记或合集对比后，会出现在这里。</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
