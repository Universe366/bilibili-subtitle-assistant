import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ExternalLink, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react';
import type {
  LibraryDetail,
  LibraryList,
  LibrarySearchResult,
  LibrarySort,
  LibraryVideo,
  SummaryVersion,
  SummaryVersionMeta
} from '../../../shared/types';
import { ConfirmDialog } from './ConfirmDialog';
import { ExportMenu } from './ExportMenu';
import { Markdown } from './Markdown';

const SORTS: Array<{ id: LibrarySort; label: string }> = [
  { id: 'updated', label: '最近更新' },
  { id: 'created', label: '最近入库' },
  { id: 'title', label: '按标题' },
  { id: 'duration', label: '按时长' }
];

const LINE_PAGE = 400;

function fmtTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function fmtBytes(bytes: number): string {
  if (!bytes) return '0 MB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleDateString('zh-CN');
  } catch {
    return '';
  }
}

function fmtDateTime(ms: number): string {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

export function LibraryPanel() {
  const [list, setList] = useState<LibraryList | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<LibrarySearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchNonce, setSearchNonce] = useState(0);
  const [sort, setSort] = useState<LibrarySort>('updated');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LibraryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'subtitles' | 'summary'>('subtitles');
  const [lineLimit, setLineLimit] = useState(LINE_PAGE);
  const [pendingDelete, setPendingDelete] = useState<LibraryVideo | null>(null);
  const [versions, setVersions] = useState<SummaryVersionMeta[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [preview, setPreview] = useState<SummaryVersion | null>(null);
  const [busyVersion, setBusyVersion] = useState(0);

  const searchSeq = useRef(0);
  const detailSeq = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await window.bsub.listLibrary(sort);
      if (response.ok) {
        setList(response.data);
        setError(null);
      } else {
        setError(response.error);
      }
    } finally {
      setLoading(false);
    }
  }, [sort]);

  const loadVersions = useCallback(async (videoId: number) => {
    const response = await window.bsub.getSummaryVersions(videoId);
    if (response.ok) setVersions(response.data);
  }, []);

  const fetchDetail = useCallback(async (id: number) => {
    const seq = ++detailSeq.current;
    setDetailLoading(true);
    try {
      const response = await window.bsub.getLibraryItem(id);
      if (seq !== detailSeq.current) return;
      if (response.ok) {
        setDetail(response.data);
        void loadVersions(id);
      } else if (/视频不存在/.test(response.error)) {
        // 删除后 library:changed 可能晚一步到达：安静退回列表。
        setSelectedId(null);
        setDetail(null);
      } else {
        setError(response.error);
        setSelectedId(null);
        setDetail(null);
      }
    } finally {
      if (seq === detailSeq.current) setDetailLoading(false);
    }
  }, [loadVersions]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return window.bsub.onLibraryChanged(() => {
      void load();
      if (selectedId != null) void fetchDetail(selectedId);
      setSearchNonce((value) => value + 1);
    });
  }, [load, selectedId, fetchDetail]);

  // 记录面板的「在库中查看」：切到库之后由这套监听打开对应条目。
  useEffect(() => {
    const handler = (event: Event) => {
      const id = Number((event as CustomEvent).detail);
      if (!Number.isFinite(id) || id <= 0) return;
      setSelectedId(id);
      setDetail(null);
      setLineLimit(LINE_PAGE);
      setDetailTab('subtitles');
      setPreview(null);
      setVersions([]);
      setVersionsOpen(false);
      void fetchDetail(id);
    };
    window.addEventListener('bsub:library-item', handler as EventListener);
    return () => window.removeEventListener('bsub:library-item', handler as EventListener);
  }, [fetchDetail]);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      // 让还在路上的请求作废，否则清空搜索框后旧结果会自己跳回来。
      searchSeq.current += 1;
      setResult(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const response = await window.bsub.searchLibrary(text);
      if (seq !== searchSeq.current) return;
      setSearching(false);
      if (response.ok) {
        setResult(response.data);
        setError(null);
      } else {
        setError(response.error);
      }
    }, 260);

    return () => window.clearTimeout(timer);
  }, [query, searchNonce]);

  const openDetail = (video: LibraryVideo) => {
    setSelectedId(video.id);
    setDetail(null);
    setLineLimit(LINE_PAGE);
    setDetailTab(video.summaryUpdatedAt ? 'summary' : 'subtitles');
    setPreview(null);
    setVersions([]);
    setVersionsOpen(false);
    void fetchDetail(video.id);
  };

  const backToList = () => {
    detailSeq.current += 1;
    setSelectedId(null);
    setDetail(null);
    setDetailLoading(false);
    setPreview(null);
    setVersions([]);
    setVersionsOpen(false);
  };

  const openInBrowser = (video: LibraryVideo, start?: number) => {
    if (!video.url) return;
    void window.bsub.openUrl(video.url, start);
  };

  const previewVersion = async (version: SummaryVersionMeta) => {
    const response = await window.bsub.getSummaryVersion(version.id);
    if (response.ok && response.data) {
      setPreview(response.data);
      setDetailTab('summary');
    } else if (!response.ok) {
      setError(response.error);
    }
  };

  const restoreVersion = async (versionId: number) => {
    setBusyVersion(versionId);
    try {
      const response = await window.bsub.restoreSummaryVersion(versionId);
      if (response.ok) {
        setPreview(null);
        if (selectedId != null) await fetchDetail(selectedId);
      } else {
        setError(response.error);
      }
    } finally {
      setBusyVersion(0);
    }
  };

  const confirmDelete = async () => {
    const video = pendingDelete;
    setPendingDelete(null);
    if (!video) return;
    const response = await window.bsub.removeLibrary(video.id);
    if (response.ok) {
      if (selectedId === video.id) backToList();
      void load();
    } else {
      setError(response.error);
    }
  };

  const stats = list?.stats;
  const activeVideo = detail?.video ?? list?.videos.find((video) => video.id === selectedId) ?? null;

  if (selectedId != null) {
    return (
      <div className="panel">
        <div className="panel-toolbar">
          <button className="icon-btn" title="返回库" onClick={backToList}>
            <ChevronLeft size={15} />
          </button>
          <div className="panel-title lib-detail-title" title={activeVideo?.title || ''}>
            {activeVideo?.title || '库条目'}
          </div>
          <div className="toolbar-actions">
            {detail?.bundle && (
              <ExportMenu
                info={detail.bundle.info}
                track={detail.bundle.track}
                lines={detail.bundle.lines}
                summary={detail.summary?.content}
              />
            )}
            <button
              className="icon-btn"
              title="在网页打开"
              disabled={!activeVideo?.url}
              onClick={() => activeVideo && openInBrowser(activeVideo)}
            >
              <ExternalLink size={13} />
            </button>
            <button
              className="icon-btn"
              title="从库中删除"
              onClick={() => activeVideo && setPendingDelete(activeVideo)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {activeVideo && (
          <div className="lib-detail-meta">
            {activeVideo.owner || '未知 UP'} · {fmtTime(activeVideo.duration)} ·{' '}
            {activeVideo.lineCount.toLocaleString('zh-CN')} 行
            {detail?.summary ? ` · 总结于 ${fmtDate(detail.summary.updatedAt)}` : ' · 未总结'}
          </div>
        )}

        <div className="lib-tabs">
          <button
            className={`mini-btn${detailTab === 'subtitles' ? ' is-active' : ''}`}
            onClick={() => setDetailTab('subtitles')}
            disabled={!detail?.bundle}
          >
            字幕 {detail?.bundle ? detail.bundle.lines.length.toLocaleString('zh-CN') : ''}
          </button>
          <button
            className={`mini-btn${detailTab === 'summary' ? ' is-active' : ''}`}
            onClick={() => setDetailTab('summary')}
          >
            总结{detail?.summary ? '' : ' —'}
          </button>
        </div>

        {error && <div className="status-line error">{error}</div>}

        {detailLoading && !detail && (
          <div className="status-line">
            <Loader2 size={13} className="spin" />
            读取中…
          </div>
        )}

        {detailTab === 'subtitles' && detail?.bundle && (
          <div className="lib-lines">
            {detail.bundle.lines.slice(0, lineLimit).map((line, index) => (
              <button
                key={`${line.start}-${index}`}
                className="lib-line"
                title={`在网页跳到 ${fmtTime(line.start)}`}
                onClick={() => openInBrowser(detail.video, line.start)}
              >
                <span className="lib-line-time">{fmtTime(line.start)}</span>
                <span className="lib-line-text">{line.text}</span>
              </button>
            ))}
            {detail.bundle.lines.length > lineLimit && (
              <button
                className="mini-btn lib-more"
                onClick={() => setLineLimit((value) => value + LINE_PAGE)}
              >
                加载更多（还有{' '}
                {(detail.bundle.lines.length - lineLimit).toLocaleString('zh-CN')} 行）
              </button>
            )}
          </div>
        )}

        {detailTab === 'subtitles' && detail && !detail.bundle && (
          <div className="panel-empty">
            这条记录只有总结，没有入库字幕
            <div className="panel-hint">打开视频后，在「字幕」面板点「入库」即可离线阅读。</div>
          </div>
        )}

        {detailTab === 'summary' && detail?.summary && (
          <div className="lib-summary">
            {preview && (
              <div className="version-banner">
                <span>
                  预览版本 · {fmtDateTime(preview.createdAt)} · {preview.model || 'AI'}
                </span>
                <div className="version-banner-actions">
                  <button
                    className="mini-btn"
                    disabled={busyVersion === preview.id}
                    onClick={() => void restoreVersion(preview.id)}
                  >
                    恢复此版本
                  </button>
                  <button className="mini-btn" onClick={() => setPreview(null)}>
                    退出预览
                  </button>
                </div>
              </div>
            )}
            <Markdown content={preview ? preview.content : detail.summary.content} />

            {versions.length > 0 && (
              <div className="version-block">
                <button
                  className="version-toggle"
                  onClick={() => setVersionsOpen((value) => !value)}
                >
                  历史版本 {versions.length} · {versionsOpen ? '收起' : '展开'}
                </button>
                {versionsOpen && (
                  <div className="version-list">
                    {versions.map((version) => (
                      <div
                        key={version.id}
                        className={`version-row${preview?.id === version.id ? ' is-active' : ''}`}
                      >
                        <span className="version-time">{fmtDateTime(version.createdAt)}</span>
                        <span className="version-model">{version.model || 'AI'}</span>
                        <span className="version-chars">{version.chars} 字</span>
                        <button
                          className="mini-btn"
                          onClick={() => void previewVersion(version)}
                        >
                          预览
                        </button>
                        <button
                          className="mini-btn"
                          disabled={busyVersion === version.id}
                          onClick={() => void restoreVersion(version.id)}
                        >
                          恢复
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {detailTab === 'summary' && detail && !detail.summary && (
          <div className="panel-empty">
            还没有总结
            <div className="panel-hint">
              打开视频后在「总结」面板生成，会自动保存到这里，之后可以离线查看。
            </div>
          </div>
        )}

        <ConfirmDialog
          open={Boolean(pendingDelete)}
          title="从库中删除？"
          description={
            pendingDelete
              ? `「${pendingDelete.title}」的字幕、总结和搜索索引会一起删除，无法撤销。`
              : undefined
          }
          confirmText="删除"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div className="panel-title">库</div>
        <div className="toolbar-actions">
          <select
            className="mini-select"
            title="排序"
            value={sort}
            onChange={(event) => setSort(event.target.value as LibrarySort)}
          >
            {SORTS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <button className="icon-btn" title="刷新" onClick={() => void load()}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <div className="library-search">
        <Search size={13} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索标题、UP 或字幕…"
          spellCheck={false}
        />
      </div>

      {stats && (
        <div className="library-stats">
          <span>{stats.videos} 个视频</span>
          <span>{stats.segments.toLocaleString('zh-CN')} 行</span>
          <span>{fmtBytes(stats.bytes)}</span>
        </div>
      )}

      {error && <div className="status-line error">{error}</div>}
      {loading && !list && (
        <div className="status-line">
          <Loader2 size={13} className="spin" />
          读取中…
        </div>
      )}

      {result && (
        <div className="lib-results">
          <div className="lib-result-head">
            字幕 {result.total} 条 · {result.mode === 'fts' ? '全文' : '模糊'}
            {result.videos.length > 0 && ` · 视频 ${result.videos.length} 个`}
            {searching && ' · 搜索中…'}
          </div>

          {result.videos.length > 0 && (
            <>
              <div className="lib-group-head">相关视频</div>
              {result.videos.map((video) => (
                <div
                  key={`v-${video.id}`}
                  className="lib-video"
                  role="button"
                  tabIndex={0}
                  onClick={() => openDetail(video)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') openDetail(video);
                  }}
                >
                  {video.cover ? (
                    <img className="lib-cover" src={video.cover} alt="" />
                  ) : (
                    <div className="lib-cover lib-cover-fallback">
                      {video.title.slice(0, 1) || 'B'}
                    </div>
                  )}
                  <div className="lib-meta">
                    <div className="lib-title-row">
                      <span className="lib-title" title={video.title}>
                        {video.title}
                      </span>
                      {video.summaryUpdatedAt != null && (
                        <span className="lib-badge">已总结</span>
                      )}
                    </div>
                    <div className="lib-sub">
                      {video.owner || '未知 UP'} · {fmtTime(video.duration)} ·{' '}
                      {video.lineCount.toLocaleString('zh-CN')} 行
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          {result.matches.length > 0 && (
            <div className="lib-group-head">字幕命中</div>
          )}
          {result.matches.map((match, index) => (
            <button
              key={`${match.videoId}-${match.start}-${index}`}
              className="lib-result"
              onClick={() => {
                const url =
                  match.url ||
                  (match.bvid ? `https://www.bilibili.com/video/${match.bvid}` : '');
                if (url) void window.bsub.openUrl(url, match.start);
              }}
            >
              <span className="lib-result-time">{fmtTime(match.start)}</span>
              <span className="lib-result-body">
                <span className="lib-result-text">{match.text}</span>
                <span className="lib-result-meta">{match.title}</span>
              </span>
            </button>
          ))}

          {!result.videos.length && !result.matches.length && (
            <div className="panel-empty">
              没有找到匹配的视频或字幕
              <div className="panel-hint">标题、UP 名和字幕正文都会参与搜索。</div>
            </div>
          )}
        </div>
      )}

      {!result && list && (
        <div className="lib-videos">
          {list.videos.map((video) => (
            <div
              key={video.id}
              className="lib-video"
              role="button"
              tabIndex={0}
              onClick={() => openDetail(video)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') openDetail(video);
              }}
            >
              {video.cover ? (
                <img className="lib-cover" src={video.cover} alt="" />
              ) : (
                <div className="lib-cover lib-cover-fallback">
                  {video.title.slice(0, 1) || 'B'}
                </div>
              )}
              <div className="lib-meta">
                <div className="lib-title-row">
                  <span className="lib-title" title={video.title}>
                    {video.title}
                  </span>
                  {video.summaryUpdatedAt != null && <span className="lib-badge">已总结</span>}
                </div>
                <div className="lib-sub">
                  {video.owner || '未知 UP'} · {fmtTime(video.duration)} ·{' '}
                  {video.lineCount.toLocaleString('zh-CN')} 行
                </div>
                <div className="lib-sub faint">
                  {video.summaryUpdatedAt != null
                    ? `总结于 ${fmtDate(video.summaryUpdatedAt)}`
                    : `入库于 ${fmtDate(video.createdAt)}`}
                </div>
              </div>
              <button
                className="lib-delete"
                title="从库中删除"
                onClick={(event) => {
                  event.stopPropagation();
                  setPendingDelete(video);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}

          {!list.videos.length && (
            <div className="panel-empty">
              还没有入库的视频
              <div className="panel-hint">打开视频后，在「字幕」面板点「入库」。</div>
            </div>
          )}

          {list.total > list.videos.length && (
            <div className="panel-hint">
              仅显示最近 {list.videos.length} 条，共 {list.total} 条；搜索可以找到全部内容。
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="从库中删除？"
        description={
          pendingDelete
            ? `「${pendingDelete.title}」的字幕、总结和搜索索引会一起删除，无法撤销。`
            : undefined
        }
        confirmText="删除"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
