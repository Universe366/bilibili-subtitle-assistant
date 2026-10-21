import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Sparkles, Square } from 'lucide-react';
import type { PageInfo, SubtitleLine, SubtitleTrack, TabInfo } from '../../../shared/types';
import { Markdown } from './Markdown';
import { ExportMenu } from './ExportMenu';
import { pickTrack, videoKeyOf } from '../lib/video';

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `r_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

function fmtTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function SummaryPanel({
  activeTab,
  onOpenSettings
}: {
  activeTab: TabInfo | null;
  onOpenSettings: () => void;
}) {
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [summary, setSummary] = useState('');
  const [model, setModel] = useState('');
  const [updatedAt, setUpdatedAt] = useState(0);
  const [lines, setLines] = useState<SubtitleLine[]>([]);
  const [track, setTrack] = useState<SubtitleTrack | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef('');
  const liveRef = useRef<HTMLPreElement>(null);

  const videoKey = videoKeyOf(activeTab?.url);
  const isVideoPage = videoKey.startsWith('v:') || videoKey.startsWith('e:');

  useEffect(() => {
    if (requestRef.current) {
      void window.bsub.cancelSummary(requestRef.current);
      requestRef.current = '';
    }
    setInfo(null);
    setSummary('');
    setModel('');
    setUpdatedAt(0);
    setLines([]);
    setTrack(null);
    setStreamText('');
    setError(null);
    setStreaming(false);
  }, [activeTab?.id, videoKey]);

  useEffect(() => {
    if (!activeTab || activeTab.loading || !isVideoPage) return;
    let cancelled = false;
    setLoading(true);

    window.bsub
      .getPageInfo()
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setError(response.error);
          return;
        }
        setInfo(response.data);
        const saved = await window.bsub.getSummary({
          bvid: response.data.bvid,
          cid: response.data.cid,
          epId: response.data.epId
        });
        if (cancelled) return;
        if (saved.ok && saved.data) {
          setSummary(saved.data.content);
          setModel(saved.data.model);
          setUpdatedAt(saved.data.updatedAt);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab?.id, activeTab?.loading, videoKey, isVideoPage]);

  useEffect(() => {
    const offDelta = window.bsub.onAiDelta((event) => {
      if (event.requestId === requestRef.current) {
        setStreamText((previous) => previous + event.delta);
      }
    });
    const offDone = window.bsub.onAiDone((event) => {
      if (event.requestId !== requestRef.current) return;
      setSummary(event.text);
      setModel(event.model);
      setUpdatedAt(Date.now());
      setStreaming(false);
      setStreamText('');
    });
    const offError = window.bsub.onAiError((event) => {
      if (event.requestId !== requestRef.current) return;
      setError(event.error);
      setStreaming(false);
      setStatus('');
    });
    const offStatus = window.bsub.onAiStatus((event) => {
      if (event.requestId !== requestRef.current) return;
      setStatus(event.status);
    });
    return () => {
      offDelta();
      offDone();
      offError();
      offStatus();
    };
  }, []);

  useEffect(() => {
    const element = liveRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [streamText]);

  const ensureLines = useCallback(async () => {
    const infoResponse = await window.bsub.getPageInfo();
    if (!infoResponse.ok) throw new Error(infoResponse.error);
    const currentInfo = infoResponse.data;

    const subtitles = await window.bsub.getSubtitles();
    if (!subtitles.ok) throw new Error(subtitles.error);

    const chosen = pickTrack(subtitles.data.tracks, currentInfo);
    if (!chosen) throw new Error('没有找到字幕轨');

    const body = await window.bsub.getTrackBody(chosen.url);
    if (!body.ok) throw new Error(body.error);

    setInfo(currentInfo);
    setTrack(chosen);
    setLines(body.data.lines);
    return { info: currentInfo, track: chosen, lines: body.data.lines };
  }, []);

  const generate = async () => {
    if (streaming) return;
    setError(null);
    setStreaming(true);
    setStreamText('');
    setSummary('');
    setStatus('准备字幕…');

    try {
      const data = await ensureLines();
      const requestId = newRequestId();
      requestRef.current = requestId;
      const started = await window.bsub.summarize({
        requestId,
        info: data.info,
        lines: data.lines
      });
      if (!started.ok) throw new Error(started.error);
    } catch (caught) {
      setError((caught as Error).message);
      setStreaming(false);
    }
  };

  const cancel = () => {
    if (requestRef.current) void window.bsub.cancelSummary(requestRef.current);
  };

  const showSettingsHint =
    Boolean(error) &&
    /Key|模型|平台|设置|401|403|404/.test(error || '');

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div className="panel-title">总结</div>
        <div className="toolbar-actions">
          {summary && <ExportMenu info={info} track={track} lines={lines} summary={summary} />}
          {streaming ? (
            <button className="mini-btn" onClick={cancel} title="停止生成">
              <Square size={11} /> 停止
            </button>
          ) : (
            <button
              className="mini-btn primary"
              disabled={!isVideoPage || loading || !activeTab}
              onClick={() => void generate()}
              title={summary ? '重新生成' : '生成 AI 总结'}
            >
              {summary ? '重生成' : '生成'}
            </button>
          )}
        </div>
      </div>

      {!activeTab && <div className="panel-empty">打开一个 B 站视频后生成总结</div>}
      {activeTab && !isVideoPage && <div className="panel-empty">当前页面不是 B 站视频页</div>}

      {loading && !info && (
        <div className="status-line">
          <Loader2 size={13} className="spin" />
          读取视频信息…
        </div>
      )}

      {info && (
        <div className="summary-video">
          <div className="summary-video-title" title={info.title}>
            {info.title}
          </div>
          <div className="summary-video-meta">
            {info.owner} · {fmtTime(info.duration)}
          </div>
        </div>
      )}

      {error && (
        <div className="warn-card">
          <AlertTriangle size={15} />
          <div className="warn-body">
            <div className="warn-title">生成失败</div>
            <div className="warn-desc">{error}</div>
            {showSettingsHint && (
              <button className="warn-btn" onClick={onOpenSettings}>
                去设置
              </button>
            )}
          </div>
        </div>
      )}

      {streaming && (
        <>
          {status && <div className="status-line">{status}</div>}
          <pre className="summary-live" ref={liveRef}>
            {streamText || '正在生成…'}
          </pre>
        </>
      )}

      {!streaming && summary && (
        <div className="summary-content">
          <Markdown content={summary} />
        </div>
      )}

      {!streaming && !summary && !error && isVideoPage && !loading && (
        <div className="summary-empty">
          <div className="summary-empty-icon">
            <Sparkles size={22} />
          </div>
          <div className="summary-empty-title">还没有总结</div>
          <div className="summary-empty-desc">会先抓取当前视频字幕，再调用设置里的 AI 平台生成。</div>
          <button className="primary-btn" onClick={() => void generate()}>
            生成总结
          </button>
        </div>
      )}

      {summary && (
        <div className="panel-foot">
          <span>{model || 'AI'}</span>
          <span>{updatedAt ? new Date(updatedAt).toLocaleString('zh-CN') : ''}</span>
        </div>
      )}
    </div>
  );
}
