import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ListChecks, Loader2, Square } from 'lucide-react';
import type {
  BatchDoneEvent,
  LibraryVideo,
  UrlBatchDoneEvent,
  UrlBatchProgressEvent
} from '../../../shared/types';

export function BatchPanel() {
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<BatchDoneEvent | null>(null);
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
          成功 {urlResult.succeeded} 个，失败 {urlResult.failed.length} 个
          {urlResult.failed.length > 0 && (
            <div>失败原因：{urlResult.failed.map((item) => item.error).join('；')}</div>
          )}
        </div>
      )}

      {mode === 'library' && !running && result && (
        <div className="settings-hint">
          成功 {result.succeeded} 个，失败 {result.failed.length} 个
          {result.failed.length > 0 && (
            <div>失败原因：{result.failed.map((item) => item.error).join('；')}</div>
          )}
        </div>
      )}

      {mode === 'library' && !videos.length && (
        <div className="panel-empty">库里还没有视频，先入库再批量总结</div>
      )}

      {mode === 'library' && (
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
      )}
    </div>
  );
}
