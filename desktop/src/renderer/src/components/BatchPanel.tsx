import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ListChecks, Loader2, Square } from 'lucide-react';
import type { BatchDoneEvent, LibraryVideo } from '../../../shared/types';

export function BatchPanel() {
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<BatchDoneEvent | null>(null);
  const requestRef = useRef('');

  const load = () => {
    void window.bsub.listLibrary().then((response) => {
      if (response.ok) setVideos(response.data.videos);
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
      setProgress(100);
      setResult(event);
      setMessage(`完成：成功 ${event.succeeded}，失败 ${event.failed.length}`);
    });
    const offError = window.bsub.onBatchError((event) => {
      if (event.requestId !== requestRef.current) return;
      requestRef.current = '';
      setRunning(false);
      setError(event.error);
    });
    return () => {
      offProgress();
      offDone();
      offError();
    };
  }, []);

  const start = async () => {
    if (running || !selected.size) return;
    setRunning(true);
    setProgress(0);
    setMessage('准备批量总结…');
    setError('');
    setResult(null);
    const response = await window.bsub.batchSummarize([...selected]);
    if (response.ok) {
      requestRef.current = response.data.requestId;
    } else {
      setRunning(false);
      setError(response.error);
    }
  };

  const cancel = () => {
    if (requestRef.current) void window.bsub.cancelBatch(requestRef.current);
  };

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div className="panel-title">批量</div>
        <div className="toolbar-actions">
          <button
            className="mini-btn"
            disabled={running || !videos.length}
            onClick={() => setSelected(new Set(videos.map((video) => video.id)))}
          >
            全选
          </button>
          <button
            className="mini-btn"
            disabled={running || !selected.size}
            onClick={() => setSelected(new Set())}
          >
            清空
          </button>
          {running ? (
            <button className="mini-btn" onClick={cancel}>
              <Square size={11} /> 停止
            </button>
          ) : (
            <button className="mini-btn primary" disabled={!selected.size} onClick={() => void start()}>
              <ListChecks size={12} /> 批量总结
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

      {running && (
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

      {!running && result && (
        <div className="settings-hint">
          成功 {result.succeeded} 个，失败 {result.failed.length} 个
          {result.failed.length > 0 && (
            <div>失败原因：{result.failed.map((item) => item.error).join('；')}</div>
          )}
        </div>
      )}

      {!videos.length && <div className="panel-empty">库里还没有视频，先入库再批量总结</div>}

      <div className="batch-list">
        {videos.map((video) => (
          <label key={video.id} className={`batch-row${selected.has(video.id) ? ' is-selected' : ''}`}>
            <input
              type="checkbox"
              checked={selected.has(video.id)}
              disabled={running}
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
          </label>
        ))}
      </div>
    </div>
  );
}
