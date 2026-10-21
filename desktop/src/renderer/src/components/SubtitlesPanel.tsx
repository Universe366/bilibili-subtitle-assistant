import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Eye, Loader2, RefreshCw } from 'lucide-react';
import type {
  PageInfo,
  SubtitleBundle,
  SubtitleLine,
  SubtitleTrack,
  TabInfo
} from '../../../shared/types';
import { pickTrack, videoKeyOf } from '../lib/video';
import { setAsrResult } from '../lib/asrStore';
import { ExportMenu } from './ExportMenu';

function fmtTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function fmtCount(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return String(value);
}

export function SubtitlesPanel({ activeTab }: { activeTab: TabInfo | null }) {
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [bundle, setBundle] = useState<SubtitleBundle | null>(null);
  const [track, setTrack] = useState<SubtitleTrack | null>(null);
  const [lines, setLines] = useState<SubtitleLine[]>([]);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingLines, setLoadingLines] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [asrRunning, setAsrRunning] = useState(false);
  const [asrProgress, setAsrProgress] = useState(0);
  const [asrMessage, setAsrMessage] = useState('');
  const asrRequestRef = useRef('');
  const infoRef = useRef<PageInfo | null>(null);
  const videoKeyRef = useRef('');
  const activeLineRef = useRef<HTMLDivElement | null>(null);
  const loadedRef = useRef<{ key: string; reload: number }>({ key: '', reload: -1 });

  const refresh = useCallback(() => setReloadKey((value) => value + 1), []);
  const videoKey = videoKeyOf(activeTab?.url);
  const isVideoPage = videoKey.startsWith('v:') || videoKey.startsWith('e:');
  infoRef.current = info;
  videoKeyRef.current = videoKey;

  // 切换视频时先清空，避免短暂显示上一个视频的字幕
  useEffect(() => {
    setInfo(null);
    setBundle(null);
    setTrack(null);
    setLines([]);
    setCurrent(0);
    setError(null);
    setLoading(false);
    setAsrRunning(false);
    setAsrProgress(0);
    setAsrMessage('');
    asrRequestRef.current = '';
    loadedRef.current = { key: '', reload: -1 };
  }, [activeTab?.id, videoKey]);

  useEffect(() => {
    const offProgress = window.bsub.onAsrProgress((event) => {
      if (event.requestId !== asrRequestRef.current) return;
      setAsrProgress(event.percent);
      setAsrMessage(event.message);
    });
    const offDone = window.bsub.onAsrDone((event) => {
      if (event.requestId !== asrRequestRef.current) return;
      asrRequestRef.current = '';
      setLines(event.lines);
      setBundle(null);
      setTrack({
        lan: 'asr',
        lanDoc: '语音转录',
        url: 'asr://local',
        isAi: false,
        aiStatus: null,
        source: 'asr'
      });
      setAsrRunning(false);
      setAsrProgress(100);
      setAsrMessage(`转写完成 · ${event.lines.length} 行`);
      if (infoRef.current) {
        setAsrResult(videoKeyRef.current, infoRef.current, event.lines);
      }
    });
    const offError = window.bsub.onAsrError((event) => {
      if (event.requestId !== asrRequestRef.current) return;
      asrRequestRef.current = '';
      setAsrRunning(false);
      setAsrMessage('');
      setError(event.error);
    });
    return () => {
      offProgress();
      offDone();
      offError();
    };
  }, []);

  // 页面加载完成后读取视频信息与字幕轨
  useEffect(() => {
    if (!activeTab || activeTab.loading || !isVideoPage) return;
    if (loadedRef.current.key === videoKey && loadedRef.current.reload === reloadKey) return;
    let cancelled = false;

    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const [infoResult, subtitlesResult] = await Promise.all([
          window.bsub.getPageInfo(),
          window.bsub.getSubtitles()
        ]);
        if (cancelled) return;

        if (infoResult.ok) setInfo(infoResult.data);
        else {
          setInfo(null);
          setError(infoResult.error);
        }

        if (subtitlesResult.ok) {
          const infoData = infoResult.ok ? infoResult.data : null;
          setBundle(subtitlesResult.data);
          setTrack(pickTrack(subtitlesResult.data.tracks, infoData));
        } else {
          setBundle(null);
          setTrack(null);
          setError((previous) => previous ?? subtitlesResult.error);
        }
        if (infoResult.ok && subtitlesResult.ok) {
          loadedRef.current = { key: videoKey, reload: reloadKey };
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 650);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeTab?.id, activeTab?.loading, videoKey, isVideoPage, reloadKey]);

  // 选中的字幕轨下载正文
  useEffect(() => {
    if (!track?.url) {
      setLines([]);
      return;
    }
    if (track.source === 'asr') return;
    let cancelled = false;
    setLoadingLines(true);
    window.bsub
      .getTrackBody(track.url)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setLines(result.data.lines);
        else setError(result.error);
      })
      .finally(() => {
        if (!cancelled) setLoadingLines(false);
      });
    return () => {
      cancelled = true;
    };
  }, [track?.url]);

  // 跟随播放：每秒取一次当前时间
  useEffect(() => {
    if (!track || lines.length === 0) return;
    let alive = true;
    const tick = () => {
      window.bsub
        .getTime()
        .then((result) => {
          if (alive && result.ok) setCurrent(result.data.currentTime);
        })
        .catch(() => {
          // 页面切换/关闭时忽略
        });
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [track, lines.length]);

  const currentIndex = useMemo(() => {
    if (!lines.length) return -1;
    let index = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].start <= current + 0.05) index = i;
      else break;
    }
    return index;
  }, [lines, current]);

  useEffect(() => {
    if (!follow || currentIndex < 0) return;
    activeLineRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentIndex, follow]);

  const jump = (line: SubtitleLine) => {
    setCurrent(line.start);
    void window.bsub.seek(line.start + 0.05);
  };

  const startAsr = async () => {
    if (!info || asrRunning) return;
    const requestId = (() => {
      try {
        return crypto.randomUUID();
      } catch {
        return `asr_${Date.now()}`;
      }
    })();
    asrRequestRef.current = requestId;
    setAsrRunning(true);
    setAsrProgress(0);
    setAsrMessage('准备音轨…');
    setError(null);
    const started = await window.bsub.transcribe(requestId);
    if (!started.ok) {
      asrRequestRef.current = '';
      setAsrRunning(false);
      setAsrMessage('');
      setError(started.error);
    }
  };

  const stopAsr = () => {
    if (asrRequestRef.current) void window.bsub.cancelTranscribe(asrRequestRef.current);
  };

  const ingest = async () => {
    if (!info || !track || !lines.length || saving) return;
    setSaving(true);
    setSaveMessage('');
    try {
      const response = await window.bsub.ingestLibrary({ info, track, lines });
      setSaveMessage(
        response.ok ? `已入库 · ${response.data.lineCount} 行` : `入库失败：${response.error}`
      );
    } finally {
      setSaving(false);
      window.setTimeout(() => setSaveMessage(''), 4000);
    }
  };

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div className="panel-title">字幕</div>
        <div className="toolbar-actions">
          <button
            className="mini-btn primary"
            disabled={!info || !track || !lines.length || saving}
            title="把当前字幕保存到本地库"
            onClick={() => void ingest()}
          >
            {saving ? <Loader2 size={12} className="spin" /> : '入库'}
          </button>
          <button
            className="mini-btn"
            disabled={!info || asrRunning}
            title="没有官方字幕时，用视频音轨做语音转录"
            onClick={() => void startAsr()}
          >
            {asrRunning ? <Loader2 size={12} className="spin" /> : '转写'}
          </button>
          <ExportMenu info={info} track={track} lines={lines} />
          <button
            className={`mini-btn${follow ? ' is-active' : ''}`}
            title={follow ? '跟随播放：开' : '跟随播放：关'}
            onClick={() => setFollow((value) => !value)}
          >
            跟随
          </button>
          <button className="icon-btn" title="刷新" onClick={refresh}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {saveMessage && <div className="save-status">{saveMessage}</div>}

      {asrRunning && (
        <div className="asr-progress">
          <div className="asr-progress-head">
            <span>{asrMessage || '准备音轨…'}</span>
            <button className="mini-btn" onClick={stopAsr}>
              停止
            </button>
          </div>
          <div className="asr-bar">
            <span style={{ width: `${Math.max(2, asrProgress)}%` }} />
          </div>
        </div>
      )}

      {!asrRunning && asrMessage && <div className="save-status">{asrMessage}</div>}

      {!activeTab && <div className="panel-empty">打开一个 B 站视频后显示字幕</div>}

      {activeTab && !isVideoPage && (
        <div className="panel-empty">当前页面不是 B 站视频页</div>
      )}

      {activeTab && loading && !info && (
        <div className="skeleton-card">
          <div className="skeleton-line w-70" />
          <div className="skeleton-line w-40" />
        </div>
      )}

      {info && (
        <div className="video-card">
          {info.cover ? (
            <img className="video-cover" src={info.cover} alt="" />
          ) : (
            <div className="video-cover video-cover-fallback">{info.title.slice(0, 1) || 'B'}</div>
          )}
          <div className="video-meta">
            <div className="video-title" title={info.title}>
              {info.title || '未识别到视频'}
            </div>
            <div className="video-sub">
              {info.owner || '未知 UP'}
              {info.duration ? ` · ${fmtTime(info.duration)}` : ''}
            </div>
            <div className="video-tags">
              {info.bvid && <span className="mini-tag">{info.bvid}</span>}
              {info.page > 0 && <span className="mini-tag">P{info.page}</span>}
              {info.stat && info.stat.view > 0 && (
                <span className="mini-tag">
                  <Eye size={11} />
                  {fmtCount(info.stat.view)}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="warn-card">
          <AlertTriangle size={15} />
          <div className="warn-body">
            <div className="warn-title">读取失败</div>
            <div className="warn-desc">{error}</div>
            <button className="warn-btn" onClick={refresh}>
              重试
            </button>
          </div>
        </div>
      )}

      {bundle?.needLogin && (
        <div className="warn-card">
          <AlertTriangle size={15} />
          <div className="warn-body">
            <div className="warn-title">需要登录 B 站</div>
            <div className="warn-desc">登录后才能读取 AI 字幕，并解锁 1080P 清晰度。</div>
            <button
              className="warn-btn"
              onClick={() => void window.bsub.newTab('https://passport.bilibili.com/login')}
            >
              打开登录页
            </button>
          </div>
        </div>
      )}

      {bundle && bundle.tracks.length > 0 && (
        <div className="track-list">
          {bundle.tracks.map((item) => (
            <button
              key={`${item.lan}-${item.url}`}
              className={`track-chip${track?.url === item.url ? ' is-active' : ''}`}
              title={`${item.source || '未知来源'} · ${item.lan}`}
              onClick={() => setTrack(item)}
            >
              {item.lanDoc || item.lan || '未知语言'}
              {item.isAi && <span className="ai-badge">AI</span>}
            </button>
          ))}
        </div>
      )}

      {loadingLines && (
        <div className="status-line">
          <Loader2 size={13} className="spin" />
          正在下载字幕…
        </div>
      )}

      {!loadingLines && track && lines.length === 0 && !error && (
        <div className="panel-empty">这条字幕没有正文</div>
      )}

      {!track && !loading && bundle && bundle.tracks.length === 0 && !bundle.needLogin && (
        <div className="panel-empty">
          没有找到字幕轨
          {bundle.sources.length > 0 && <div className="panel-hint">来源：{bundle.sources.join(' · ')}</div>}
        </div>
      )}

      {lines.length > 0 && (
        <div className="sub-list">
          {lines.map((line, index) => (
            <div
              key={`${line.start}-${index}`}
              ref={index === currentIndex ? activeLineRef : undefined}
              className={`sub-line${index === currentIndex ? ' is-active' : ''}`}
              onClick={() => jump(line)}
            >
              <span className="sub-time">{fmtTime(line.start)}</span>
              <span className="sub-text">{line.text}</span>
            </div>
          ))}
        </div>
      )}

      {(lines.length > 0 || bundle?.identity) && (
        <div className="panel-foot">
          <span>{lines.length > 0 ? `${lines.length} 行` : ''}</span>
          {bundle?.identity && <span className="mono" title={bundle.identity}>{bundle.identity}</span>}
        </div>
      )}
    </div>
  );
}
