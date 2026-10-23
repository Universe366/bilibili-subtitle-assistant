import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Copy, Eye, Loader2, Pencil, RefreshCw, Search, Trash2 } from 'lucide-react';
import type {
  OptimizeSuggestion,
  PageInfo,
  QualityReport,
  SubtitleBundle,
  SubtitleLine,
  SubtitleTrack,
  SubtitleTrackCheck,
  TabInfo
} from '../../../shared/types';
import { pickTrack, isVideoKey, videoKeyOf } from '../lib/video';
import { getAsrResult, setAsrResult } from '../lib/asrStore';
import {
  clearTranslationResult,
  getTranslationResult,
  setTranslationResult
} from '../lib/translationStore';
import { ExportMenu } from './ExportMenu';
import { formatDuration } from '../lib/format';

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

function minCoverageOf(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  // 桌面端没有插件那套「URL 归属 + 缓存签名」全链路，单轨时必须更严格：
  // 45% 覆盖的「别的视频/广告残留」在 B 站接口里很常见，宁可拒绝也不能串片。
  if (duration >= 180) return 0.7;
  return 0.5;
}

const TITLE_STOPWORDS = new Set([
  '视频', '内容', '我们', '你们', '他们', '这个', '那个', '什么', '怎么',
  '为什么', '如何', '到底', '多少', '一个', '一些', '现在', '今天', '就是',
  '可以', '应该', '因为', '所以', '但是', '而且', '然后', '通过', '关于',
  '对于', '以及', '还有', '不过', '或者', '因此', '已经', '正在', '表示',
  '认为', '觉得', '知道', '看到', '进行', '出现', '发生', '成为', '作为',
  '根据', '由于', '同时', '此外', '例如', '比如', '包括', '主要', '重要',
  '可能', '需要', '提供', '支持', '使用', '实现', '第一', '第二', '第三',
  '最后', '开始', '结束', '全集', '高清', '完整版', '最新', '天花板'
]);

function titleKeywords(info: PageInfo | null): string[] {
  if (!info) return [];
  const source = `${info.title || ''} ${info.desc || ''}`;
  const words = new Set<string>();
  for (const run of source.match(/[\u4e00-\u9fa5]{2,}/g) || []) {
    if (run.length <= 8) words.add(run);
    for (let index = 0; index + 1 < run.length; index += 1) {
      const bigram = run.slice(index, index + 2);
      if (!TITLE_STOPWORDS.has(bigram)) words.add(bigram);
    }
  }
  for (const word of source.match(/[A-Za-z][A-Za-z0-9._-]{2,}/g) || []) {
    words.add(word.toLowerCase());
  }
  return [...words].filter((word) => word.length >= 2).slice(0, 30);
}

function subtitleMatchesTitle(lines: SubtitleLine[], info: PageInfo | null): boolean {
  const text = lines.map((line) => line.text).join('').replace(/\s+/g, '');
  if (!/[\u4e00-\u9fa5]/.test(text)) return true; // 英文/其它语言轨不做中文标题匹配
  const keywords = titleKeywords(info);
  if (!keywords.length) return true;
  return keywords.some((word) => text.includes(word));
}

