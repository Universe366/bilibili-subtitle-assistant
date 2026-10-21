import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Copy, Eye, Loader2, RefreshCw, Search } from 'lucide-react';
import type {
  OptimizeSuggestion,
  PageInfo,
  QualityReport,
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

function highlightMatch(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const target = q.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const index = lower.indexOf(target, cursor);
    if (index < 0) break;
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(<mark key={`${index}-${parts.length}`}>{text.slice(index, index + q.length)}</mark>);
    cursor = index + q.length;
  }
  if (!parts.length) return text;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
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
  const [translated, setTranslated] = useState<SubtitleLine[] | null>(null);
  const [translatedLang, setTranslatedLang] = useState('');
  const [viewMode, setViewMode] = useState<'original' | 'translated' | 'bilingual'>('original');
  const [translateOpen, setTranslateOpen] = useState(false);
  const [targetLang, setTargetLang] = useState('中文（简体）');
  const [translating, setTranslating] = useState(false);
  const [translateProgress, setTranslateProgress] = useState(0);
  const [translateMessage, setTranslateMessage] = useState('');
  const translateRequestRef = useRef('');
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeProgress, setOptimizeProgress] = useState(0);
  const [optimizeMessage, setOptimizeMessage] = useState('');
  const [suggestions, setSuggestions] = useState<OptimizeSuggestion[] | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const optimizeRequestRef = useRef('');
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [checkingQuality, setCheckingQuality] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [subtitleQuery, setSubtitleQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [customTarget, setCustomTarget] = useState('');
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
    setTranslated(null);
    setTranslatedLang('');
    setViewMode('original');
    setTranslating(false);
    setTranslateProgress(0);
    setTranslateMessage('');
    translateRequestRef.current = '';
    setOptimizing(false);
    setOptimizeProgress(0);
    setOptimizeMessage('');
    setSuggestions(null);
    setSelectedSuggestions(new Set());
    optimizeRequestRef.current = '';
    setQuality(null);
    setCheckingQuality(false);
    setSearchOpen(false);
    setSubtitleQuery('');
    setSearchIndex(0);
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
    const offTranslateProgress = window.bsub.onTranslateProgress((event) => {
      if (event.requestId !== translateRequestRef.current) return;
      setTranslateProgress(event.percent);
      setTranslateMessage(event.message);
    });
    const offTranslateDone = window.bsub.onTranslateDone((event) => {
      if (event.requestId !== translateRequestRef.current) return;
      translateRequestRef.current = '';
      setTranslated(event.lines);
      setTranslatedLang(event.language);
      setViewMode('bilingual');
      setTranslating(false);
      setTranslateProgress(100);
      setTranslateMessage(`已翻译为 ${event.language}`);
      setTranslateOpen(false);
    });
    const offTranslateError = window.bsub.onTranslateError((event) => {
      if (event.requestId !== translateRequestRef.current) return;
      translateRequestRef.current = '';
      setTranslating(false);
      setTranslateMessage('');
      setError(event.error);
    });
    const offOptimizeProgress = window.bsub.onOptimizeProgress((event) => {
      if (event.requestId !== optimizeRequestRef.current) return;
      setOptimizeProgress(event.percent);
      setOptimizeMessage(event.message);
    });
    const offOptimizeDone = window.bsub.onOptimizeDone((event) => {
      if (event.requestId !== optimizeRequestRef.current) return;
      optimizeRequestRef.current = '';
      setOptimizing(false);
      setOptimizeProgress(100);
      setSuggestions(event.suggestions);
      setSelectedSuggestions(new Set(event.suggestions.map((item) => item.index)));
      setOptimizeMessage(
        event.suggestions.length
          ? `发现 ${event.suggestions.length} 处改动`
          : '没有发现需要修改的地方'
      );
    });
    const offOptimizeError = window.bsub.onOptimizeError((event) => {
      if (event.requestId !== optimizeRequestRef.current) return;
      optimizeRequestRef.current = '';
      setOptimizing(false);
      setOptimizeMessage('');
      setError(event.error);
    });
    return () => {
      offProgress();
      offDone();
      offError();
      offTranslateProgress();
      offTranslateDone();
      offTranslateError();
      offOptimizeProgress();
      offOptimizeDone();
      offOptimizeError();
    };
  }, []);

  useEffect(() => {
    setTranslated(null);
    setTranslatedLang('');
    setViewMode('original');
  }, [track?.url, track?.source]);

  const startTranslate = async () => {
    if (!lines.length || translating || !effectiveTarget) return;
    const requestId = (() => {
      try {
        return crypto.randomUUID();
      } catch {
        return `tr_${Date.now()}`;
      }
    })();
    translateRequestRef.current = requestId;
    setTranslating(true);
    setTranslateProgress(0);
    setTranslateMessage('准备翻译…');
    setError(null);
    const started = await window.bsub.translate({ requestId, lines, target: effectiveTarget });
    if (!started.ok) {
      translateRequestRef.current = '';
      setTranslating(false);
      setTranslateMessage('');
      setError(started.error);
    }
  };

  const stopTranslate = () => {
    if (translateRequestRef.current) void window.bsub.cancelTranslate(translateRequestRef.current);
  };

  const startOptimize = async () => {
    if (!lines.length || optimizing) return;
    const requestId = (() => {
      try {
        return crypto.randomUUID();
      } catch {
        return `opt_${Date.now()}`;
      }
    })();
    optimizeRequestRef.current = requestId;
    setOptimizing(true);
    setOptimizeProgress(0);
    setOptimizeMessage('准备校对…');
    setSuggestions(null);
    setSelectedSuggestions(new Set());
    setError(null);
    const started = await window.bsub.optimize({ requestId, lines });
    if (!started.ok) {
      optimizeRequestRef.current = '';
      setOptimizing(false);
      setOptimizeMessage('');
      setError(started.error);
    }
  };

  const stopOptimize = () => {
    if (optimizeRequestRef.current) void window.bsub.cancelOptimize(optimizeRequestRef.current);
  };

  const copyDiagnostics = () => {
    if (!bundle) return;
    const lines = [
      `identity: ${bundle.identity || '未知'}`,
      `needLogin: ${bundle.needLogin}`,
      `sources: ${bundle.sources.join(', ')}`,
      `groups: ${(bundle.diagnostics?.groups || []).join(', ')}`,
      `tracks: ${bundle.tracks.length}`,
      `sniffed: ${bundle.diagnostics?.sniffCount || 0}`,
      `staleSniffed: ${bundle.diagnostics?.staleSniffCount || 0}`,
      `foreignTracks: ${(bundle.diagnostics?.foreignTracks || []).length}`,
      `reason: ${bundle.diagnostics?.reason || ''}`,
      `errors: ${bundle.errors.join('；')}`
    ];
    void window.bsub.writeClipboard(lines.join('\n'));
    setSaveMessage('诊断信息已复制');
    window.setTimeout(() => setSaveMessage(''), 3000);
  };

  const checkQuality = async () => {
    if (!info || !lines.length || checkingQuality) return;
    setCheckingQuality(true);
    setError(null);
    try {
      const response = await window.bsub.checkQuality(info, lines);
      if (response.ok) setQuality(response.data);
      else setError(response.error);
    } finally {
      setCheckingQuality(false);
    }
  };

  const applySuggestions = (all = false) => {
    if (!suggestions) return;
    const chosen = all
      ? suggestions
      : suggestions.filter((item) => selectedSuggestions.has(item.index));
    if (!chosen.length) return;
    const byIndex = new Map(chosen.map((item) => [item.index, item.suggestion]));
    const updated = lines.map((line, index) =>
      byIndex.has(index) ? { ...line, text: byIndex.get(index) || line.text } : line
    );
    setLines(updated);
    if (track?.source === 'asr' && infoRef.current) {
      setAsrResult(videoKeyRef.current, infoRef.current, updated);
    }
    setSuggestions(null);
    setSelectedSuggestions(new Set());
    setTranslated(null);
    setTranslatedLang('');
    setViewMode('original');
    setOptimizeMessage(`已应用 ${chosen.length} 处修改`);
  };

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

  const matchIndices = useMemo(() => {
    const query = subtitleQuery.trim().toLowerCase();
    if (!query) return [] as number[];
    return lines
      .map((line, index) => (line.text.toLowerCase().includes(query) ? index : -1))
      .filter((index) => index >= 0);
  }, [lines, subtitleQuery]);

  const stats = useMemo(() => {
    const chars = lines.reduce((sum, line) => sum + line.text.length, 0);
    const speech = lines.reduce(
      (sum, line) => sum + Math.max(0, (line.end || 0) - (line.start || 0)),
      0
    );
    const coverage = info && info.duration > 0 ? Math.min(1, speech / info.duration) : 0;
    return { chars, coverage };
  }, [lines, info]);

  const effectiveTarget = targetLang === '__custom' ? customTarget.trim() : targetLang;

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

  const jumpMatch = (direction: number) => {
    if (!matchIndices.length) return;
    const next =
      (searchIndex + direction + matchIndices.length) % matchIndices.length;
    setSearchIndex(next);
    const line = lines[matchIndices[next]];
    if (line) jump(line);
  };

  const copyAll = () => {
    void window.bsub.writeClipboard(lines.map((line) => line.text).join('\n'));
    setSaveMessage(`已复制 ${lines.length} 行字幕`);
    window.setTimeout(() => setSaveMessage(''), 3000);
  };

  const copyLine = (text: string) => {
    void window.bsub.writeClipboard(text);
    setSaveMessage('已复制此行');
    window.setTimeout(() => setSaveMessage(''), 2000);
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
          <button
            className="mini-btn"
            disabled={!lines.length || translating}
            title="用 AI 翻译当前字幕"
            onClick={() => setTranslateOpen((value) => !value)}
          >
            {translating ? <Loader2 size={12} className="spin" /> : '翻译'}
          </button>
          <button
            className="mini-btn"
            disabled={!lines.length || optimizing}
            title="用 AI 校对错别字、同音字和专有名词"
            onClick={() => void startOptimize()}
          >
            {optimizing ? <Loader2 size={12} className="spin" /> : '优化'}
          </button>
          <button
            className="mini-btn"
            disabled={!lines.length || checkingQuality}
            title="检查时间轴、覆盖率、语速、重复等问题"
            onClick={() => void checkQuality()}
          >
            {checkingQuality ? <Loader2 size={12} className="spin" /> : '质检'}
          </button>
          {translated && (
            <select
              className="mini-select"
              value={viewMode}
              title="原文 / 译文 / 双语"
              onChange={(event) =>
                setViewMode(event.target.value as 'original' | 'translated' | 'bilingual')
              }
            >
              <option value="original">原文</option>
              <option value="translated">译文</option>
              <option value="bilingual">双语</option>
            </select>
          )}
          <ExportMenu
            info={info}
            track={track}
            lines={lines}
            translated={translated}
            translationLanguage={translatedLang}
          />
          <button
            className={`mini-btn${follow ? ' is-active' : ''}`}
            title={follow ? '跟随播放：开' : '跟随播放：关'}
            onClick={() => setFollow((value) => !value)}
          >
            跟随
          </button>
          <button
            className="icon-btn"
            title="查找字幕"
            onClick={() => setSearchOpen((value) => !value)}
          >
            <Search size={13} />
          </button>
          <button className="icon-btn" title="复制全部字幕" onClick={copyAll}>
            <Copy size={13} />
          </button>
          <button className="icon-btn" title="刷新" onClick={refresh}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="subtitle-search">
          <Search size={13} />
          <input
            className="subtitle-search-input"
            value={subtitleQuery}
            placeholder="查找字幕"
            spellCheck={false}
            onChange={(event) => {
              setSubtitleQuery(event.target.value);
              setSearchIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                jumpMatch(event.shiftKey ? -1 : 1);
              }
              if (event.key === 'Escape') setSearchOpen(false);
            }}
          />
          <span className="subtitle-search-count">
            {subtitleQuery ? `${matchIndices.length} 行` : ''}
          </span>
          <button className="mini-btn" disabled={!matchIndices.length} onClick={() => jumpMatch(-1)}>
            上一
          </button>
          <button className="mini-btn" disabled={!matchIndices.length} onClick={() => jumpMatch(1)}>
            下一
          </button>
        </div>
      )}

      {saveMessage && <div className="save-status">{saveMessage}</div>}

      {translateOpen && (
        <div className="translate-bar">
          <select
            className="mini-select"
            value={targetLang}
            onChange={(event) => setTargetLang(event.target.value)}
          >
            <option value="中文（简体）">中文（简体）</option>
            <option value="中文（繁體）">中文（繁體）</option>
            <option value="English">English</option>
            <option value="日本語">日本語</option>
            <option value="한국어">한국어</option>
            <option value="__custom">自定义…</option>
          </select>
          {targetLang === '__custom' && (
            <input
              className="settings-input"
              style={{ maxWidth: 110 }}
              value={customTarget}
              placeholder="目标语言"
              spellCheck={false}
              onChange={(event) => setCustomTarget(event.target.value)}
            />
          )}
          <button
            className="mini-btn primary"
            disabled={translating || !lines.length || !effectiveTarget}
            onClick={() => void startTranslate()}
          >
            开始翻译
          </button>
          {translating && (
            <button className="mini-btn" onClick={stopTranslate}>
              停止
            </button>
          )}
          <button className="mini-btn" onClick={() => setTranslateOpen(false)}>
            关闭
          </button>
        </div>
      )}

      {translating && (
        <div className="translate-progress">
          <span>{translateMessage || '翻译中…'}</span>
          <span>{Math.round(translateProgress)}%</span>
        </div>
      )}

      {optimizing && (
        <div className="translate-progress">
          <span>{optimizeMessage || '校对中…'}</span>
          <span>
            {Math.round(optimizeProgress)}%
            <button className="mini-btn" onClick={stopOptimize} style={{ marginLeft: 6 }}>
              停止
            </button>
          </span>
        </div>
      )}

      {!optimizing && optimizeMessage && <div className="save-status">{optimizeMessage}</div>}

      {quality && (
        <div className="quality-card">
          <div className="quality-head">
            <span>质检结果</span>
            <button className="mini-btn" onClick={() => setQuality(null)}>
              关闭
            </button>
          </div>
          <div className="quality-stats">
            {quality.stats.lines} 行 · 覆盖 {(quality.stats.coverage * 100).toFixed(0)}% ·{' '}
            {quality.stats.charsPerSecond.toFixed(1)} 字/秒
          </div>
          {quality.issues.length === 0 ? (
            <div className="settings-hint">未发现明显问题</div>
          ) : (
            <div className="quality-list">
              {quality.issues.map((issue, index) => (
                <button
                  key={`${issue.code}-${issue.lineIndex ?? index}`}
                  className={`quality-issue ${issue.severity}`}
                  onClick={() => {
                    if (typeof issue.lineIndex === 'number') {
                      const line = lines[issue.lineIndex];
                      if (line) jump(line);
                    } else if (typeof issue.start === 'number') {
                      setCurrent(issue.start);
                      void window.bsub.seek(issue.start + 0.05);
                    }
                  }}
                >
                  {issue.message}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <div className="opt-panel">
          <div className="opt-head">
            <span>AI 优化建议 · {suggestions.length} 处</span>
            <div className="toolbar-actions">
              <button className="mini-btn" onClick={() => applySuggestions(true)}>
                全部应用
              </button>
              <button
                className="mini-btn"
                onClick={() => {
                  setSuggestions(null);
                  setSelectedSuggestions(new Set());
                }}
              >
                关闭
              </button>
            </div>
          </div>
          <div className="opt-list">
            {suggestions.map((item) => (
              <label key={item.index} className="opt-row">
                <input
                  type="checkbox"
                  checked={selectedSuggestions.has(item.index)}
                  onChange={(event) => {
                    const next = new Set(selectedSuggestions);
                    if (event.target.checked) next.add(item.index);
                    else next.delete(item.index);
                    setSelectedSuggestions(next);
                  }}
                />
                <div className="opt-text">
                  <div className="opt-original">{item.original}</div>
                  <div className="opt-suggestion">
                    {item.suggestion}
                    {item.verdict && (
                      <span className={`opt-verdict ${item.verdict}`}>
                        {item.verdict === 'support'
                          ? '证据支持'
                          : item.verdict === 'refute'
                            ? '证据反对'
                            : '未核实'}
                      </span>
                    )}
                  </div>
                  {item.evidence && <div className="opt-evidence">证据：{item.evidence}</div>}
                </div>
              </label>
            ))}
          </div>
          <button
            className="mini-btn primary"
            disabled={!selectedSuggestions.size}
            onClick={() => applySuggestions(false)}
          >
            应用选中（{selectedSuggestions.size}）
          </button>
        </div>
      )}

      {!translating && translateMessage && <div className="save-status">{translateMessage}</div>}

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

      {bundle && (
        <details className="sub-diagnostics">
          <summary>
            字幕诊断 · {bundle.sources.length} 来源 / {bundle.tracks.length} 轨
          </summary>
          <div className="diag-row">
            身份 <code>{bundle.identity || '未知'}</code>
          </div>
          <div className="diag-row">来源：{bundle.sources.join(' · ') || '无'}</div>
          <div className="diag-row">
            分组：{(bundle.diagnostics?.groups || []).join(' · ') || '无'}
          </div>
          <div className="diag-row">
            嗅探 {bundle.diagnostics?.sniffCount || 0} 条 · 过期{' '}
            {bundle.diagnostics?.staleSniffCount || 0} 条
          </div>
          <div className="diag-row">
            丢弃外来轨：{(bundle.diagnostics?.foreignTracks || []).length}
          </div>
          {bundle.diagnostics?.reason && (
            <div className="diag-row">{bundle.diagnostics.reason}</div>
          )}
          {bundle.errors.length > 0 && (
            <div className="diag-errors">{bundle.errors.join('；')}</div>
          )}
          <div className="diag-tracks">
            {bundle.tracks.map((item) => (
              <div key={`${item.lan}-${item.url}`} className="diag-track">
                {item.lanDoc || item.lan || '未知'} · {item.source || '未知来源'}
                {item.isAi ? ' · AI' : ''}
              </div>
            ))}
          </div>
          <button className="mini-btn" onClick={copyDiagnostics}>
            复制诊断
          </button>
        </details>
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
          <span>
            {lines.length > 0
              ? `${lines.length} 行 · ${stats.chars} 字 · 覆盖 ${Math.round(stats.coverage * 100)}%`
              : ''}
          </span>
          {bundle?.identity && <span className="mono" title={bundle.identity}>{bundle.identity}</span>}
        </div>
      )}
    </div>
  );
}
