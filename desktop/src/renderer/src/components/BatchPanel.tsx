import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ListChecks, Loader2, RotateCcw, Search, Square } from 'lucide-react';
import type {
  BatchDoneEvent,
  JobItem,
  JobRecord,
  LibraryVideo,
  UrlBatchDoneEvent,
  UrlBatchProgressEvent
} from '../../../shared/types';

const ITEM_LABEL: Record<JobItem['status'], string> = {
  pending: '等待',
  running: '进行中',
  done: '完成',
  failed: '失败',
  skipped: '跳过'
};

function fmtChars(chars: number): string {
  if (chars >= 10000) return `${(chars / 10000).toFixed(1)} 万字`;
  return `${Math.max(0, Math.round(chars)).toLocaleString('zh-CN')} 字`;
}

export function BatchPanel() {
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const [concurrency, setConcurrency] = useState(2);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<BatchDoneEvent | null>(null);
  const [jobId, setJobId] = useState('');
  const [itemStates, setItemStates] = useState<Record<string, JobItem>>({});
  const requestRef = useRef('');
  const [mode, setMode] = useState<'library' | 'url'>('library');
  const [urlText, setUrlText] = useState('');
  const [withSummary, setWithSummary] = useState(true);
  const [urlProgress, setUrlProgress] = useState<UrlBatchProgressEvent | null>(null);
  const [urlResult, setUrlResult] = useState<UrlBatchDoneEvent | null>(null);
  const urlRequestRef = useRef('');

  const load = () => {
    void window.bsub.listLibrary().then((response) => {
      if (response.ok) setVideos(response.data.videos);
    });
  };

  const refreshJobStates = (id: string) => {
    if (!id) return;
    void window.bsub.getJob(id).then((response) => {
      if (!response.ok || !response.data) return;
      const map: Record<string, JobItem> = {};
      for (const item of response.data.items) map[item.targetId] = item;
      setItemStates(map);
    });
  };

  useEffect(() => {
    load();
    return window.bsub.onLibraryChanged(load);
  }, []);

  useEffect(() => {
    const offProgress = window.bsub.onBatchProgress((event) => {
      if (event.requestId !== requestRef.current) return;
      setProgress(event.percent);
      setMessage(event.message);
    });
    const offDone = window.bsub.onBatchDone((event) => {
      if (event.requestId !== requestRef.current) return;
      requestRef.current = '';
      setRunning(false);
      setPaused(false);
      if (!event.cancelled) setProgress(100);
      setResult(event);
      setMessage(
        event.cancelled
          ? `已停止：成功 ${event.succeeded}，失败 ${event.failed.length}`
          : `完成：成功 ${event.succeeded}，失败 ${event.failed.length}`
      );
      refreshJobStates(event.requestId);
    });
    const offError = window.bsub.onBatchError((event) => {
      if (event.requestId !== requestRef.current) return;
      requestRef.current = '';
      setRunning(false);
      setError(event.error);
    });
    const offUrlProgress = window.bsub.onUrlBatchProgress((event) => {
      if (event.requestId !== urlRequestRef.current) return;
      setUrlProgress(event);
      setRunning(true);
    });
    const offUrlDone = window.bsub.onUrlBatchDone((event) => {
      if (event.requestId !== urlRequestRef.current) return;
      urlRequestRef.current = '';
      setRunning(false);
      setUrlResult(event);
      setUrlProgress(null);
      setMessage(`链接批量：成功 ${event.succeeded}，失败 ${event.failed.length}`);
      load();
    });
    const offUrlError = window.bsub.onUrlBatchError((event) => {
      if (event.requestId !== urlRequestRef.current) return;
      urlRequestRef.current = '';
      setRunning(false);
      setUrlProgress(null);
      setError(event.error);
    });
    return () => {
      offProgress();
      offDone();
      offError();
      offUrlProgress();
      offUrlDone();
      offUrlError();
    };
  }, []);

  // 任务中心里的逐项状态就是批量面板的逐项状态，不再只靠一条总进度。
  useEffect(() => {
    if (!jobId) return;
    const apply = (jobs: JobRecord[]) => {
      const job = jobs.find((item) => item.id === jobId);
      if (!job) return;
      const map: Record<string, JobItem> = {};
      for (const item of job.items) map[item.targetId] = item;
      setItemStates(map);
    };
    void window.bsub.getJob(jobId).then((response) => {
      if (response.ok && response.data) apply([response.data]);
    });
    return window.bsub.onJobsChanged(apply);
  }, [jobId]);

  const startIds = async (ids: number[]) => {
    if (running || !ids.length) return;
    setRunning(true);
    setPaused(false);
    setRemovedIds(new Set());
    setProgress(0);
    setMessage('准备批量总结…');
    setError('');
    setResult(null);
    setItemStates({});
    const response = await window.bsub.batchSummarize(ids, concurrency);
    if (response.ok) {
      requestRef.current = response.data.requestId;
      setJobId(response.data.requestId);
    } else {
      setRunning(false);
      setError(response.error);
    }
  };

  const start = () => void startIds([...selected]);

  const retryFailed = () => {
    if (!result?.failed.length) return;
    void startIds(result.failed.map((item) => item.videoId));
  };

  const removeItem = (id: number) => {
    if (!requestRef.current) return;
    void window.bsub.removeBatchItem(requestRef.current, id);
    setRemovedIds((previous) => new Set(previous).add(id));
  };

  const togglePause = () => {
    if (!requestRef.current) return;
    const next = !paused;
    void (next
      ? window.bsub.pauseBatch(requestRef.current)
      : window.bsub.resumeBatch(requestRef.current));
    setPaused(next);
  };

  const cancel = () => {
    if (mode === 'url') {
      if (urlRequestRef.current) void window.bsub.cancelUrlBatch(urlRequestRef.current);
    } else if (requestRef.current) {
      void window.bsub.cancelBatch(requestRef.current);
    }
  };

  const startUrls = async () => {
    if (running || !urlText.trim()) return;
    setRunning(true);
    setError('');
    setUrlResult(null);
    setUrlProgress(null);
    setMessage('解析链接…');
    const response = await window.bsub.batchUrls([urlText], withSummary);
    if (response.ok) {
      urlRequestRef.current = response.data.requestId;
    } else {
      setRunning(false);
      setError(response.error);
    }
  };

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const keyword = filter.trim().toLowerCase();
  const visibleVideos = keyword
    ? videos.filter((video) =>
        `${video.title} ${video.owner}`.toLowerCase().includes(keyword)
      )
    : videos;

  const selectedVideos = videos.filter((video) => selected.has(video.id));
  const selectedChars = selectedVideos.reduce((sum, video) => sum + (video.chars || 0), 0);
  // 与 summarize 的分段阈值保持一致：4 万字以内 1 次，超过后每 4 万字 +1 次合并。
  const estimatedCalls = selectedVideos.reduce((sum, video) => {
    const chars = Math.max(0, video.chars || 0);
    const chunks = Math.max(1, Math.ceil(chars / 40000));
    return sum + chunks + (chunks > 1 ? 1 : 0);
  }, 0);

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div className="panel-title">批量</div>
        <div className="toolbar-actions">
          <button
            className={`mini-btn${mode === 'library' ? ' is-active' : ''}`}
            disabled={running}
            onClick={() => setMode('library')}
          >
            库内
          </button>
          <button
            className={`mini-btn${mode === 'url' ? ' is-active' : ''}`}
            disabled={running}
            onClick={() => setMode('url')}
          >
            链接
          </button>
          {mode === 'library' ? (
            <>
              <button
                className="mini-btn"
                disabled={running || !visibleVideos.length}
                onClick={() =>
                  setSelected((previous) => {
                    const next = new Set(previous);
                    visibleVideos.forEach((video) => next.add(video.id));
                    return next;
                  })
                }
              >
                全选{keyword ? '筛选结果' : ''}
              </button>
              <button
                className="mini-btn"
                disabled={running || !selected.size}
                onClick={() => setSelected(new Set())}
              >
                清空
              </button>
              {running ? (
                <>
                  <button className="mini-btn" onClick={togglePause}>
                    {paused ? '继续' : '暂停'}
                  </button>
                  <button className="mini-btn" onClick={cancel}>
                    <Square size={11} /> 停止
                  </button>
                </>
              ) : (
                <button
                  className="mini-btn primary"
                  disabled={!selected.size}
                  onClick={() => void start()}
                >
                  <ListChecks size={12} /> 批量总结
                </button>
              )}
            </>
          ) : running ? (
            <button className="mini-btn" onClick={cancel}>
              <Square size={11} /> 停止
            </button>
          ) : (
            <button
              className="mini-btn primary"
              disabled={!urlText.trim()}
              onClick={() => void startUrls()}
            >
              <ListChecks size={12} /> 开始批量
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="warn-card">
          <AlertTriangle size={15} />
          <div className="warn-body">
            <div className="warn-title">批量任务失败</div>
            <div className="warn-desc">{error}</div>
          </div>
        </div>
      )}

      {running && mode === 'library' && (
        <div className="asr-progress">
          <div className="asr-progress-head">
            <span>{message || '处理中…'}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="asr-bar">
            <span style={{ width: `${Math.max(2, progress)}%` }} />
          </div>
        </div>
      )}

      {urlProgress && (
        <div className="asr-progress">
          <div className="asr-progress-head">
            <span>
              第 {urlProgress.index + 1}/{urlProgress.total} · {urlProgress.stage}
              {urlProgress.title ? ` · ${urlProgress.title}` : ''}
            </span>
            <span>{Math.round(urlProgress.percent)}%</span>
          </div>
          <div className="asr-bar">
            <span style={{ width: `${Math.max(2, urlProgress.percent)}%` }} />
          </div>
        </div>
      )}

      {mode === 'url' && !running && (
        <div className="url-batch-form">
          <textarea
            className="settings-textarea"
            rows={5}
            placeholder="每行一个 B 站视频链接或 BV 号，最多 20 个，例如 https://www.bilibili.com/video/BV1xx411c7mD"
            value={urlText}
            spellCheck={false}
            onChange={(event) => setUrlText(event.target.value)}
          />
          <label className="settings-check">
            <input
              type="checkbox"
              checked={withSummary}
              onChange={(event) => setWithSummary(event.target.checked)}
            />
            入库后同时生成总结
          </label>
          <div className="settings-hint">
            会用后台标签逐个打开、等待字幕、写入本地库，结束后自动关闭标签。
          </div>
        </div>
      )}

      {mode === 'url' && !running && urlResult && (
        <div className="settings-hint">
          {urlResult.cancelled ? '已停止' : '完成'}：成功 {urlResult.succeeded} 个，失败{' '}
          {urlResult.failed.length} 个
          {urlResult.failed.length > 0 && (
            <div>失败原因：{urlResult.failed.map((item) => item.error).join('；')}</div>
          )}
        </div>
      )}

      {mode === 'library' && !running && result && (
        <div className="settings-hint">
          {result.cancelled ? '已停止' : '完成'}：成功 {result.succeeded} 个，失败{' '}
          {result.failed.length} 个
          {result.failed.length > 0 && (
            <div>失败原因：{result.failed.map((item) => item.error).join('；')}</div>
          )}
          {result.failed.length > 0 && (
            <button className="mini-btn batch-retry" onClick={retryFailed}>
              <RotateCcw size={11} /> 重试失败项（{result.failed.length}）
            </button>
          )}
        </div>
      )}

      {mode === 'library' && !videos.length && (
        <div className="panel-empty">库里还没有视频，先入库再批量总结</div>
      )}

      {mode === 'library' && (
        <div className="library-search batch-filter">
          <Search size={13} />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="筛选标题或 UP…"
            spellCheck={false}
          />
        </div>
      )}

      {mode === 'library' && videos.length > 0 && (
        <div className="batch-plan">
          <label className="batch-concurrency">
            并发
            <select
              className="mini-select"
              value={concurrency}
              disabled={running}
              onChange={(event) => setConcurrency(Number(event.target.value))}
            >
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <span className="batch-estimate">
            {selected.size
              ? `已选 ${selected.size} 个 · ${fmtChars(selectedChars)} · 预计 ≥${estimatedCalls} 次请求`
              : '勾选视频后可看到字符量与请求预估'}
          </span>
        </div>
      )}

      {mode === 'library' && (
      <div className="batch-list">
        {visibleVideos.map((video) => {
          const state = itemStates[String(video.id)];
          return (
          <label
            key={video.id}
            className={`batch-row${selected.has(video.id) ? ' is-selected' : ''}${
              removedIds.has(video.id) ? ' is-removed' : ''
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(video.id)}
              disabled={running || removedIds.has(video.id)}
              onChange={() => toggle(video.id)}
            />
            <div className="batch-text">
              <div className="batch-title" title={video.title}>
                {video.title || '未命名视频'}
              </div>
              <div className="batch-meta">
                {video.owner || '未知 UP'} · {video.lineCount} 行
                {video.duration ? ` · ${Math.round(video.duration / 60)} 分钟` : ''}
              </div>
            </div>
            {state && (
              <span
                className={`batch-state is-${state.status}`}
                title={state.error || state.message || ''}
              >
                {ITEM_LABEL[state.status]}
              </span>
            )}
            {running && !removedIds.has(video.id) && (
              <button
                className="mini-btn"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  removeItem(video.id);
                }}
              >
                移除
              </button>
            )}
          </label>
          );
        })}
      </div>
      )}
    </div>
  );
}