async function evaluateTracks(
  tracks: SubtitleTrack[],
  info: PageInfo | null
): Promise<{ best: SubtitleTrack | null; checks: SubtitleTrackCheck[] }> {
  const initial = pickTrack(tracks, info);
  if (tracks.length <= 1) return { best: initial, checks: [] };
  const candidates = tracks.filter((item) => item.url && item.source !== 'asr').slice(0, 6);
  if (candidates.length <= 1) return { best: initial, checks: [] };

  const duration = Number(info?.duration || 0);
  const checks: SubtitleTrackCheck[] = [];
  const valid: Array<{ candidate: SubtitleTrack; lines: number; lastEnd: number; aligned: boolean }> = [];

  for (const candidate of candidates) {
    const base = {
      url: candidate.url,
      lanDoc: candidate.lanDoc || candidate.lan || '未知语言',
      source: candidate.source || '未知来源',
      isAi: Boolean(candidate.isAi)
    };
    const result = await window.bsub.getTrackBody(candidate.url);
    if (!result.ok || !result.data.lines.length) {
      checks.push({
        ...base,
        lines: 0,
        lastEnd: 0,
        coverage: 0,
        ok: false,
        reason: result.ok ? '没有正文' : `下载失败：${result.error}`
      });
      continue;
    }
    const lines = result.data.lines;
    const lastEnd = lines.reduce(
      (max, line) => Math.max(max, Number(line.end || line.start || 0)),
      0
    );
    const coverage = duration > 0 ? lastEnd / duration : 1;
    // 末句明显超出视频时长（>8% 且 >8s）判为别的视频 / 整段合集，直接丢弃。
    if (duration > 0 && lastEnd > duration * 1.08 + 8) {
      checks.push({
        ...base,
        lines: lines.length,
        lastEnd,
        coverage,
        ok: false,
        reason: `时长明显超出视频（末句 ${Math.round(lastEnd)}s / 视频 ${Math.round(duration)}s）`
      });
      continue;
    }
    if (duration > 0 && coverage < minCoverageOf(duration)) {
      checks.push({
        ...base,
        lines: lines.length,
        lastEnd,
        coverage,
        ok: false,
        reason: `覆盖不足（${Math.round(coverage * 100)}%，需要 ≥${Math.round(
          minCoverageOf(duration) * 100
        )}%）`
      });
      continue;
    }
    // 「对齐片尾」优先：正确轨通常结束在视频时长附近；
    // 广告/合集/别的视频的轨往往更长，即使行数更多也不能选。
    const aligned = duration > 0 ? lastEnd <= duration * 1.02 + 5 : true;
    checks.push({
      ...base,
      lines: lines.length,
      lastEnd,
      coverage,
      ok: true,
      reason: `可用 ${lines.length} 行${aligned ? '' : '（末句超出片尾）'}`
    });
    valid.push({ candidate, lines: lines.length, lastEnd, aligned });
  }

  const alignedRows = valid.filter((row) => row.aligned);
  const pool = alignedRows.length ? alignedRows : valid;
  pool.sort(
    (a, b) =>
      b.lines - a.lines ||
      Math.abs(a.lastEnd - duration) - Math.abs(b.lastEnd - duration)
  );
  const best = pool[0]?.candidate || initial;
  console.log(
    '[subtitle-track-pick]',
    JSON.stringify({
      duration: Math.round(duration),
      checks: checks.map((item) => ({
        lan: item.lanDoc,
        lines: item.lines,
        end: Math.round(item.lastEnd),
        ok: item.ok,
        reason: item.reason
      })),
      picked: best ? `${best.lanDoc}/${best.url.slice(-10)}` : null
    })
  );

  return { best, checks };
}

