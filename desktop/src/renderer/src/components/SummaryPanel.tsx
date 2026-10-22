import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Sparkles, Square } from 'lucide-react';
import type {
  Chapter,
  PageInfo,
  SubtitleLine,
  SubtitleTrack,
  TabInfo,
  VerificationSummary
} from '../../../shared/types';
import { Markdown } from './Markdown';
import { ExportMenu } from './ExportMenu';
import { pickTrack, videoKeyOf } from '../lib/video';
import { getAsrResult } from '../lib/asrStore';

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
  const [verification, setVerification] = useState<VerificationSummary | null>(null);
  const [verifyEnabled, setVerifyEnabled] = useState(true);
  const [fromSaved, setFromSaved] = useState(false);
  const [model, setModel] = useState('');
  const [updatedAt, setUpdatedAt] = useState(0);
  const [lines, setLines] = useState<SubtitleLine[]>([]);
  const [track, setTrack] = useState<SubtitleTrack | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [summaryVideoKey, setSummaryVideoKey] = useState('');
  const [streamText, setStreamText] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef('');
  const streamingRef = useRef(false);
  const liveRef = useRef<HTMLPreElement>(null);

  const videoKey = videoKeyOf(activeTab?.url);
  const isVideoPage = videoKey.startsWith('v:') || videoKey.startsWith('e:');

  useEffect(() => {
    if (streamingRef.current) return;
    if (requestRef.current) {
      void window.bsub.cancelSummary(requestRef.current);
      requestRef.current = '';
    }
    setInfo(null);
    setSummary('');
    setVerification(null);
    setFromSaved(false);
    setModel('');
    setUpdatedAt(0);
    setLines([]);
    setTrack(null);
    setStreamText('');
    setError(null);
    setStreaming(false);
    setChapters([]);
    setChaptersOpen(false);
    setChaptersLoading(false);
    setChapterError(null);
  }, [activeTab?.id, videoKey]);

  useEffect(() => {
    if (streamingRef.current) return;
    if (!activeTab || activeTab.loading || !isVideoPage) return;
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        let response = await window.bsub.getPageInfo();
        for (let attempt = 0; attempt < 6; attempt += 1) {
          if (cancelled) return;
          if (response.ok && response.data.bvid && response.data.cid) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
          response = await window.bsub.getPageInfo();
        }
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
          setFromSaved(true);
          setModel(saved.data.model);
          setUpdatedAt(saved.data.updatedAt);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

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
      console.log(
        '[summary-done]',
        event.verification
          ? `${event.verification.attempted}/${event.verification.references.length}`
          : 'none'
      );
      setSummary(event.text);
      setVerification(event.verification || null);
      setFromSaved(false);
      setModel(event.model);
      setUpdatedAt(Date.now());
      setStreaming(false);
      setStreamText('');
    });
    const offError = window.bsub.onAiError((event) => {
      if (event.requestId !== requestRef.current) return;
      streamingRef.current = false;
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

    const subtitles = await window.bsub.getSubtitles(currentInfo.signature);
    if (!subtitles.ok) throw new Error(subtitles.error);

    const chosen = pickTrack(subtitles.data.tracks, currentInfo);
    const fallback = () => {
      const cached = getAsrResult(videoKey);
      if (!cached) return null;
      const asrTrack: SubtitleTrack = {
        lan: 'asr',
        lanDoc: '语音转录',
        url: 'asr://local',
        isAi: false,
        aiStatus: null,
        source: 'asr'
      };
      setInfo(cached.info);
      setTrack(asrTrack);
      setLines(cached.lines);
      return { info: cached.info, track: asrTrack, lines: cached.lines };
    };

    if (!chosen) {
      const cached = fallback();
      if (cached) return cached;
      throw new Error('没有找到字幕轨');
    }

    const body = await window.bsub.getTrackBody(chosen.url);
    if (!body.ok) {
      const cached = fallback();
      if (cached) return cached;
      throw new Error(body.error);
    }

    setInfo(currentInfo);
    setTrack(chosen);
    setLines(body.data.lines);
    return { info: currentInfo, track: chosen, lines: body.data.lines };
  }, []);

  const generate = async () => {
    if (streaming) return;
    setError(null);
    streamingRef.current = true;
    setStreaming(true);
    setSummaryVideoKey(videoKey);
    setStreamText('');
    setSummary('');
    setVerification(null);
    setFromSaved(false);
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
    streamingRef.current = false;
    if (requestRef.current) void window.bsub.cancelSummary(requestRef.current);
  };

  useEffect(() => {
    const handler = () => {
      void generate();
    };
    window.addEventListener('bsub:summary-request', handler);
    return () => window.removeEventListener('bsub:summary-request', handler);
  }, [generate]);

  const loadChapters = async () => {
    if (chaptersLoading) return;
    setChaptersLoading(true);
    setChapterError(null);
    try {
      const data = await ensureLines();
      const response = await window.bsub.generateChapters(data.info, data.lines);
      if (response.ok) {
        setChapters(response.data);
        setChaptersOpen(response.data.length > 0 && response.data.length <= 4);
      }
      else setChapterError(response.error);
    } catch (caught) {
      setChapterError((caught as Error).message);
    } finally {
      setChaptersLoading(false);
    }
  };

  const showSettingsHint =
    Boolean(error) &&
    /Key|模型|平台|设置|401|403|404/.test(error || '');

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div className="panel-title">总结</div>
        <div className="toolbar-actions">
          <button
            className="mini-btn"
            disabled={!isVideoPage || loading || chaptersLoading || streaming}
            title="用 AI 生成可跳转章节"
            onClick={() => void loadChapters()}
          >
            {chaptersLoading ? <Loader2 size={12} className="spin" /> : '章节'}
          </button>
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

      {chapterError && <div className="settings-hint">章节生成失败：{chapterError}</div>}

      {chapters.length > 0 && (
        <details
          className="chapters-card"
          open={chaptersOpen}
          onToggle={(event) => setChaptersOpen(event.currentTarget.open)}
        >
          <summary className="chapters-head">
            <span>章节 · {chapters.length}</span>
            <span className="chapters-toggle">{chaptersOpen ? '收起' : '展开'}</span>
          </summary>
          <div className="chapters-list">
            {chapters.map((chapter) => (
              <button
                key={`${chapter.start}-${chapter.title}`}
                className="chapter-row"
                onClick={() => void window.bsub.seek(chapter.start + 0.05)}
              >
                <span className="chapter-time">{fmtTime(chapter.start)}</span>
                <span className="chapter-title">{chapter.title}</span>
              </button>
            ))}
          </div>
        </details>
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
          <div className="summary-progress" aria-label="正在生成">
            <span />
          </div>
          <pre className="summary-live" ref={liveRef}>
            {streamText || '正在生成…'}
          </pre>
        </>
      )}

      {!streaming && summary && summaryVideoKey && summaryVideoKey !== videoKey && (
        <div className="summary-verify-hint">
          <span>这份总结属于上一个视频；切换回该视频或重新生成。</span>
        </div>
      )}

      {!streaming && summary && (!verifyEnabled || !verification) && (
        <div className="summary-verify-hint">
          {!verifyEnabled ? (
            <>
              <span>联网核对未开启，本次总结不会检查外部证据。</span>
              <button className="mini-btn" onClick={onOpenSettings}>
                去设置
              </button>
            </>
          ) : fromSaved ? (
            <span>这是已保存的总结；重新生成会执行联网核对。</span>
          ) : (
            <span>本次没有产生核对结果（可能没有可核实项或检索失败）。</span>
          )}
        </div>
      )}

      {!streaming && verification && (
        <div className="verify-card">
          <div className="verify-head">
            <span>本次联网核对</span>
            <span className="verify-stats">
              {verification.attempted} 项 · {verification.references.length} 条证据
              {verification.judged ? ` · 丢弃 ${verification.dropped}` : ' · 未判定'}
            </span>
          </div>
          {verification.error && (
            <div className="verify-error">核对失败：{verification.error}</div>
          )}
          {verification.supplements.length > 0 && (
            <div className="verify-supplements">
              {verification.supplements.map((item, index) => (
                <div key={`${index}-${item.slice(0, 8)}`}>+ {item}</div>
              ))}
            </div>
          )}
          <details className="verify-details">
            <summary>查看待核实项与证据</summary>
            {verification.items.filter((item) => item.references.length > 0).length === 0 && (
              <div className="verify-none">本次没有取得可用证据</div>
            )}
            {verification.items
              .filter((item) => item.references.length > 0)
              .map((item, index) => (
              <div key={`${index}-${item.query}`} className="verify-item">
                <div className="verify-query">
                  {item.label || item.query}
                  <span className="verify-line">字幕：{item.line}</span>
                </div>
                {item.references.length === 0 ? (
                  <div className="verify-none">没有可用证据</div>
                ) : (
                  item.references.map((reference) => (
                    <button
                      key={reference.url}
                      className="verify-ref"
                      title={reference.url}
                      onClick={() => void window.bsub.openExternal(reference.url)}
                    >
                      <span className={`verify-verdict ${reference.verdict || 'unknown'}`}>
                        {reference.verdict === 'support'
                          ? '支持'
                          : reference.verdict === 'refute'
                            ? '反驳'
                            : '未判定'}
                      </span>
                      <span className="verify-title">{reference.title}</span>
                    </button>
                  ))
                )}
              </div>
            ))}
          </details>
        </div>
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
