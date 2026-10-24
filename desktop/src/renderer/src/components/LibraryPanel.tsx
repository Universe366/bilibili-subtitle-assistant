import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type {
  CollectionResolveResult,
  CollectionSummary,
  CollectionSummaryVersion,
  CollectionSummaryVersionMeta,
  LibraryCollection,
  LibraryDetail,
  LibraryList,
  LibrarySearchResult,
  LibrarySort,
  LibraryTag,
  LibraryVideo,
  NoteVersionMeta,
  SummaryVersion,
  SummaryVersionMeta,
  TrashItem
} from '../../../shared/types';
import { formatBytes, formatDateTime, formatDuration } from '../lib/format';
import { LINE_PAGE, metaLine, safeFilename } from '../lib/libraryView';
import { ConfirmDialog } from './ConfirmDialog';
import { LibraryBulkBar } from './LibraryBulkBar';
import { LibraryBulkCollectionDialog } from './LibraryBulkCollectionDialog';
import { LibraryCollectionSummaryDialog } from './LibraryCollectionSummaryDialog';
import { LibraryImportDialog } from './LibraryImportDialog';
import { LibraryManageDialog } from './LibraryManageDialog';
import { LibraryDetailView } from './LibraryDetailView';
import { LibraryEmptyState } from './LibraryEmptyState';
import { LibraryListHeader } from './LibraryListHeader';
import { LibraryFilters } from './LibraryFilters';
import { LibraryTrashDialog } from './LibraryTrashDialog';
import { LibraryVideoRow } from './LibraryVideoRow';
import { PodcastImport } from './PodcastImport';
import { diffLines, type DiffOp } from '../lib/diff';

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
  const [detailTab, setDetailTab] = useState<'subtitles' | 'summary' | 'note'>('subtitles');
  const [noteDraft, setNoteDraft] = useState('');
  const [noteDirty, setNoteDirty] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteNotice, setNoteNotice] = useState('');
  const [notePreview, setNotePreview] = useState(false);
  const [noteVersions, setNoteVersions] = useState<NoteVersionMeta[]>([]);
  const [noteVersionsOpen, setNoteVersionsOpen] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [lineLimit, setLineLimit] = useState(LINE_PAGE);
  const [pendingDelete, setPendingDelete] = useState<LibraryVideo | null>(null);
  const [versions, setVersions] = useState<SummaryVersionMeta[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [preview, setPreview] = useState<SummaryVersion | null>(null);
  const [diff, setDiff] = useState<DiffOp[] | null>(null);
  const [busyVersion, setBusyVersion] = useState(0);
  const [allTags, setAllTags] = useState<LibraryTag[]>([]);
  const [tagFilter, setTagFilter] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [allCollections, setAllCollections] = useState<LibraryCollection[]>([]);
  const [collectionFilter, setCollectionFilter] = useState('');
  const [collectionDraft, setCollectionDraft] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [renameId, setRenameId] = useState(0);
  const [renameDraft, setRenameDraft] = useState('');
  const [pendingCollectionDelete, setPendingCollectionDelete] =
    useState<LibraryCollection | null>(null);
  const [tagRenameName, setTagRenameName] = useState('');
  const [tagRenameDraft, setTagRenameDraft] = useState('');
  const [pendingTagDelete, setPendingTagDelete] = useState<LibraryTag | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [quickLink, setQuickLink] = useState('');
  const [podcastOpen, setPodcastOpen] = useState(false);
  const [importSummary, setImportSummary] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<CollectionResolveResult | null>(null);
  const [resolveNotice, setResolveNotice] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // 列表窗口化：库最多展示 500 条，一次全渲染会拖慢滚动，先渲染 80 条再按需追加。
  const [renderCount, setRenderCount] = useState(80);
  const [cursorId, setCursorId] = useState<number | null>(null);
  const lastSelectedRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [bulkKind, setBulkKind] = useState<'tag' | 'collection'>('tag');
  const [bulkName, setBulkName] = useState('');
  const [bulkInputOpen, setBulkInputOpen] = useState(false);
  const [bulkCollectionOpen, setBulkCollectionOpen] = useState(false);
  const [bulkCollectionName, setBulkCollectionName] = useState('');
  const [bulkConcurrency, setBulkConcurrency] = useState(2);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [notice, setNotice] = useState('');
  const [summaryCollection, setSummaryCollection] = useState<LibraryCollection | null>(null);
  const [collectionSummary, setCollectionSummary] = useState<CollectionSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [collectionVersions, setCollectionVersions] = useState<
    CollectionSummaryVersionMeta[]
  >([]);
  const [collectionVersionsOpen, setCollectionVersionsOpen] = useState(false);
  const [collectionPreview, setCollectionPreview] =
    useState<CollectionSummaryVersion | null>(null);

  const [trashOpen, setTrashOpen] = useState(false);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashBusy, setTrashBusy] = useState(0);

  const searchSeq = useRef(0);
  const detailSeq = useRef(0);
  const noteDraftRef = useRef('');

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

  const loadTags = useCallback(async () => {
    const response = await window.bsub.listTags();
    if (response.ok) setAllTags(response.data);
  }, []);

  const loadCollections = useCallback(async () => {
    const response = await window.bsub.listCollections();
    if (response.ok) setAllCollections(response.data);
  }, []);

  const loadVersions = useCallback(async (videoId: number) => {
    const response = await window.bsub.getSummaryVersions(videoId);
    if (response.ok) setVersions(response.data);
  }, []);

  const loadNoteVersions = useCallback(async (videoId: number) => {
    const response = await window.bsub.getNoteVersions(videoId);
    if (response.ok) setNoteVersions(response.data);
  }, []);

  const loadCollectionVersions = useCallback(async (collectionId: number) => {
    const response = await window.bsub.getCollectionSummaryVersions(collectionId);
    if (response.ok) setCollectionVersions(response.data);
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
        void loadNoteVersions(id);
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
  }, [loadVersions, loadNoteVersions]);

  useEffect(() => {
    void load();
    void loadTags();
    void loadCollections();
  }, [load, loadTags, loadCollections]);

  useEffect(() => {
    if (tagFilter && !allTags.some((tag) => tag.name === tagFilter)) setTagFilter('');
  }, [allTags, tagFilter]);

  useEffect(() => {
    if (collectionFilter && !allCollections.some((item) => item.name === collectionFilter)) {
      setCollectionFilter('');
    }
  }, [allCollections, collectionFilter]);

  useEffect(() => {
    return window.bsub.onLibraryChanged(() => {
      void load();
      void loadTags();
      void loadCollections();
      if (selectedId != null) void fetchDetail(selectedId);
      setSearchNonce((value) => value + 1);
    });
  }, [load, loadTags, loadCollections, selectedId, fetchDetail]);

  // 切换条目时重置笔记草稿；同一条目内保存/刷新不覆盖未保存内容。
  useEffect(() => {
    setNoteDraft(detail?.note?.content ?? '');
    setNoteDirty(false);
    setNoteNotice('');
    setNotePreview(false);
    setNoteVersions([]);
    setNoteVersionsOpen(false);
    setAutoSaving(false);
  }, [detail?.video.id]);

  useEffect(() => {
    noteDraftRef.current = noteDraft;
  }, [noteDraft]);

  // 停止输入 1.2 秒后自动保存非空笔记；清空仍需手动保存以免误删。
  useEffect(() => {
    if (!detail || !noteDirty) return;
    const text = noteDraft;
    if (!text.trim()) return;
    const timer = window.setTimeout(() => {
      void autoSaveNote(text);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [noteDraft, noteDirty, detail?.video.id]);

  useEffect(() => {
    const collectionId = summaryCollection?.id;
    if (!collectionId) return;
    const offDone = window.bsub.onCollectionSummaryDone((event) => {
      if (event.collectionId !== collectionId) return;
      setCollectionSummary(event.summary);
      setSummaryLoading(false);
      setCollectionPreview(null);
      void loadCollectionVersions(collectionId);
    });
    const offError = window.bsub.onCollectionSummaryError((event) => {
      if (event.collectionId !== collectionId) return;
      setSummaryError(event.error);
      setSummaryLoading(false);
    });
    return () => {
      offDone();
      offError();
    };
  }, [summaryCollection?.id, loadCollectionVersions]);

  // 记录面板的「在库中查看」：切到库之后由这套监听打开对应条目。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const id = Number(typeof detail === 'number' ? detail : detail?.videoId);
      if (!Number.isFinite(id) || id <= 0) return;
      const tab = typeof detail === 'object' && detail?.tab === 'summary' ? 'summary' : 'subtitles';
      setSelectedId(id);
      setDetail(null);
      setLineLimit(LINE_PAGE);
      setDetailTab(tab);
      setPreview(null);
      setDiff(null);
      setVersions([]);
      setVersionsOpen(false);
      void fetchDetail(id);
    };
    window.addEventListener('bsub:library-item', handler as EventListener);
    return () => window.removeEventListener('bsub:library-item', handler as EventListener);
  }, [fetchDetail]);

  // 全局搜索命中合集对比时，切到库之后打开对应合集的结果弹窗。
  useEffect(() => {
    const handler = async (event: Event) => {
      const id = Number((event as CustomEvent).detail);
      if (!Number.isFinite(id) || id <= 0) return;
      const response = await window.bsub.listCollections();
      if (!response.ok) return;
      setAllCollections(response.data);
      const collection = response.data.find((item) => item.id === id);
      if (!collection) return;
      setSummaryCollection(collection);
      setSummaryError('');
      setSummaryLoading(false);
      setCollectionSummary(null);
      const summary = await window.bsub.getCollectionSummary(id);
      if (summary.ok) setCollectionSummary(summary.data);
      else setSummaryError(summary.error);
    };
    window.addEventListener('bsub:collection-summary', handler as EventListener);
    return () =>
      window.removeEventListener('bsub:collection-summary', handler as EventListener);
  }, []);

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
    setDiff(null);
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
    setDiff(null);
    setVersions([]);
    setVersionsOpen(false);
  };

  const openInBrowser = (video: LibraryVideo, start?: number) => {
    if (!video.url) return;
    if (/^file:\/\//i.test(video.url)) {
      // 本地音视频没有网页可开，用系统默认播放器。
      void window.bsub.openLibrarySource(video.id);
      return;
    }
    void window.bsub.openUrl(video.url, start);
  };

  const previewVersion = async (version: SummaryVersionMeta) => {
    const response = await window.bsub.getSummaryVersion(version.id);
    if (response.ok && response.data) {
      setPreview(response.data);
      setDiff(null);
      setDetailTab('summary');
    } else if (!response.ok) {
      setError(response.error);
    }
  };

  const compareVersion = () => {
    if (!preview || !detail?.summary) return;
    setDiff(diffLines(preview.content, detail.summary.content));
  };

  const restoreVersion = async (versionId: number) => {
    setBusyVersion(versionId);
    try {
      const response = await window.bsub.restoreSummaryVersion(versionId);
      if (response.ok) {
        setPreview(null);
        setDiff(null);
        if (selectedId != null) await fetchDetail(selectedId);
      } else {
        setError(response.error);
      }
    } finally {
      setBusyVersion(0);
    }
  };

  const saveTags = async (next: string[]) => {
    if (!detail) return;
    const response = await window.bsub.setLibraryTags(detail.video.id, next);
    if (response.ok) {
      setDetail((previous) =>
        previous
          ? { ...previous, video: { ...previous.video, tags: response.data.tags } }
          : previous
      );
      setTagDraft('');
    } else {
      setError(response.error);
    }
  };

  const addTag = () => {
    const name = tagDraft.trim();
    if (!name || !detail) return;
    if (detail.video.tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) {
      setTagDraft('');
      return;
    }
    void saveTags([...detail.video.tags, name]);
  };

  const removeTag = (name: string) => {
    if (!detail) return;
    void saveTags(detail.video.tags.filter((tag) => tag !== name));
  };

  const saveNoteDraft = async () => {
    if (!detail) return;
    setNoteSaving(true);
    try {
      const response = await window.bsub.saveNote(detail.video.id, noteDraft);
      if (response.ok) {
        setDetail((previous) => (previous ? { ...previous, note: response.data } : previous));
        setNoteDirty(false);
        void loadNoteVersions(detail.video.id);
        const text = response.data ? '笔记已保存' : '空笔记已清除';
        setNoteNotice(text);
        window.setTimeout(() => setNoteNotice(''), 3000);
      } else {
        setError(response.error);
      }
    } finally {
      setNoteSaving(false);
    }
  };

  const autoSaveNote = async (text: string) => {
    if (!detail) return;
    setAutoSaving(true);
    try {
      const response = await window.bsub.saveNote(detail.video.id, text);
      if (response.ok) {
        setDetail((previous) => (previous ? { ...previous, note: response.data } : previous));
        if (noteDraftRef.current === text) setNoteDirty(false);
        void loadNoteVersions(detail.video.id);
      }
    } finally {
      setAutoSaving(false);
    }
  };

  const loadNoteVersion = async (version: NoteVersionMeta) => {
    const response = await window.bsub.getNoteVersion(version.id);
    if (response.ok && response.data) {
      setNoteDraft(response.data.content);
      setNoteDirty(true);
      setNotePreview(false);
      setNoteNotice('已载入历史版本，保存后生效');
      window.setTimeout(() => setNoteNotice(''), 3000);
    } else if (!response.ok) {
      setError(response.error);
    }
  };

  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(''), 3500);
  };

  const refreshTrash = async () => {
    setTrashLoading(true);
    const response = await window.bsub.listTrash();
    setTrashLoading(false);
    if (response.ok) {
      setTrashItems(response.data);
    } else {
      setError(response.error);
    }
  };

  const openTrash = () => {
    setTrashOpen(true);
    void refreshTrash();
  };

  const restoreFromTrash = async (item: TrashItem) => {
    setTrashBusy(item.id);
    const response = await window.bsub.restoreTrash(item.id);
    setTrashBusy(0);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    await load();
    await refreshTrash();
    flash(`已恢复「${item.title || '未命名视频'}」`);
  };

  const purgeTrashItem = async (item: TrashItem) => {
    if (!window.confirm(`彻底删除「${item.title || '未命名视频'}」？此操作不可恢复。`)) return;
    setTrashBusy(item.id);
    const response = await window.bsub.deleteTrash(item.id);
    setTrashBusy(0);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    await refreshTrash();
  };

  const clearAllTrash = async () => {
    if (!trashItems.length) return;
    if (!window.confirm(`清空回收站里的 ${trashItems.length} 个条目？此操作不可恢复。`)) return;
    const response = await window.bsub.clearTrash();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    await refreshTrash();
    flash('回收站已清空');
  };

  const exportNote = async () => {
    if (!detail || !noteDraft.trim()) return;
    const content = [
      `# ${detail.video.title || '未命名视频'} · 笔记`,
      '',
      `> ${detail.video.owner || '未知 UP'} · ${formatDateTime(Date.now())}`,
      '',
      noteDraft.trim(),
      ''
    ].join('\n');
    const response = await window.bsub.saveTextFile({
      content,
      filename: `笔记-${safeFilename(detail.video.title)}.md`
    });
    if (!response.ok) {
      setError(response.error);
    } else if ('path' in response.data) {
      flash(`已导出 ${response.data.path.split(/[\\/]/).pop()}`);
    }
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkName('');
    setBulkInputOpen(false);
    setBulkDeleteOpen(false);
  };

  const openBulkInput = (kind: 'tag' | 'collection') => {
    setBulkKind(kind);
    setBulkName('');
    setBulkInputOpen(true);
  };

  const startBulkSummary = async () => {
    if (!selectedIds.size) return;
    const ids = [...selectedIds];
    const response = await window.bsub.batchSummarize(ids, bulkConcurrency);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    exitSelect();
    flash(`已开始批量总结 ${ids.length} 个视频，进度见底部任务按钮`);
  };

  const createStandaloneCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    const response = await window.bsub.createCollection(name);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    await loadCollections();
    setFiltersOpen(true);
    setNewCollectionOpen(false);
    setNewCollectionName('');
    flash(`已创建合集「${response.data.name}」，在「选择」模式里可以把视频加进来`);
  };

  const addSelectedToCollection = async (name: string) => {
    const clean = name.trim();
    if (!clean || !selectedIds.size) return;
    const ids = [...selectedIds];
    const response = await window.bsub.bulkCollection(ids, clean);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    await loadCollections();
    setBulkCollectionOpen(false);
    setBulkCollectionName('');
    flash(`已把 ${response.data.linked} 个视频加入合集「${clean}」`);
  };

  const startImportLinks = async () => {
    if (!importText.trim()) return;
    const response = await window.bsub.batchUrls([importText], importSummary);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setImportOpen(false);
    setImportText('');
    setResolved(null);
    flash('已开始抓取链接，进度见底部任务按钮');
  };

  const importLocalMedia = async () => {
    const response = await window.bsub.importLocalMedia();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (response.data.canceled) return;
    setImportOpen(false);
    setImportText('');
    setResolved(null);
    flash(`已开始识别「${response.data.filename || '本地文件'}」，进度见底部任务按钮`);
  };

  const resolveImportLinks = async () => {
    const first = importText.trim().split(/\r?\n/)[0];
    if (!first) return;
    setResolving(true);
    setResolveNotice('');
    setResolved(null);
    try {
      const response = await window.bsub.resolveCollection(first);
      if (!response.ok) {
        setResolveNotice(`识别失败：${response.error}`);
        return;
      }
      if (response.data.total <= 1) {
        setResolveNotice('这个链接不是合集或多 P 视频，直接点「开始」导入即可');
        return;
      }
      setResolved(response.data);
      setResolveNotice('');
    } finally {
      setResolving(false);
    }
  };

  const importResolved = async () => {
    if (!resolved) return;
    const urls = resolved.items.map((item) => item.url).join('\n');
    const response = await window.bsub.batchUrls([urls], importSummary);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    flash(`已开始导入《${resolved.title}》共 ${resolved.total} 个，进度见底部任务按钮`);
    setImportOpen(false);
    setImportText('');
    setResolved(null);
  };

  const toggleSelect = (id: number, shift = false) => {
    const last = lastSelectedRef.current;
    const from = last == null ? -1 : visibleVideos.findIndex((video) => video.id === last);
    const to = visibleVideos.findIndex((video) => video.id === id);
    if (shift && from >= 0 && to >= 0 && from !== to) {
      const [start, end] = from < to ? [from, to] : [to, from];
      setSelectedIds((previous) => {
        const next = new Set(previous);
        for (const video of visibleVideos.slice(start, end + 1)) next.add(video.id);
        return next;
      });
      lastSelectedRef.current = id;
      setCursorId(id);
      return;
    }
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastSelectedRef.current = id;
    setCursorId(id);
  };

  const applyBulk = async () => {
    const name = bulkName.trim();
    if (!name || !selectedIds.size) return;
    const ids = [...selectedIds];
    const response =
      bulkKind === 'tag'
        ? await window.bsub.bulkTag(ids, name)
        : await window.bsub.bulkCollection(ids, name);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    const label = bulkKind === 'tag' ? '标签' : '合集';
    flash(`已为 ${response.data.linked} 个条目添加${label}「${name}」`);
    setBulkName('');
    setBulkInputOpen(false);
    await loadTags();
    await loadCollections();
  };

  const confirmBulkDelete = async () => {
    setBulkDeleteOpen(false);
    const ids = [...selectedIds];
    if (!ids.length) return;
    const response = await window.bsub.bulkRemove(ids);
    if (response.ok) {
      flash(`已删除 ${response.data.removed} 个条目`);
      exitSelect();
    } else {
      setError(response.error);
    }
  };

  const addToCollection = async (name: string) => {
    const clean = name.trim();
    if (!clean || !detail) return;
    const response = await window.bsub.addToCollection(detail.video.id, clean);
    if (response.ok) {
      setDetail((previous) =>
        previous
          ? {
              ...previous,
              video: { ...previous.video, collections: response.data.collections }
            }
          : previous
      );
      setCollectionDraft('');
      void loadCollections();
    } else {
      setError(response.error);
    }
  };

  const removeFromCollection = async (name: string) => {
    if (!detail) return;
    const response = await window.bsub.removeFromCollection(detail.video.id, name);
    if (response.ok) {
      setDetail((previous) =>
        previous
          ? {
              ...previous,
              video: { ...previous.video, collections: response.data.collections }
            }
          : previous
      );
      void loadCollections();
    } else {
      setError(response.error);
    }
  };

  const saveRename = async (collection: LibraryCollection) => {
    const name = renameDraft.trim();
    if (!name) return;
    const response = await window.bsub.renameCollection(collection.id, name);
    if (response.ok) {
      setRenameId(0);
      await loadCollections();
      if (selectedId != null) void fetchDetail(selectedId);
    } else {
      setError(response.error);
    }
  };

  const confirmCollectionDelete = async () => {
    const target = pendingCollectionDelete;
    setPendingCollectionDelete(null);
    if (!target) return;
    const response = await window.bsub.deleteCollection(target.id);
    if (response.ok) {
      if (collectionFilter === target.name) setCollectionFilter('');
      await loadCollections();
      if (selectedId != null) void fetchDetail(selectedId);
    } else {
      setError(response.error);
    }
  };

  const openCollectionSummary = async (collection: LibraryCollection) => {
    setSummaryCollection(collection);
    setSummaryError('');
    setSummaryLoading(false);
    setCollectionSummary(null);
    setCollectionVersions([]);
    setCollectionVersionsOpen(false);
    setCollectionPreview(null);
    const response = await window.bsub.getCollectionSummary(collection.id);
    if (response.ok) setCollectionSummary(response.data);
    else setSummaryError(response.error);
    void loadCollectionVersions(collection.id);
  };

  const generateCollectionSummary = async () => {
    if (!summaryCollection) return;
    setSummaryLoading(true);
    setSummaryError('');
    const response = await window.bsub.summarizeCollection(summaryCollection.id);
    if (!response.ok) {
      setSummaryError(response.error);
      setSummaryLoading(false);
    }
  };

  const exportCollectionSummary = async () => {
    if (!summaryCollection || !collectionSummary) return;
    const content = [
      `# 合集对比 · ${summaryCollection.name}`,
      '',
      `> ${collectionSummary.itemCount} 个视频 · 模型 ${collectionSummary.model || 'AI'} · ${formatDateTime(
        collectionSummary.updatedAt
      )}`,
      '',
      collectionSummary.content.trim(),
      ''
    ].join('\n');
    const response = await window.bsub.saveTextFile({
      content,
      filename: `合集对比-${safeFilename(summaryCollection.name)}.md`
    });
    if (!response.ok) setSummaryError(response.error);
    else if ('path' in response.data) {
      flash(`已导出 ${response.data.path.split(/[\\/]/).pop()}`);
    }
  };

  const previewCollectionVersion = async (version: CollectionSummaryVersionMeta) => {
    const response = await window.bsub.getCollectionSummaryVersion(version.id);
    if (response.ok && response.data) setCollectionPreview(response.data);
    else if (!response.ok) setSummaryError(response.error);
  };

  const restoreCollectionVersion = async (versionId: number) => {
    const response = await window.bsub.restoreCollectionSummaryVersion(versionId);
    if (response.ok) {
      setCollectionSummary(response.data);
      setCollectionPreview(null);
      if (summaryCollection) void loadCollectionVersions(summaryCollection.id);
    } else {
      setSummaryError(response.error);
    }
  };

  const saveTagRename = async (tag: LibraryTag) => {
    const name = tagRenameDraft.trim();
    if (!name) return;
    const response = await window.bsub.renameTag(tag.name, name);
    if (response.ok) {
      setTagRenameName('');
      await loadTags();
      if (selectedId != null) void fetchDetail(selectedId);
    } else {
      setError(response.error);
    }
  };

  const confirmTagDelete = async () => {
    const target = pendingTagDelete;
    setPendingTagDelete(null);
    if (!target) return;
    const response = await window.bsub.deleteTag(target.name);
    if (response.ok) {
      if (tagFilter === target.name) setTagFilter('');
      await loadTags();
      if (selectedId != null) void fetchDetail(selectedId);
    } else {
      setError(response.error);
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

  useEffect(() => {
    setRenderCount(80);
  }, [list, query, tagFilter, collectionFilter, sort]);

  const stats = list?.stats;
  const activeVideo = detail?.video ?? list?.videos.find((video) => video.id === selectedId) ?? null;
  const visibleVideos = list
    ? list.videos.filter(
        (video) =>
          (!tagFilter || video.tags.includes(tagFilter)) &&
          (!collectionFilter || video.collections.includes(collectionFilter))
      )
    : [];

  if (selectedId != null) {
    return (
      <LibraryDetailView
        activeVideo={activeVideo}
        detail={detail}
        allTags={allTags}
        allCollections={allCollections}
        tagDraft={tagDraft}
        collectionDraft={collectionDraft}
        detailTab={detailTab}
        error={error}
        detailLoading={detailLoading}
        lineLimit={lineLimit}
        preview={preview}
        diff={diff}
        versions={versions}
        versionsOpen={versionsOpen}
        busyVersion={busyVersion}
        noteDraft={noteDraft}
        noteDirty={noteDirty}
        noteSaving={noteSaving}
        notePreview={notePreview}
        noteNotice={noteNotice}
        autoSaving={autoSaving}
        noteVersions={noteVersions}
        noteVersionsOpen={noteVersionsOpen}
        pendingDelete={pendingDelete}
        linePage={LINE_PAGE}
        setTagDraft={setTagDraft}
        setCollectionDraft={setCollectionDraft}
        setDetailTab={setDetailTab}
        setLineLimit={setLineLimit}
        setPreview={setPreview}
        setDiff={setDiff}
        setVersionsOpen={setVersionsOpen}
        setNoteDraft={setNoteDraft}
        setNoteDirty={setNoteDirty}
        setNotePreview={setNotePreview}
        setNoteVersionsOpen={setNoteVersionsOpen}
        setPendingDelete={setPendingDelete}
        addTag={addTag}
        removeTag={removeTag}
        backToList={backToList}
        openInBrowser={openInBrowser}
        addToCollection={addToCollection}
        removeFromCollection={removeFromCollection}
        compareVersion={compareVersion}
        previewVersion={previewVersion}
        restoreVersion={restoreVersion}
        exportNote={exportNote}
        saveNoteDraft={saveNoteDraft}
        loadNoteVersion={loadNoteVersion}
        confirmDelete={confirmDelete}
      />
    );
  }

  return (
    <div className="panel">
      <LibraryListHeader
        query={query}
        onQuery={setQuery}
        filtersOpen={filtersOpen}
        filterActive={Boolean(tagFilter || collectionFilter)}
        selectMode={selectMode}
        canSelect={Boolean(list?.videos.length)}
        loading={loading}
        onToggleFilters={() => setFiltersOpen((value) => !value)}
        onNewCollection={() => setNewCollectionOpen(true)}
        onImport={() => setImportOpen(true)}
        onOpenTrash={openTrash}
        onToggleSelect={() => {
          if (selectMode) exitSelect();
          else {
            setSelectMode(true);
            setSelectedIds(new Set());
          }
        }}
        onRefresh={() => void load()}
      />

      <LibraryFilters
        open={filtersOpen}
        sort={sort}
        onSort={setSort}
        tags={allTags}
        tagFilter={tagFilter}
        onTagFilter={setTagFilter}
        collections={allCollections}
        collectionFilter={collectionFilter}
        onCollectionFilter={setCollectionFilter}
        onManage={() => setManageOpen(true)}
      />

      {selectMode && (
        <LibraryBulkBar
          count={selectedIds.size}
          visibleCount={visibleVideos.length}
          concurrency={bulkConcurrency}
          inputOpen={bulkInputOpen}
          inputValue={bulkName}
          inputKind={bulkKind}
          onConcurrency={setBulkConcurrency}
          onSelectAll={() => setSelectedIds(new Set(visibleVideos.map((video) => video.id)))}
          onSummarize={() => void startBulkSummary()}
          onAddTag={() => openBulkInput('tag')}
          onAddCollection={() => setBulkCollectionOpen(true)}
          onDelete={() => setBulkDeleteOpen(true)}
          onCancel={exitSelect}
          onInput={setBulkName}
          onApply={() => void applyBulk()}
          onCloseInput={() => setBulkInputOpen(false)}
        />
      )}

      {notice && <div className="status-line">{notice}</div>}

      {stats && (
        <div className="library-stats">
          <span>{stats.videos} 个视频</span>
          <span>{stats.segments.toLocaleString('zh-CN')} 行</span>
          <span>{formatBytes(stats.bytes)}</span>
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
                    <div className="lib-sub">{metaLine(video)}</div>
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
              <span className="lib-result-time">{formatDuration(match.start)}</span>
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
        <div
          className="lib-videos"
          ref={listRef}
          tabIndex={0}
          onKeyDown={(event) => {
            if (!visibleVideos.length) return;
            const index = visibleVideos.findIndex((video) => video.id === cursorId);
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setCursorId(visibleVideos[Math.min(visibleVideos.length - 1, index + 1)].id);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setCursorId(visibleVideos[Math.max(0, index - 1)].id);
            } else if (event.key === 'Enter') {
              const target = visibleVideos.find((video) => video.id === cursorId);
              if (target) openDetail(target);
            } else if (event.key === ' ' && cursorId != null) {
              event.preventDefault();
              setSelectMode(true);
              toggleSelect(cursorId, false);
            }
          }}
          onScroll={() => {
            const node = listRef.current;
            if (!node) return;
            if (node.scrollTop + node.clientHeight >= node.scrollHeight - 160) {
              setRenderCount((count) => Math.min(visibleVideos.length, count + 80));
            }
          }}
        >
          {visibleVideos.slice(0, renderCount).map((video) => (
            <LibraryVideoRow
              key={video.id}
              video={video}
              selectMode={selectMode}
              selected={selectedIds.has(video.id)}
              cursor={video.id === cursorId}
              onToggleSelect={toggleSelect}
              onOpen={openDetail}
              onDelete={(item) => setPendingDelete(item)}
            />
          ))}

          {visibleVideos.length > renderCount && (
            <div className="panel-hint">
              已显示 {renderCount} / {visibleVideos.length} 条，滚动到底部继续加载
            </div>
          )}

          {!list.videos.length && (
            <LibraryEmptyState
              quickLink={quickLink}
              onQuickLink={setQuickLink}
              onQuickImport={(text) => {
                setImportText(text);
                setImportSummary(true);
                setImportOpen(true);
              }}
              onOpenImport={() => setImportOpen(true)}
              onOpenBilibili={() => void window.bsub.newTab('https://www.bilibili.com/')}
            />
          )}

          {list.videos.length > 0 && !visibleVideos.length && (
            <div className="panel-empty">该标签下还没有视频</div>
          )}

          {list.total > list.videos.length && (
            <div className="panel-hint">
              仅显示最近 {list.videos.length} 条，共 {list.total} 条；搜索可以找到全部内容。
            </div>
          )}
        </div>
      )}

      <LibraryImportDialog
        open={importOpen}
        text={importText}
        summary={importSummary}
        resolving={resolving}
        resolved={resolved}
        notice={resolveNotice}
        onText={(value) => {
          setImportText(value);
          setResolved(null);
          setResolveNotice('');
        }}
        onSummary={setImportSummary}
        onResolve={() => void resolveImportLinks()}
        onImportResolved={() => void importResolved()}
        onStart={() => void startImportLinks()}
        onClose={() => setImportOpen(false)}
        onPodcast={() => {
          setImportOpen(false);
          setPodcastOpen(true);
        }}
        onLocalMedia={() => void importLocalMedia()}
      />

      {newCollectionOpen && (
        <div
          className="confirm-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setNewCollectionOpen(false);
          }}
        >
          <div className="confirm-card" role="dialog" aria-label="新建合集">
            <div className="confirm-title">新建合集</div>
            <div className="confirm-desc">
              先给合集起个名字；创建后在「选择」模式里勾视频，点「加合集」加入。
            </div>
            <input
              className="tag-input collection-name-input"
              autoFocus
              value={newCollectionName}
              placeholder="例如：课程、待看、项目资料"
              onChange={(event) => setNewCollectionName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void createStandaloneCollection();
                }
              }}
            />
            <div className="confirm-actions">
              <button className="mini-btn" onClick={() => setNewCollectionOpen(false)}>
                取消
              </button>
              <button
                className="mini-btn primary"
                disabled={!newCollectionName.trim()}
                onClick={() => void createStandaloneCollection()}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      <LibraryBulkCollectionDialog
        open={bulkCollectionOpen}
        count={selectedIds.size}
        collections={allCollections}
        name={bulkCollectionName}
        onName={setBulkCollectionName}
        onPick={(name) => void addSelectedToCollection(name)}
        onClose={() => setBulkCollectionOpen(false)}
      />

      <LibraryManageDialog
        open={manageOpen}
        tags={allTags}
        collections={allCollections}
        tagRenameName={tagRenameName}
        tagRenameDraft={tagRenameDraft}
        collectionRenameId={renameId}
        collectionRenameDraft={renameDraft}
        onTagRenameStart={(name) => {
          setTagRenameName(name);
          setTagRenameDraft(name);
        }}
        onTagRenameDraft={setTagRenameDraft}
        onTagRenameSave={(tag) => void saveTagRename(tag)}
        onTagRenameCancel={() => setTagRenameName('')}
        onTagDelete={(tag) => setPendingTagDelete(tag)}
        onCollectionRenameStart={(item) => {
          setRenameId(item.id);
          setRenameDraft(item.name);
        }}
        onCollectionRenameDraft={setRenameDraft}
        onCollectionRenameSave={(item) => void saveRename(item)}
        onCollectionRenameCancel={() => setRenameId(0)}
        onCollectionDelete={(item) => setPendingCollectionDelete(item)}
        onCollectionCompare={(item) => void openCollectionSummary(item)}
        onClose={() => setManageOpen(false)}
      />

      <LibraryCollectionSummaryDialog
        collection={summaryCollection}
        summary={collectionSummary}
        loading={summaryLoading}
        error={summaryError}
        preview={collectionPreview}
        versions={collectionVersions}
        versionsOpen={collectionVersionsOpen}
        onClose={() => setSummaryCollection(null)}
        onExitPreview={() => setCollectionPreview(null)}
        onRestoreVersion={(id) => void restoreCollectionVersion(id)}
        onPreviewVersion={(version) => void previewCollectionVersion(version)}
        onToggleVersions={() => setCollectionVersionsOpen((value) => !value)}
        onGenerate={() => void generateCollectionSummary()}
        onExport={() => void exportCollectionSummary()}
      />

      <PodcastImport open={podcastOpen} onClose={() => setPodcastOpen(false)} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="从库中删除？"
        description={
          pendingDelete
            ? `「${pendingDelete.title}」的字幕、总结和搜索索引会一起移入回收站，可在回收站恢复。`
            : undefined
        }
        confirmText="删除"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingCollectionDelete)}
        title="删除这个合集？"
        description={
          pendingCollectionDelete
            ? `「${pendingCollectionDelete.name}」会被删除，合集里的视频、字幕和总结都不受影响。`
            : undefined
        }
        confirmText="删除"
        onConfirm={() => void confirmCollectionDelete()}
        onCancel={() => setPendingCollectionDelete(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingTagDelete)}
        title="删除这个标签？"
        description={
          pendingTagDelete
            ? `「${pendingTagDelete.name}」会从所有视频上移除，视频、字幕和总结都不受影响。`
            : undefined
        }
        confirmText="删除"
        onConfirm={() => void confirmTagDelete()}
        onCancel={() => setPendingTagDelete(null)}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={`删除选中的 ${selectedIds.size} 个条目？`}
        description="这些条目的字幕、总结、标签/合集关联和搜索索引会一起移入回收站，可在回收站恢复。"
        confirmText="删除"
        onConfirm={() => void confirmBulkDelete()}
        onCancel={() => setBulkDeleteOpen(false)}
      />

      <LibraryTrashDialog
        open={trashOpen}
        loading={trashLoading}
        items={trashItems}
        busyId={trashBusy}
        onClose={() => setTrashOpen(false)}
        onRestore={(item) => void restoreFromTrash(item)}
        onPurge={(item) => void purgeTrashItem(item)}
        onClearAll={() => void clearAllTrash()}
      />
    </div>
  );
}