export function SubtitlesPanel({
  activeTab,
  active = true,
  onOpenSummary,
  onOpenChapters
}: {
  activeTab: TabInfo | null;
  active?: boolean;
  onOpenSummary?: () => void;
  onOpenChapters?: () => void;
}) {
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [bundle, setBundle] = useState<SubtitleBundle | null>(null);
  const [track, setTrack] = useState<SubtitleTrack | null>(null);
  const [lines, setLines] = useState<SubtitleLine[]>([]);
  const [trackNonce, setTrackNonce] = useState(0);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingLines, setLoadingLines] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [collectionImporting, setCollectionImporting] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [asrRunning, setAsrRunning] = useState(false);
  const [asrProgress, setAsrProgress] = useState(0);
  const [asrMessage, setAsrMessage] = useState('');
  const asrRequestRef = useRef('');
  const [translated, setTranslated] = useState<SubtitleLine[] | null>(null);
  const [translatedLang, setTranslatedLang] = useState('');
  const [viewMode, setViewMode] = useState<'original' | 'translated' | 'bilingual'>('original');
  const [trackChecks, setTrackChecks] = useState<SubtitleTrackCheck[]>([]);
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
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [checkingQuality, setCheckingQuality] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [subtitleQuery, setSubtitleQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [customTarget, setCustomTarget] = useState('');

  const autoApplyAfterRef = useRef(false);
  const autoOptimizePendingRef = useRef(false);
  const infoRef = useRef<PageInfo | null>(null);
  const videoKeyRef = useRef('');
  const activeLineRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(follow);
  const lastTimeRef = useRef<number | null>(null);
  const bundleRef = useRef<SubtitleBundle | null>(null);
  const trackRef = useRef<SubtitleTrack | null>(null);
  const failedTrackUrlsRef = useRef<Set<string>>(new Set());
  const coverageRetryRef = useRef(0);

  useEffect(() => {
    followRef.current = follow;
  }, [follow]);
  const loadedRef = useRef<{ key: string; reload: number }>({ key: '', reload: -1 });

  const refresh = useCallback(() => setReloadKey((value) => value + 1), []);
  const videoKey = videoKeyOf(activeTab?.url);
  const isVideoPage = isVideoKey(videoKey);
  infoRef.current = info;
  videoKeyRef.current = videoKey;
  bundleRef.current = bundle;
  trackRef.current = track;

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
    failedTrackUrlsRef.current.clear();
    coverageRetryRef.current = 0;
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
        clearTranslationResult(videoKeyRef.current, 'asr://local');
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
      const track = trackRef.current;
      if (track) {
        setTranslationResult(
          videoKeyRef.current,
          track.url,
          event.lines,
          event.language
        );
      }
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
      if (autoApplyAfterRef.current && event.suggestions.length) {
        autoApplyAfterRef.current = false;
        const byIndex = new Map(event.suggestions.map((item) => [item.index, item.suggestion]));
        setLines((previous) =>
          previous.map((line, index) =>
            byIndex.has(index) ? { ...line, text: byIndex.get(index) || line.text } : line
          )
        );
        setSuggestions(null);
        setSelectedSuggestions(new Set());
        setTranslated(null);
        setTranslatedLang('');
        setViewMode('original');
        setOptimizeMessage(`已自动应用 ${event.suggestions.length} 处修改`);
      }
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
    lastTimeRef.current = null;
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
      ...(bundle.diagnostics?.foreignTracks || []).map(
        (item) =>
          `  - ${item.from || item.source || '未知'}${item.cid ? ` cid=${item.cid}` : ''}${
            item.lan ? ` ${item.lan}` : ''
          } ${item.url || ''}`
      ),
      `reason: ${bundle.diagnostics?.reason || ''}`,
      ...(trackChecks.length
        ? [
            'candidates:',
            ...trackChecks.map(
              (item) =>
                `  - ${item.lanDoc} / ${item.source}${item.isAi ? ' / AI' : ''}: ${
                  item.ok ? '可用' : '不可用'
                }，${item.reason}`
            )
          ]
        : []),
      `errors: ${bundle.errors
        .map(
          (item) =>
            `${item.source || '未知来源'}${item.code != null ? `(code ${String(item.code)})` : ''}: ${
              item.message || '未知错误'
            }`
        )
        .join('；')}`
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
    if (track) clearTranslationResult(videoKeyRef.current, track.url);
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

  useEffect(() => {
    if (!autoOptimizePendingRef.current || !lines.length || optimizing) return;
    autoOptimizePendingRef.current = false;
    void startOptimize();
  }, [lines, optimizing]);

  // 页面加载完成后读取视频信息与字幕轨
  useEffect(() => {
    if (!activeTab || activeTab.loading || !isVideoPage) return;
    if (loadedRef.current.key === videoKey && loadedRef.current.reload === reloadKey) return;
    let cancelled = false;

    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      failedTrackUrlsRef.current.clear();
      try {
        let infoResult = await window.bsub.getPageInfo();
        let subtitlesResult = await window.bsub.getSubtitles(
          infoResult.ok ? infoResult.data.signature : undefined
        );
        let lastPlayerReady = true;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (cancelled) return;
          const identity =
            infoResult.ok && infoResult.data.signature
              ? infoResult.data.signature
              : '';
          const bundleIdentity = subtitlesResult.ok
            ? subtitlesResult.data.identity || ''
            : '';
          const identityMatches = !identity || !bundleIdentity || identity === bundleIdentity;
          // 播放器还没切到当前视频时，B 站接口可能仍返回上一个视频的字幕。
          // 用播放器实际时长与页面信息时长做一道「加载完成」校验。
          let playerReady = true;
          try {
            const played = await window.bsub.getTime();
            const expected = infoResult.ok ? Number(infoResult.data.duration || 0) : 0;
            if (played.ok && expected > 0) {
              const actual = Number(played.data.duration || 0);
              playerReady =
                actual > 0 &&
                Math.abs(actual - expected) <= Math.max(3, expected * 0.03);
            }
          } catch {
            playerReady = true;
          }
          lastPlayerReady = playerReady;
          const sources = subtitlesResult.ok ? subtitlesResult.data.sources : [];
          // 签名接口明确返回「空」时直接认定无字幕，不必再等播放器/重试。
          const wbiEmpty = sources.some((source) => source.includes('player/wbi/v2（空）'));
          const ready =
            infoResult.ok &&
            infoResult.data.bvid &&
            subtitlesResult.ok &&
            identityMatches &&
            (subtitlesResult.data.needLogin ||
              wbiEmpty ||
              (subtitlesResult.data.tracks.length > 0 && playerReady));
          if (wbiEmpty) lastPlayerReady = true;
          if (ready) break;
          await new Promise((resolve) => setTimeout(resolve, 450));
          infoResult = await window.bsub.getPageInfo();
          subtitlesResult = await window.bsub.getSubtitles(
            infoResult.ok ? infoResult.data.signature : undefined
          );
        }
        if (cancelled) return;
        if (
          infoResult.ok &&
          subtitlesResult.ok &&
          infoResult.data.signature &&
          subtitlesResult.data.identity &&
          infoResult.data.signature !== subtitlesResult.data.identity
        ) {
          setInfo(infoResult.data);
          setBundle(null);
          setTrack(null);
          setLines([]);
          setError('字幕身份与当前视频不一致，已丢弃；请刷新页面或重新获取');
          return;
        }

        if (infoResult.ok) setInfo(infoResult.data);
        else {
          setInfo(null);
          setError(infoResult.error);
        }

        if (subtitlesResult.ok) {
          const infoData = infoResult.ok ? infoResult.data : null;
          const tracks = subtitlesResult.data.tracks;
          if (tracks.length > 0 && !lastPlayerReady) {
            setBundle({ ...subtitlesResult.data, tracks: [] });
            setTrack(null);
            setLines([]);
            setTrackChecks([]);
            setError('播放器还没有加载完当前视频，已暂停读取字幕；请稍等后点「重试」');
            return;
          }
          // 转录结果缓存在内存里：点刷新时如果本视频没有官方轨，不要把它弄丢。
          const cachedAsr = getAsrResult(videoKey);
          const asrTrack: SubtitleTrack = {
            lan: 'asr',
            lanDoc: '语音转录',
            url: 'asr://local',
            isAi: false,
            aiStatus: null,
            source: 'asr'
          };
          const displayTracks = cachedAsr
            ? [...tracks.filter((item) => item.source !== 'asr'), asrTrack]
            : tracks;
          setBundle({ ...subtitlesResult.data, tracks: displayTracks });
          const initialTrack =
            cachedAsr && tracks.length === 0 ? asrTrack : pickTrack(tracks, infoData);
          setTrack(initialTrack);
          if (initialTrack?.source === 'asr' && cachedAsr) setLines(cachedAsr.lines);
          setTrackNonce((value) => value + 1);
          if (tracks.length > 1) {
            const initialUrl = initialTrack?.url || '';
            void evaluateTracks(tracks, infoData).then(({ best, checks }) => {
              if (cancelled) return;
              setTrackChecks(checks);
              if (best && best.url !== initialUrl) {
                setTrack((current) =>
                  current?.url === initialUrl || !current ? best : current
                );
              }
            });
          } else {
            setTrackChecks([]);
          }
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

  // 选中的字幕轨下载正文；失败或空正文时自动尝试下一条候选轨（最多 3 条）。
  useEffect(() => {
    if (!track?.url) {
      setLines([]);
      setLoadingLines(false);
      return;
    }
    if (track.source === 'asr') {
      const cached = getAsrResult(videoKeyRef.current);
      if (cached) {
        setLines(cached.lines);
        if (cached.info) setInfo(cached.info);
        const cachedTranslation = getTranslationResult(videoKeyRef.current, track.url);
        if (cachedTranslation && cachedTranslation.lines.length === cached.lines.length) {
          setTranslated(cachedTranslation.lines);
          setTranslatedLang(cachedTranslation.language);
          setViewMode((current) => (current === 'original' ? 'bilingual' : current));
        }
      }
      setLoadingLines(false);
      return;
    }
    let cancelled = false;
    setLoadingLines(true);
    window.bsub
      .getTrackBody(track.url)
      .then((result) => {
        if (cancelled) return;
        if (result.ok && result.data.lines.length) {
          const fetched = result.data.lines;
          const duration = Number(infoRef.current?.duration || 0);
          const lastEnd = fetched.reduce(
            (max, line) => Math.max(max, Number(line.end || line.start || 0)),
            0
          );
          // 单轨/手动选轨也要校验：末句明显超过视频时长的轨不是当前视频。
          if (duration > 0 && lastEnd > duration * 1.08 + 8) {
            failedTrackUrlsRef.current.add(track.url);
            const alternatives = (bundleRef.current?.tracks || []).filter(
              (item) =>
                item.url &&
                item.source !== 'asr' &&
                !failedTrackUrlsRef.current.has(item.url)
            );
            if (failedTrackUrlsRef.current.size < 3 && alternatives.length) {
              setTrack(alternatives[0]);
              return;
            }
            if (coverageRetryRef.current < 4) {
              coverageRetryRef.current += 1;
              setReloadKey((value) => value + 1);
              return;
            }
            setLines([]);
            setError(
              `这条字幕的时长与当前视频不符（末句 ${Math.round(lastEnd)}s / 视频 ${Math.round(
                duration
              )}s），已停止使用；请刷新或重新获取字幕`
            );
            setLoadingLines(false);
            return;
          }
          if (duration > 0) {
            const coverage = lastEnd / duration;
            const min = minCoverageOf(duration);
            if (coverage < min) {
              // 单轨/手动选轨也可能拿到「广告/别的视频」的残留轨：
              // 30 行只覆盖 10% 的视频时，绝不能当成本片字幕。
              console.log(
                '[subtitle-coverage]',
                JSON.stringify({
                  duration: Math.round(duration),
                  lastEnd: Math.round(lastEnd),
                  coverage: Math.round(coverage * 100),
                  min: Math.round(min * 100),
                  lines: fetched.length,
                  retry: coverageRetryRef.current,
                  url: track.url.slice(-10)
                })
              );
              failedTrackUrlsRef.current.add(track.url);
              const alternatives = (bundleRef.current?.tracks || []).filter(
                (item) =>
                  item.url &&
                  item.source !== 'asr' &&
                  !failedTrackUrlsRef.current.has(item.url)
              );
              if (failedTrackUrlsRef.current.size < 3 && alternatives.length) {
                setTrack(alternatives[0]);
                return;
              }
              // B 站接口在切页/预取时会短暂返回别的视频的轨，重新获取几次通常能碰到正确的。
              if (coverageRetryRef.current < 4) {
                coverageRetryRef.current += 1;
                setReloadKey((value) => value + 1);
                return;
              }
              setLines([]);
              setError(
                `这条字幕只覆盖 ${Math.round(coverage * 100)}%（末句 ${Math.round(
                  lastEnd
                )}s / 视频 ${Math.round(duration)}s），与当前视频不匹配，已停止使用`
              );
              setLoadingLines(false);
              return;
            }
          }
          if (duration > 0 && lastEnd / duration < 0.97) {
            // 覆盖率不足以证明归属时，再看字幕正文是否真的提到标题里的事物。
            // 宁可放过一条全片字幕，也不能把「郎酒」视频配上「京都旅行」的字幕。
            if (!subtitleMatchesTitle(fetched, infoRef.current)) {
              console.log(
                '[subtitle-content]',
                JSON.stringify({
                  title: infoRef.current?.title?.slice(0, 30),
                  lines: fetched.length,
                  first: fetched[0]?.text?.slice(0, 24),
                  retry: coverageRetryRef.current
                })
              );
              failedTrackUrlsRef.current.add(track.url);
              const alternatives = (bundleRef.current?.tracks || []).filter(
                (item) =>
                  item.url &&
                  item.source !== 'asr' &&
                  !failedTrackUrlsRef.current.has(item.url)
              );
              if (failedTrackUrlsRef.current.size < 3 && alternatives.length) {
                setTrack(alternatives[0]);
                return;
              }
              if (coverageRetryRef.current < 4) {
                coverageRetryRef.current += 1;
                setReloadKey((value) => value + 1);
                return;
              }
              setLines([]);
              setError('这条字幕的内容与视频标题不匹配，已停止使用；请刷新或改用语音转录');
              setLoadingLines(false);
              return;
            }
          }
          coverageRetryRef.current = 0;
          const cachedTranslation = getTranslationResult(videoKeyRef.current, track.url);
          if (cachedTranslation && cachedTranslation.lines.length === fetched.length) {
            setTranslated(cachedTranslation.lines);
            setTranslatedLang(cachedTranslation.language);
            setViewMode((current) => (current === 'original' ? 'bilingual' : current));
          } else {
            setTranslated(null);
            setTranslatedLang('');
            setViewMode('original');
          }
          setLines(fetched);
          setLoadingLines(false);
          return;
        }
        failedTrackUrlsRef.current.add(track.url);
        const alternatives = (bundleRef.current?.tracks || []).filter(
          (item) =>
            item.url &&
            item.source !== 'asr' &&
            !failedTrackUrlsRef.current.has(item.url)
        );
        if (failedTrackUrlsRef.current.size < 3 && alternatives.length) {
          setTrack(alternatives[0]);
          return;
        }
        setLines([]);
        setError(result.ok ? '这条字幕没有正文' : result.error);
        setLoadingLines(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setLines([]);
        setError((error as Error).message);
        setLoadingLines(false);
      });
    return () => {
      cancelled = true;
    };
  }, [track?.url, trackNonce]);

  // 跟随播放：每秒取一次当前时间（面板隐藏时暂停轮询）
  useEffect(() => {
    if (!active) return;
    if (!track || lines.length === 0) return;
    let alive = true;
    const tick = () => {
      window.bsub
        .getTime()
        .then((result) => {
          if (!alive || !result.ok) return;
          const next = result.data.currentTime;
          const previous = lastTimeRef.current;
          lastTimeRef.current = next;
          // 拖动进度条 / 大跳转后自动恢复跟随（与插件一致）；
          // 正常播放每秒只前进约 1s，不会触发。
          if (previous != null && Math.abs(next - previous) > 5 && !followRef.current) {
            setFollow(true);
          }
          setCurrent(next);
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
  }, [track, lines.length, active]);

  const searchTexts = useMemo(
    () =>
      lines.map((line, index) => {
        const translation = translated?.[index]?.text || '';
        if (viewMode === 'translated') return translation || line.text;
        if (viewMode === 'bilingual') return `${line.text} ${translation}`.trim();
        return line.text;
      }),
    [lines, translated, viewMode]
  );

  const matchIndices = useMemo(() => {
    const query = subtitleQuery.trim().toLowerCase();
    if (!query) return [] as number[];
    return searchTexts
      .map((text, index) => (text.toLowerCase().includes(query) ? index : -1))
      .filter((index) => index >= 0);
  }, [searchTexts, subtitleQuery]);

  const displayText = (line: SubtitleLine, index: number): string => {
    const translation = translated?.[index]?.text || '';
    if (viewMode === 'translated') return translation || line.text;
    if (viewMode === 'bilingual') return translation ? `${line.text}\n${translation}` : line.text;
    return line.text;
  };

  const stats = useMemo(() => {    const chars = lines.reduce((sum, line) => sum + line.text.length, 0);
    const speech = lines.reduce(
      (sum, line) => sum + Math.max(0, (line.end || 0) - (line.start || 0)),
      0
    );
    const coverage = info && info.duration > 0 ? Math.min(1, speech / info.duration) : 0;
    return { chars, speech, coverage };
  }, [lines, info]);

  const checkByUrl = useMemo(
    () => new Map(trackChecks.map((item) => [item.url, item])),
    [trackChecks]
  );

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
    if (!active) return;
    if (!follow || currentIndex < 0) return;
    activeLineRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentIndex, follow, active]);

  const jump = (line: SubtitleLine) => {
    setCurrent(line.start);
    void window.bsub.seek(line.start + 0.05);
  };

  const jumpMatch = (direction: number) => {
    if (!matchIndices.length) return;
    const next =
      (searchIndex + direction + matchIndices.length) % matchIndices.length;
    setSearchIndex(next);
    setFollow(true);
    const line = lines[matchIndices[next]];
    if (line) jump(line);
  };

  const copyAll = () => {
    const texts = lines.map((line, index) => displayText(line, index));
    void window.bsub.writeClipboard(texts.join('\n'));
    setSaveMessage(`已复制 ${lines.length} 行字幕（${viewMode === 'original' ? '原文' : viewMode === 'translated' ? '译文' : '双语'}）`);
    window.setTimeout(() => setSaveMessage(''), 3000);
  };

  const commitEdit = () => {
    if (editingIndex == null) return;
    const next = lines.map((line, index) =>
      index === editingIndex ? { ...line, text: editingText } : line
    );
    setLines(next);
    if (track) clearTranslationResult(videoKeyRef.current, track.url);
    if (track?.source === 'asr' && infoRef.current) {
      setAsrResult(videoKeyRef.current, infoRef.current, next);
    }
    setEditingIndex(null);
    setEditingText('');
    setSaveMessage('已修改此行');
    window.setTimeout(() => setSaveMessage(''), 2000);
  };

  const clearSubtitles = () => {
    if (!lines.length) return;
    if (!window.confirm('清空当前字幕显示？不会删除本地库、缓存或视频。')) return;
    setLines([]);
    if (track) clearTranslationResult(videoKeyRef.current, track.url);
    setTrack(null);
    setBundle(null);
    setEditingIndex(null);
    setEditingText('');
    setTranslated(null);
    setTranslatedLang('');
    setViewMode('original');
    setSuggestions(null);
    setSelectedSuggestions(new Set());
    setQuality(null);
    setSearchOpen(false);
    setSubtitleQuery('');
    setSearchIndex(0);
    setError(null);
    setSaveMessage('已清空当前字幕显示');
    window.setTimeout(() => setSaveMessage(''), 2500);
  };

  const triggerMenu = async () => {
    setSaveMessage('正在让播放器重新请求字幕…');
    const result = await window.bsub.triggerSubtitleMenu();
    if (!result.ok) {
      setSaveMessage('');
      setError(result.error);
      return;
    }
    window.setTimeout(() => refresh(), 900);
    window.setTimeout(() => setSaveMessage(''), 3500);
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

  const importCollection = async () => {
    if (!info?.url || collectionImporting) return;
    setCollectionImporting(true);
    setSaveMessage('');
    try {
      const resolved = await window.bsub.resolveCollection(info.url);
      if (!resolved.ok) {
        setSaveMessage(`识别失败：${resolved.error}`);
        return;
      }
      if (resolved.data.total <= 1) {
        setSaveMessage('当前视频不在合集或多 P 里，直接用「入库」即可');
        return;
      }
      const urls = resolved.data.items.map((item) => item.url).join('\n');
      const response = await window.bsub.batchUrls([urls], false);
      setSaveMessage(
        response.ok
          ? `已开始导入《${resolved.data.title}》共 ${resolved.data.total} 个，进度见底部任务`
          : `导入失败：${response.error}`
      );
    } finally {
      setCollectionImporting(false);
      window.setTimeout(() => setSaveMessage(''), 6000);
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
            disabled={!info?.url || collectionImporting || info.kind === 'youtube'}
            title="把当前视频所在的 UP 合集或多 P 全部入库（不自动总结）"
            onClick={() => void importCollection()}
          >
            {collectionImporting ? <Loader2 size={12} className="spin" /> : '合集'}
          </button>
          <button
            className="mini-btn"
            disabled={!info || asrRunning || info.kind === 'youtube'}
            title={
              info?.kind === 'youtube'
                ? 'YouTube 暂不支持语音转录，请优先使用官方/自动字幕'
                : '没有官方字幕时，用视频音轨做语音转录'
            }
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
            disabled={!lines.length}
            title="跳到总结页并用当前字幕生成总结"
            onClick={() => onOpenSummary?.()}
          >
            总结
          </button>
          <button
            className="mini-btn"
            disabled={!lines.length}
            title="用 AI 按内容切章节，并在总结页查看 / 点击跳转"
            onClick={() => onOpenChapters?.()}
          >
            章节
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
          <button className="icon-btn" title="复制全部字幕" disabled={!lines.length} onClick={copyAll}>
            <Copy size={13} />
          </button>
          <button
            className="icon-btn"
            title="清空字幕显示（不删除本地库与缓存）"
            disabled={!lines.length}
            onClick={clearSubtitles}
          >
            <Trash2 size={13} />
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
                        {item.sources ? ` · ${item.sources} 源` : ''}
                        {item.consistency === 'conflict'
                          ? ' · 有冲突'
                          : item.consistency === 'multi'
                            ? ' · 多源'
                            : item.consistency === 'single'
                              ? ' · 单源'
                              : ''}
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

      {!activeTab && <div className="panel-empty">打开一个视频页后显示字幕</div>}

      {activeTab && !isVideoPage && (
        <div className="panel-empty">当前页面不是视频页</div>
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
              {info.owner || (info.kind === 'youtube' ? '未知频道' : '未知 UP')}
              {info.duration ? ` · ${formatDuration(info.duration)}` : ''}
            </div>
            <div className="video-tags">
              {info.bvid && <span className="mini-tag">{info.bvid}</span>}
              {info.kind !== 'youtube' && info.page > 0 && (
                <span className="mini-tag">P{info.page}</span>
              )}
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
          {bundle.diagnostics?.apiTrackCount != null && (
            <div className="diag-row">
              官方接口 {bundle.diagnostics.apiTrackCount} 轨
              {bundle.diagnostics.apiFiltered
                ? ` · 因不一致丢弃 ${bundle.diagnostics.apiFiltered} 轨`
                : ''}
            </div>
          )}
          <div className="diag-row">
            分组：{(bundle.diagnostics?.groups || []).join(' · ') || '无'}
          </div>
          <div className="diag-row">
            嗅探 {bundle.diagnostics?.sniffCount || 0} 条 · 过期{' '}
            {bundle.diagnostics?.staleSniffCount || 0} 条
          </div>
          {bundle.diagnostics?.identityMismatch && (
            <div className="diag-row diag-warn">身份不一致：请求的字幕与当前页面不一致，已丢弃</div>
          )}
          {bundle.diagnostics?.identityUnstable && (
            <div className="diag-row diag-warn">页面身份不稳定：URL / 初始状态 / 分P 对不上</div>
          )}
          {bundle.diagnostics?.signatureChanged && (
            <div className="diag-row diag-warn">采集期间视频已切换，本次结果作废</div>
          )}
          <div className="diag-row">
            丢弃外来轨：{(bundle.diagnostics?.foreignTracks || []).length}
          </div>
          {(bundle.diagnostics?.foreignTracks || []).length > 0 && (
            <details className="diag-sub">
              <summary>查看被排除的外来轨</summary>
              {(bundle.diagnostics?.foreignTracks || []).map((item, index) => (
                <div className="diag-foreign" key={`${item.url}-${index}`} title={item.url}>
                  {item.from || item.source || '未知来源'}
                  {item.cid ? ` · cid ${item.cid}` : ''}
                  {item.lan ? ` · ${item.lan}` : ''}
                  {item.url ? ` · ${item.url}` : ''}
                </div>
              ))}
            </details>
          )}
          {trackChecks.length > 0 && (
            <details className="diag-sub" open>
              <summary>
                候选轨判定 · {trackChecks.filter((item) => item.ok).length}/{trackChecks.length} 可用
              </summary>
              {trackChecks.map((item) => (
                <div
                  className={`diag-check ${item.ok ? 'is-ok' : 'is-bad'}`}
                  key={item.url}
                  title={item.url}
                >
                  <span>
                    {item.lanDoc} · {item.source}
                    {item.isAi ? ' · AI' : ''}
                  </span>
                  <span className="diag-check-reason">
                    {item.ok ? '✓' : '✕'} {item.reason}
                  </span>
                </div>
              ))}
            </details>
          )}
          {bundle.diagnostics?.reason && (
            <div className="diag-row">{bundle.diagnostics.reason}</div>
          )}
          {bundle.errors.length > 0 && (
            <div className="diag-errors">
              {bundle.errors.map((item, index) => (
                <div className="diag-error-row" key={`${item.source}-${index}`}>
                  <code>{item.source || '未知来源'}</code>
                  {item.code != null && <span className="diag-code">code {String(item.code)}</span>}
                  <span>{item.message || '未知错误'}</span>
                </div>
              ))}
            </div>
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
          {bundle.tracks.map((item) => {
            const check = checkByUrl.get(item.url);
            const invalid = check ? !check.ok : false;
            return (
              <button
                key={`${item.lan}-${item.url}`}
                className={`track-chip${track?.url === item.url ? ' is-active' : ''}${
                  invalid ? ' is-invalid' : ''
                }`}
                title={`${item.source || '未知来源'} · ${item.lan}${
                  check ? ` · ${check.reason}` : ''
                }`}
                disabled={invalid}
                onClick={() => {
                  failedTrackUrlsRef.current.clear();
                  setError(null);
                  setTrack(item);
                }}
              >
                {item.lanDoc || item.lan || '未知语言'}
                {item.isAi && <span className="ai-badge">AI</span>}
                {invalid && <span className="ai-badge">不可用</span>}
              </button>
            );
          })}
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
          <div className="panel-empty-actions">
            <button className="primary-btn" onClick={refresh}>
              重新获取字幕
            </button>
            <button className="mini-btn" onClick={() => void startAsr()}>
              改为语音转录
            </button>
            <button className="mini-btn" onClick={() => void triggerMenu()}>
              让播放器重新请求
            </button>
          </div>
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
              <span className="sub-time">{formatDuration(line.start)}</span>
              {editingIndex === index ? (
                <input
                  className="sub-edit"
                  autoFocus
                  value={editingText}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setEditingText(event.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitEdit();
                    } else if (event.key === 'Escape') {
                      setEditingIndex(null);
                      setEditingText('');
                    }
                  }}
                />
              ) : (
                <span
                  className="sub-text"
                  title={`${formatDuration(line.start)} – ${formatDuration(line.end)} · ${line.text.length} 字 · 约 ${Math.max(
                    1,
                    Math.round(line.text.length / 4)
                  )} 秒${translated?.[index]?.text ? `\n译文：${translated[index].text}` : ''}`}
                >
                  {viewMode !== 'translated' && (
                    <span className="sub-text-row">
                      {subtitleQuery.trim()
                        ? highlightMatch(line.text, subtitleQuery)
                        : line.text}
                    </span>
                  )}
                  {viewMode !== 'original' && (
                    <span className={`sub-text-row${viewMode === 'bilingual' ? ' sub-text-translated' : ''}`}>
                      {subtitleQuery.trim()
                        ? highlightMatch(
                            translated?.[index]?.text || (viewMode === 'translated' ? line.text : ''),
                            subtitleQuery
                          )
                        : translated?.[index]?.text ||
                          (viewMode === 'translated' ? line.text : '')}
                    </span>
                  )}
                </span>
              )}
              <button
                className="sub-edit-btn"
                title="编辑此行"
                onClick={(event) => {
                  event.stopPropagation();
                  setEditingIndex(index);
                  setEditingText(line.text);
                }}
              >
                <Pencil size={10} />
              </button>
              <button
                className="sub-copy"
                title="复制此行"
                onClick={(event) => {
                  event.stopPropagation();
                  copyLine(displayText(line, index));
                }}
              >
                <Copy size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {(lines.length > 0 || bundle?.identity) && (
        <div className="panel-foot">
          <span>
            {lines.length > 0
              ? `${lines.length} 行 · ${stats.chars} 字 · 朗读约 ${formatDuration(stats.speech)} · 覆盖 ${Math.round(
                  stats.coverage * 100
                )}%`
              : ''}
          </span>
          {bundle?.identity && <span className="mono" title={bundle.identity}>{bundle.identity}</span>}
        </div>
      )}
    </div>
  );
}
