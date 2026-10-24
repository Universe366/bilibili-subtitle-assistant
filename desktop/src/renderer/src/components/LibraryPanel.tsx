import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Search, Trash2 } from 'lucide-react';
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
import { LibraryDetailHeader } from './LibraryDetailHeader';
import { LibraryFilters } from './LibraryFilters';
import { LibrarySubtitlesTab } from './LibrarySubtitlesTab';
import { LibraryTabBar } from './LibraryTabBar';
import { LibraryVideoRow } from './LibraryVideoRow';
import { Markdown } from './Markdown';
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

  const toggleSelect = (id: number) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
      <div className="panel">
        <LibraryDetailHeader
          video={activeVideo}
          detail={detail}
          tags={allTags}
          tagDraft={tagDraft}
          onTagDraft={setTagDraft}
          onAddTag={addTag}
          onRemoveTag={removeTag}
          onBack={backToList}
          onOpen={openInBrowser}
          onDelete={setPendingDelete}
        />

        {detail && (
          <div className="tag-row collection-row">
            {detail.video.collections.map((name) => (
              <span key={name} className="tag-chip collection-chip">
                {name}
                <button title="移出合集" onClick={() => void removeFromCollection(name)}>
                  ×
                </button>
              </span>
            ))}
            <select
              className="mini-select collection-add-select"
              value=""
              onChange={(event) => {
                const name = event.target.value;
                if (name) void addToCollection(name);
              }}
            >
              <option value="">加入合集…</option>
              {allCollections
                .filter((item) => !detail.video.collections.includes(item.name))
                .map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}（{item.count}）
                  </option>
                ))}
            </select>
            <input
              className="tag-input"
              value={collectionDraft}
              placeholder="新建合集"
              onChange={(event) => setCollectionDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void addToCollection(collectionDraft);
                }
              }}
            />
          </div>
        )}

        <LibraryTabBar detail={detail} active={detailTab} onChange={setDetailTab} />


        {error && <div className="status-line error">{error}</div>}

        {detailLoading && !detail && (
          <div className="status-line">
            <Loader2 size={13} className="spin" />
            读取中…
          </div>
        )}

        {detailTab === 'subtitles' && (
          <LibrarySubtitlesTab
            bundle={detail?.bundle ?? null}
            hasDetail={Boolean(detail)}
            lineLimit={lineLimit}
            onLoadMore={() => setLineLimit((value) => value + LINE_PAGE)}
            onSeek={(seconds) => detail && openInBrowser(detail.video, seconds)}
          />
        )}


        {detailTab === 'summary' && detail?.summary && (
          <div className="lib-summary">
            {preview && (
              <div className="version-banner">
                <span>
                  {diff
                    ? `对比：${formatDateTime(preview.createdAt)} 版本 → 当前`
                    : `预览版本 · ${formatDateTime(preview.createdAt)} · ${preview.model || 'AI'}`}
                </span>
                <div className="version-banner-actions">
                  {diff ? (
                    <button className="mini-btn" onClick={() => setDiff(null)}>
                      退出对比
                    </button>
                  ) : (
                    <button className="mini-btn" onClick={compareVersion}>
                      与当前对比
                    </button>
                  )}
                  <button
                    className="mini-btn"
                    disabled={busyVersion === preview.id}
                    onClick={() => void restoreVersion(preview.id)}
                  >
                    恢复此版本
                  </button>
                  <button
                    className="mini-btn"
                    onClick={() => {
                      setPreview(null);
                      setDiff(null);
                    }}
                  >
                    退出预览
                  </button>
                </div>
              </div>
            )}
            {diff ? (
              <div className="version-diff">
                {diff.map((op, index) => (
                  <div key={index} className={`diff-line is-${op.type}`}>
                    <span className="diff-sign">
                      {op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' '}
                    </span>
                    <span className="diff-text">{op.text || ' '}</span>
                  </div>
                ))}
              </div>
            ) : (
              <Markdown content={preview ? preview.content : detail.summary.content} />
            )}

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
                        <span className="version-time">{formatDateTime(version.createdAt)}</span>
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

        {detailTab === 'note' && detail && (
          <div className="note-panel">
            {notePreview ? (
              <div className="note-preview">
                <Markdown content={noteDraft.trim() || '*还没有内容*'} />
              </div>
            ) : (
              <textarea
                className="note-textarea"
                value={noteDraft}
                placeholder="写点笔记…（Ctrl+S 保存）"
                spellCheck={false}
                onChange={(event) => {
                  setNoteDraft(event.target.value);
                  setNoteDirty(true);
                }}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                    event.preventDefault();
                    void saveNoteDraft();
                  }
                }}
              />
            )}
            <div className="note-foot">
              <span>
                {noteDraft.length} 字
                {noteDirty
                  ? ' · 未保存'
                  : detail.note
                    ? ` · 保存于 ${formatDateTime(detail.note.updatedAt)}`
                    : ' · 空笔记不会保存'}
              </span>
              <div className="note-actions">
                <button className="mini-btn" onClick={() => setNotePreview((value) => !value)}>
                  {notePreview ? '编辑' : '预览'}
                </button>
                <button
                  className="mini-btn"
                  disabled={!noteDraft.trim()}
                  onClick={() => void exportNote()}
                >
                  导出
                </button>
                <button
                  className="mini-btn primary"
                  disabled={!noteDirty || noteSaving}
                  onClick={() => void saveNoteDraft()}
                >
                  {noteSaving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
            {noteNotice && <div className="status-line">{noteNotice}</div>}
            {(autoSaving || noteDirty) && (
              <div className="panel-hint">{autoSaving ? '正在自动保存…' : '停止输入后会自动保存'}</div>
            )}

            {noteVersions.length > 0 && (
              <div className="version-block">
                <button
                  className="version-toggle"
                  onClick={() => setNoteVersionsOpen((value) => !value)}
                >
                  历史版本 {noteVersions.length} · {noteVersionsOpen ? '收起' : '展开'}
                </button>
                {noteVersionsOpen && (
                  <div className="version-list">
                    {noteVersions.map((version) => (
                      <div key={version.id} className="version-row">
                        <span className="version-time">{formatDateTime(version.createdAt)}</span>
                        <span className="version-chars">{version.chars} 字</span>
                        <button
                          className="mini-btn"
                          onClick={() => void loadNoteVersion(version)}
                        >
                          载入
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div className="panel-title">库</div>
        <div className="toolbar-actions">
          <button
            className="mini-btn"
            title="新建一个合集，然后在「选择」模式里加视频"
            onClick={() => setNewCollectionOpen(true)}
          >
            ＋合集
          </button>
          <button className="mini-btn" onClick={() => setImportOpen(true)}>
            导入链接
          </button>
          <button
            className={`mini-btn${
              filtersOpen || tagFilter || collectionFilter ? ' is-active' : ''
            }`}
            onClick={() => setFiltersOpen((value) => !value)}
          >
            筛选
          </button>
          <button className="icon-btn" title="回收站" onClick={openTrash}>
            <Trash2 size={13} />
          </button>
          <button
            className={`mini-btn${selectMode ? ' is-active' : ''}`}
            disabled={!list?.videos.length}
            onClick={() => {
              if (selectMode) exitSelect();
              else {
                setSelectMode(true);
                setSelectedIds(new Set());
              }
            }}
          >
            {selectMode ? '取消' : '选择'}
          </button>
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
          placeholder="搜索标题、UP、标签、合集、笔记或字幕…"
          spellCheck={false}
        />
      </div>

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
        <div className="bulk-bar">
          <span className="bulk-count">已选 {selectedIds.size}</span>
          <button
            className="mini-btn"
            disabled={!visibleVideos.length}
            onClick={() => setSelectedIds(new Set(visibleVideos.map((video) => video.id)))}
          >
            全选
          </button>
          <button
            className="mini-btn primary"
            disabled={!selectedIds.size}
            onClick={() => void startBulkSummary()}
          >
            批量总结
          </button>
          <select
            className="mini-select"
            title="批量并发"
            value={bulkConcurrency}
            onChange={(event) => setBulkConcurrency(Number(event.target.value))}
          >
            {[1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>
                并发 {value}
              </option>
            ))}
          </select>
          <button className="mini-btn" onClick={() => openBulkInput('tag')}>
            加标签
          </button>
          <button className="mini-btn" onClick={() => setBulkCollectionOpen(true)}>
            加合集
          </button>
          <button
            className="mini-btn danger"
            disabled={!selectedIds.size}
            onClick={() => setBulkDeleteOpen(true)}
          >
            删除
          </button>
          <button className="mini-btn" onClick={exitSelect}>
            取消
          </button>

          {bulkInputOpen && (
            <div className="bulk-input-row">
              <input
                className="tag-input bulk-name"
                autoFocus
                value={bulkName}
                placeholder={bulkKind === 'tag' ? '标签名称' : '合集名称'}
                onChange={(event) => setBulkName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void applyBulk();
                  }
                }}
              />
              <button
                className="mini-btn primary"
                disabled={!bulkName.trim()}
                onClick={() => void applyBulk()}
              >
                应用
              </button>
              <button className="mini-btn" onClick={() => setBulkInputOpen(false)}>
                取消
              </button>
            </div>
          )}
        </div>
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
        <div className="lib-videos">
          {visibleVideos.map((video) => (
            <LibraryVideoRow
              key={video.id}
              video={video}
              selectMode={selectMode}
              selected={selectedIds.has(video.id)}
              onToggleSelect={toggleSelect}
              onOpen={openDetail}
              onDelete={(item) => setPendingDelete(item)}
            />
          ))}

          {!list.videos.length && (
            <div className="panel-empty">
              还没有入库的视频
              <div className="panel-hint">粘贴一个视频链接，导入字幕后可以直接生成总结。</div>
              <div className="quick-import">
                <input
                  value={quickLink}
                  placeholder="粘贴视频链接或 BV 号…"
                  spellCheck={false}
                  onChange={(event) => setQuickLink(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || !quickLink.trim()) return;
                    setImportText(quickLink.trim());
                    setImportSummary(true);
                    setImportOpen(true);
                  }}
                />
                <button
                  className="mini-btn primary"
                  disabled={!quickLink.trim()}
                  onClick={() => {
                    setImportText(quickLink.trim());
                    setImportSummary(true);
                    setImportOpen(true);
                  }}
                >
                  导入并总结
                </button>
              </div>
              <div className="panel-empty-actions">
                <button
                  className="mini-btn"
                  onClick={() => void window.bsub.newTab('https://www.bilibili.com/')}
                >
                  打开 B 站
                </button>
                <button className="mini-btn" onClick={() => setImportOpen(true)}>
                  导入链接
                </button>
              </div>
            </div>
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

      {importOpen && (
        <div
          className="confirm-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setImportOpen(false);
          }}
        >
          <div className="confirm-card import-links" role="dialog" aria-label="导入链接">
            <div className="confirm-title">导入链接</div>
            <div className="confirm-desc">
              每行一个 B 站视频链接或 BV 号，最多 20 个。会在后台标签里逐个抓字幕入库。
            </div>
            <textarea
              className="settings-textarea"
              rows={6}
              value={importText}
              placeholder="https://www.bilibili.com/video/BV1xx411c7mD"
              spellCheck={false}
              onChange={(event) => {
                setImportText(event.target.value);
                setResolved(null);
                setResolveNotice('');
              }}
            />
            <div className="import-resolve-row">
              <button
                className="mini-btn"
                disabled={!importText.trim() || resolving}
                onClick={() => void resolveImportLinks()}
              >
                {resolving ? '识别中…' : '识别合集 / 多 P'}
              </button>
              {resolveNotice && <span className="import-resolve-note">{resolveNotice}</span>}
            </div>
            {resolved && (
              <div className="import-resolve-card">
                <div className="import-resolve-title">
                  《{resolved.title}》 ·{' '}
                  {resolved.kind === 'season' ? 'UP 主合集' : '多 P 视频'} · 共 {resolved.total} 个
                </div>
                <div className="import-resolve-list">
                  {resolved.items.slice(0, 5).map((item) => (
                    <span key={`${item.bvid}-${item.page ?? 0}`}>{item.title}</span>
                  ))}
                  {resolved.items.length > 5 && <span>…</span>}
                </div>
                <button className="mini-btn primary" onClick={() => void importResolved()}>
                  导入全部 {resolved.total} 个
                </button>
              </div>
            )}
            <label className="settings-check">
              <input
                type="checkbox"
                checked={importSummary}
                onChange={(event) => setImportSummary(event.target.checked)}
              />
              入库后同时生成总结
            </label>
            <div className="confirm-actions">
              <button
                className="mini-btn"
                onClick={() => {
                  setImportOpen(false);
                  setPodcastOpen(true);
                }}
              >
                播客 / RSS
              </button>
              <button className="mini-btn" onClick={() => void importLocalMedia()}>
                选择本地音视频
              </button>
              <button className="mini-btn" onClick={() => setImportOpen(false)}>
                取消
              </button>
              <button
                className="mini-btn primary"
                disabled={!importText.trim()}
                onClick={() => void startImportLinks()}
              >
                开始
              </button>
            </div>
          </div>
        </div>
      )}

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

      {bulkCollectionOpen && (
        <div
          className="confirm-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setBulkCollectionOpen(false);
          }}
        >
          <div className="confirm-card" role="dialog" aria-label="加入合集">
            <div className="confirm-title">把选中的 {selectedIds.size} 个视频加入合集</div>
            <div className="collection-pick-list">
              {allCollections.map((item) => (
                <button
                  key={item.id}
                  className="mini-btn"
                  onClick={() => void addSelectedToCollection(item.name)}
                >
                  {item.name}（{item.count}）
                </button>
              ))}
              {!allCollections.length && (
                <div className="panel-hint">还没有合集，直接在下面新建一个。</div>
              )}
            </div>
            <div className="collection-pick-new">
              <input
                className="tag-input collection-name-input"
                value={bulkCollectionName}
                placeholder="新建合集名称"
                onChange={(event) => setBulkCollectionName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void addSelectedToCollection(bulkCollectionName);
                  }
                }}
              />
              <button
                className="mini-btn primary"
                disabled={!bulkCollectionName.trim()}
                onClick={() => void addSelectedToCollection(bulkCollectionName)}
              >
                新建并加入
              </button>
            </div>
            <div className="confirm-actions">
              <button className="mini-btn" onClick={() => setBulkCollectionOpen(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {manageOpen && (
        <div
          className="confirm-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setManageOpen(false);
          }}
        >
          <div className="confirm-card collection-manage" role="dialog" aria-label="管理标签与合集">
            <div className="confirm-title">管理标签与合集</div>
            <div className="collection-manage-list">
              {allTags.length > 0 && <div className="manage-section-label">标签</div>}
              {allTags.map((tag) => (
                <div key={`tag-${tag.name}`} className="collection-manage-row">
                  {tagRenameName === tag.name ? (
                    <>
                      <input
                        className="tag-input"
                        autoFocus
                        value={tagRenameDraft}
                        onChange={(event) => setTagRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void saveTagRename(tag);
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            setTagRenameName('');
                          }
                        }}
                      />
                      <button className="mini-btn primary" onClick={() => void saveTagRename(tag)}>
                        保存
                      </button>
                      <button className="mini-btn" onClick={() => setTagRenameName('')}>
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="collection-manage-name" title={tag.name}>
                        {tag.name}
                        <span className="collection-manage-count"> · {tag.count}</span>
                      </span>
                      <button
                        className="mini-btn"
                        onClick={() => {
                          setTagRenameName(tag.name);
                          setTagRenameDraft(tag.name);
                        }}
                      >
                        重命名
                      </button>
                      <button
                        className="mini-btn danger"
                        onClick={() => setPendingTagDelete(tag)}
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
              ))}

              {allCollections.length > 0 && <div className="manage-section-label">合集</div>}
              {allCollections.map((item) => (
                <div key={item.id} className="collection-manage-row">
                  {renameId === item.id ? (
                    <>
                      <input
                        className="tag-input"
                        autoFocus
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void saveRename(item);
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            setRenameId(0);
                          }
                        }}
                      />
                      <button className="mini-btn primary" onClick={() => void saveRename(item)}>
                        保存
                      </button>
                      <button className="mini-btn" onClick={() => setRenameId(0)}>
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="collection-manage-name" title={item.name}>
                        {item.name}
                        <span className="collection-manage-count"> · {item.count}</span>
                      </span>
                      <button
                        className="mini-btn"
                        disabled={item.count === 0}
                        onClick={() => void openCollectionSummary(item)}
                      >
                        对比
                      </button>
                      <button
                        className="mini-btn"
                        onClick={() => {
                          setRenameId(item.id);
                          setRenameDraft(item.name);
                        }}
                      >
                        重命名
                      </button>
                      <button
                        className="mini-btn danger"
                        onClick={() => setPendingCollectionDelete(item)}
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
              ))}
              {!allCollections.length && !allTags.length && (
                <div className="panel-empty">还没有标签或合集</div>
              )}
            </div>
            <div className="confirm-actions">
              <button className="mini-btn" onClick={() => setManageOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {summaryCollection && (
        <div
          className="confirm-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSummaryCollection(null);
          }}
        >
          <div
            className="confirm-card collection-summary"
            role="dialog"
            aria-label={`合集对比 ${summaryCollection.name}`}
          >
            <div className="confirm-title">合集对比 · {summaryCollection.name}</div>
            <div className="collection-summary-body">
              {collectionPreview && (
                <div className="version-banner">
                  <span>
                    预览版本 · {formatDateTime(collectionPreview.createdAt)} ·{' '}
                    {collectionPreview.model || 'AI'}
                  </span>
                  <div className="version-banner-actions">
                    <button
                      className="mini-btn"
                      onClick={() => void restoreCollectionVersion(collectionPreview.id)}
                    >
                      恢复此版本
                    </button>
                    <button className="mini-btn" onClick={() => setCollectionPreview(null)}>
                      退出预览
                    </button>
                  </div>
                </div>
              )}
              {summaryLoading && !collectionSummary && (
                <div className="status-line">
                  <Loader2 size={13} className="spin" />
                  正在生成对比总结…
                </div>
              )}
              {(collectionPreview || collectionSummary) ? (
                <Markdown
                  content={
                    collectionPreview ? collectionPreview.content : collectionSummary?.content || ''
                  }
                />
              ) : (
                !summaryLoading && <div className="panel-empty">还没有对比总结</div>
              )}
              {summaryLoading && collectionSummary && (
                <div className="panel-hint">正在重新生成…</div>
              )}
              {summaryError && <div className="status-line error">{summaryError}</div>}
              {collectionSummary && (
                <div className="panel-hint">
                  模型 {collectionSummary.model || 'AI'} · {collectionSummary.itemCount} 个视频 ·
                  {' '}
                  {formatDateTime(collectionSummary.updatedAt)}
                </div>
              )}

              {collectionVersions.length > 0 && (
                <div className="version-block">
                  <button
                    className="version-toggle"
                    onClick={() => setCollectionVersionsOpen((value) => !value)}
                  >
                    历史版本 {collectionVersions.length} · {collectionVersionsOpen ? '收起' : '展开'}
                  </button>
                  {collectionVersionsOpen && (
                    <div className="version-list">
                      {collectionVersions.map((version) => (
                        <div
                          key={version.id}
                          className={`version-row${
                            collectionPreview?.id === version.id ? ' is-active' : ''
                          }`}
                        >
                          <span className="version-time">{formatDateTime(version.createdAt)}</span>
                          <span className="version-model">{version.model || 'AI'}</span>
                          <span className="version-chars">{version.chars} 字</span>
                          <button
                            className="mini-btn"
                            onClick={() => void previewCollectionVersion(version)}
                          >
                            预览
                          </button>
                          <button
                            className="mini-btn"
                            onClick={() => void restoreCollectionVersion(version.id)}
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
            <div className="confirm-actions">
              <button className="mini-btn" onClick={() => setSummaryCollection(null)}>
                关闭
              </button>
              <button
                className="mini-btn"
                disabled={!collectionSummary}
                onClick={() => void exportCollectionSummary()}
              >
                导出
              </button>
              <button
                className="mini-btn primary"
                disabled={summaryLoading}
                onClick={() => void generateCollectionSummary()}
              >
                {summaryLoading ? '生成中…' : collectionSummary ? '重新生成' : '生成对比'}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {trashOpen && (
        <div className="confirm-backdrop" onClick={() => setTrashOpen(false)}>
          <div
            className="confirm-card trash-panel"
            role="dialog"
            aria-label="回收站"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-title">回收站</div>
            <div className="confirm-desc">
              删除的条目会在这里保留 30 天（最多 200 条），恢复后字幕、总结、笔记和标签都会回来。
            </div>
            {trashLoading ? (
              <div className="status-line">
                <Loader2 size={13} className="spin" /> 读取中…
              </div>
            ) : trashItems.length === 0 ? (
              <div className="panel-empty">回收站是空的</div>
            ) : (
              <div className="trash-list">
                {trashItems.map((item) => (
                  <div className="trash-row" key={item.id}>
                    <div className="trash-main">
                      <div className="trash-title" title={item.title}>
                        {item.title || '未命名视频'}
                      </div>
                      <div className="trash-meta">
                        {item.owner || '未知 UP'} · {item.lineCount.toLocaleString('zh-CN')} 行
                        {item.hasSummary ? ' · 含总结' : ''}
                        {item.hasNote ? ' · 含笔记' : ''} · {formatDateTime(item.deletedAt)} 删除
                      </div>
                    </div>
                    <div className="trash-actions">
                      <button
                        className="mini-btn"
                        disabled={trashBusy === item.id}
                        onClick={() => void restoreFromTrash(item)}
                      >
                        恢复
                      </button>
                      <button
                        className="mini-btn danger"
                        disabled={trashBusy === item.id}
                        onClick={() => void purgeTrashItem(item)}
                      >
                        彻底删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="confirm-actions">
              <button className="mini-btn" onClick={() => setTrashOpen(false)}>
                关闭
              </button>
              <button
                className="mini-btn danger"
                disabled={!trashItems.length}
                onClick={() => void clearAllTrash()}
              >
                清空回收站
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
