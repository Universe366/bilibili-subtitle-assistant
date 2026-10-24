import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { BsubApi } from '../shared/api';
import type {
  AiDeltaEvent,
  AiDoneEvent,
  AiErrorEvent,
  AiStatusEvent,
  AiReasoningEvent,
  AiPlatform,
  AsrPlatform,
  SearchPlatform,
  AppSettings,
  DiagnosticsInfo,
  CorrectionRuleGroup,
  BridgeStatus,
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatRequest,
  AsrDoneEvent,
  AsrErrorEvent,
  AsrProgressEvent,
  TranslateRequest,
  TranslateProgressEvent,
  TranslateDoneEvent,
  TranslateErrorEvent,
  OptimizeProgressEvent,
  OptimizeDoneEvent,
  OptimizeErrorEvent,
  BatchProgressEvent,
  BatchDoneEvent,
  UrlBatchProgressEvent,
  UrlBatchDoneEvent,
  UrlBatchErrorEvent,
  BatchErrorEvent,
  Chapter,
  QualityReport,
  McpServer,
  McpTool,
  SkillItem,
  LibraryHistoryItem,
  LibraryTranscriptionItem,
  FindResult,
  ExportPayload,
  SaveTextPayload,
  SaveTextResult,
  LayoutRect,
  PageInfo,
  Result,
  SettingsSnapshot,
  StoredSummary,
  WebReference,
  SubtitleBundle,
  SubtitleLine,
  SummarizeRequest,
  SummaryRef,
  TabInfo,
  TrackBody,
  UpdateStatus,
  LibraryIngestPayload,
  LibraryIngestResult,
  LibraryList,
  LibrarySearchResult,
  LibraryDetail,
  LibrarySort,
  LibraryTag,
  LibraryCollection,
  LibraryNote,
  NoteVersion,
  NoteVersionMeta,
  CollectionSummary,
  CollectionSummaryVersion,
  CollectionSummaryVersionMeta,
  CollectionResolveResult,
  ExportRecord,
  JobRecord,
  SummaryVersion,
  SummaryVersionMeta,
  GlobalSearchResult,
  TrashItem,
  HistoryEntry,
  Bookmark,
  DownloadRecord,
  PageContextSummary,
  PodcastFeed,
  PageDocument
} from '../shared/types';

const on = <T>(channel: string, cb: (payload: T) => void) => {
  const handler = (_event: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const api: BsubApi = {
  listTabs: () => ipcRenderer.invoke('tabs:list') as Promise<TabInfo[]>,
  newTab: (url?: string) => ipcRenderer.invoke('tab:new', url) as Promise<string>,
  openUrl: (url: string, start?: number) =>
    ipcRenderer.invoke('tab:open', url, start) as Promise<{
      id: string;
      reused: boolean;
      ready: boolean;
    }>,
  moveTab: (id: string, index: number) =>
    ipcRenderer.invoke('tab:move', id, index) as Promise<void>,
  openSettings: () => ipcRenderer.invoke('app:open-settings') as Promise<void>,
  closeTab: (id: string) => ipcRenderer.invoke('tab:close', id) as Promise<void>,
  activateTab: (id: string) => ipcRenderer.invoke('tab:activate', id) as Promise<void>,
  navigate: (url: string) => ipcRenderer.invoke('tab:navigate', url) as Promise<void>,
  back: () => ipcRenderer.invoke('tab:back') as Promise<void>,
  forward: () => ipcRenderer.invoke('tab:forward') as Promise<void>,
  reload: () => ipcRenderer.invoke('tab:reload') as Promise<void>,
  stop: () => ipcRenderer.invoke('tab:stop') as Promise<void>,
  zoomIn: () => ipcRenderer.invoke('tab:zoom-in') as Promise<void>,
  zoomOut: () => ipcRenderer.invoke('tab:zoom-out') as Promise<void>,
  zoomReset: () => ipcRenderer.invoke('tab:zoom-reset') as Promise<void>,
  findInPage: (query: string, options?: { forward?: boolean; findNext?: boolean }) =>
    ipcRenderer.invoke('tab:find', query, options) as Promise<void>,
  stopFind: () => ipcRenderer.invoke('tab:stop-find') as Promise<void>,
  onFindResult: (cb: (result: FindResult) => void) => on<FindResult>('find:result', cb),
  setLayout: (rect: LayoutRect) => ipcRenderer.send('layout:set', rect),
  onTabs: (cb: (tabs: TabInfo[]) => void) => on<TabInfo[]>('tabs:changed', cb),
  reopenClosedTab: () => ipcRenderer.invoke('tab:reopen-closed') as Promise<string | null>,

  listBrowseHistory: (query?: string, limit?: number) =>
    ipcRenderer.invoke('browse-history:list', query, limit) as Promise<Result<HistoryEntry[]>>,
  clearBrowseHistory: () =>
    ipcRenderer.invoke('browse-history:clear') as Promise<Result<{ removed: number }>>,

  listBookmarks: () => ipcRenderer.invoke('bookmarks:list') as Promise<Result<Bookmark[]>>,
  isBookmarked: (url: string) =>
    ipcRenderer.invoke('bookmarks:check', url) as Promise<Result<{ bookmarked: boolean }>>,
  toggleBookmark: (payload: { url: string; title?: string; favicon?: string | null }) =>
    ipcRenderer.invoke('bookmarks:toggle', payload) as Promise<Result<{ bookmarked: boolean }>>,
  removeBookmark: (url: string) =>
    ipcRenderer.invoke('bookmarks:remove', url) as Promise<Result<{ removed: boolean }>>,

  listDownloads: () => ipcRenderer.invoke('downloads:list') as Promise<Result<DownloadRecord[]>>,
  deleteDownload: (id: number) =>
    ipcRenderer.invoke('downloads:delete', id) as Promise<Result<{ removed: boolean }>>,
  clearDownloads: () =>
    ipcRenderer.invoke('downloads:clear') as Promise<Result<{ removed: number }>>,
  openDownload: (id: number) =>
    ipcRenderer.invoke('downloads:open', id) as Promise<Result<boolean>>,
  revealDownload: (id: number) =>
    ipcRenderer.invoke('downloads:reveal', id) as Promise<Result<boolean>>,
  controlDownload: (id: number, action: 'pause' | 'resume' | 'cancel') =>
    ipcRenderer.invoke('downloads:control', { id, action }) as Promise<Result<{ state: string }>>,
  clearBrowsingData: () =>
    ipcRenderer.invoke('browser:clear-data') as Promise<Result<{ cleared: boolean }>>,
  onDownloadsChanged: (cb: () => void) => on<null>('downloads:changed', () => cb()),

  getPageInfo: () => ipcRenderer.invoke('page:info') as Promise<Result<PageInfo>>,
  getPageContext: () =>
    ipcRenderer.invoke('page:context') as Promise<Result<PageContextSummary>>,
  getPageDocument: () =>
    ipcRenderer.invoke('page:document') as Promise<Result<PageDocument>>,
  resolveCollection: (input: string) =>
    ipcRenderer.invoke('source:resolve-collection', input) as Promise<
      Result<CollectionResolveResult>
    >,
  getSubtitles: (expectSignature?: string) =>
    ipcRenderer.invoke('page:subtitles', expectSignature) as Promise<Result<SubtitleBundle>>,
  triggerSubtitleMenu: () =>
    ipcRenderer.invoke('page:trigger-subtitle') as Promise<Result<boolean>>,
  getTrackBody: (url: string) => ipcRenderer.invoke('page:track-body', url) as Promise<Result<TrackBody>>,
  getTime: () =>
    ipcRenderer.invoke('page:time') as Promise<Result<{ currentTime: number; duration: number }>>,
  seek: (time: number) => ipcRenderer.invoke('page:seek', time) as Promise<void>,

  ingestLibrary: (payload: LibraryIngestPayload) =>
    ipcRenderer.invoke('library:ingest', payload) as Promise<Result<LibraryIngestResult>>,
  listLibrary: (sort?: LibrarySort) =>
    ipcRenderer.invoke('library:list', sort) as Promise<Result<LibraryList>>,
  getLibraryItem: (id: number) =>
    ipcRenderer.invoke('library:get', id) as Promise<Result<LibraryDetail>>,
  getNote: (videoId: number) =>
    ipcRenderer.invoke('library:note', videoId) as Promise<Result<LibraryNote | null>>,
  saveNote: (videoId: number, content: string) =>
    ipcRenderer.invoke('library:note-save', { videoId, content }) as Promise<
      Result<LibraryNote | null>
    >,
  getNoteVersions: (videoId: number) =>
    ipcRenderer.invoke('library:note-versions', videoId) as Promise<Result<NoteVersionMeta[]>>,
  getNoteVersion: (id: number) =>
    ipcRenderer.invoke('library:note-version', id) as Promise<Result<NoteVersion | null>>,
  listTags: () => ipcRenderer.invoke('library:tags') as Promise<Result<LibraryTag[]>>,
  setLibraryTags: (videoId: number, tags: string[]) =>
    ipcRenderer.invoke('library:set-tags', { videoId, tags }) as Promise<
      Result<{ tags: string[] }>
    >,
  renameTag: (name: string, newName: string) =>
    ipcRenderer.invoke('library:tag-rename', { name, newName }) as Promise<
      Result<{ renamed: boolean }>
    >,
  deleteTag: (name: string) =>
    ipcRenderer.invoke('library:tag-delete', name) as Promise<Result<{ removed: boolean }>>,
  bulkTag: (videoIds: number[], name: string) =>
    ipcRenderer.invoke('library:bulk-tag', { videoIds, name }) as Promise<
      Result<{ linked: number }>
    >,
  bulkCollection: (videoIds: number[], name: string) =>
    ipcRenderer.invoke('library:bulk-collection', { videoIds, name }) as Promise<
      Result<{ linked: number }>
    >,
  bulkRemove: (videoIds: number[]) =>
    ipcRenderer.invoke('library:bulk-remove', { videoIds }) as Promise<
      Result<{ removed: number }>
    >,
  importLocalMedia: () =>
    ipcRenderer.invoke('local:import') as Promise<
      Result<{ canceled: boolean; requestId?: string; filename?: string }>
    >,
  previewPodcast: (url: string) =>
    ipcRenderer.invoke('podcast:preview', url) as Promise<Result<PodcastFeed>>,
  importPodcast: (payload: {
    audioUrl: string;
    title: string;
    pageUrl?: string;
    duration?: number;
  }) => ipcRenderer.invoke('podcast:import', payload) as Promise<Result<{ requestId: string }>>,
  listTrash: () => ipcRenderer.invoke('trash:list') as Promise<Result<TrashItem[]>>,
  restoreTrash: (id: number) =>
    ipcRenderer.invoke('trash:restore', id) as Promise<Result<{ videoId: number }>>,
  deleteTrash: (id: number) =>
    ipcRenderer.invoke('trash:delete', id) as Promise<Result<{ removed: boolean }>>,
  clearTrash: () => ipcRenderer.invoke('trash:clear') as Promise<Result<{ removed: number }>>,
  vacuumLibrary: () =>
    ipcRenderer.invoke('library:vacuum') as Promise<Result<{ before: number; after: number }>>,
  listCollections: () =>
    ipcRenderer.invoke('library:collections') as Promise<Result<LibraryCollection[]>>,
  createCollection: (name: string) =>
    ipcRenderer.invoke('library:collection-create', name) as Promise<
      Result<LibraryCollection>
    >,
  addToCollection: (videoId: number, name: string) =>
    ipcRenderer.invoke('library:collection-add', { videoId, name }) as Promise<
      Result<{ collections: string[] }>
    >,
  removeFromCollection: (videoId: number, name: string) =>
    ipcRenderer.invoke('library:collection-remove', { videoId, name }) as Promise<
      Result<{ collections: string[] }>
    >,
  renameCollection: (id: number, name: string) =>
    ipcRenderer.invoke('library:collection-rename', { id, name }) as Promise<
      Result<{ renamed: boolean }>
    >,
  deleteCollection: (id: number) =>
    ipcRenderer.invoke('library:collection-delete', id) as Promise<
      Result<{ removed: boolean }>
    >,
  getCollectionSummary: (collectionId: number) =>
    ipcRenderer.invoke('collection:summary', collectionId) as Promise<
      Result<CollectionSummary | null>
    >,
  getCollectionSummaryVersions: (collectionId: number) =>
    ipcRenderer.invoke('collection:summary-versions', collectionId) as Promise<
      Result<CollectionSummaryVersionMeta[]>
    >,
  getCollectionSummaryVersion: (id: number) =>
    ipcRenderer.invoke('collection:summary-version', id) as Promise<
      Result<CollectionSummaryVersion | null>
    >,
  restoreCollectionSummaryVersion: (id: number) =>
    ipcRenderer.invoke('collection:summary-restore', id) as Promise<
      Result<CollectionSummary>
    >,
  summarizeCollection: (collectionId: number) =>
    ipcRenderer.invoke('collection:summarize', collectionId) as Promise<
      Result<{ requestId: string }>
    >,
  onCollectionSummaryDone: (
    cb: (event: { collectionId: number; summary: CollectionSummary }) => void
  ) => on<{ collectionId: number; summary: CollectionSummary }>('collection:summary-done', cb),
  onCollectionSummaryError: (cb: (event: { collectionId: number; error: string }) => void) =>
    on<{ collectionId: number; error: string }>('collection:summary-error', cb),
  searchLibrary: (query: string) =>
    ipcRenderer.invoke('library:search', query) as Promise<Result<LibrarySearchResult>>,
  globalSearch: (query: string) =>
    ipcRenderer.invoke('search:global', query) as Promise<Result<GlobalSearchResult>>,
  onSearchRequest: (cb: () => void) => on<null>('app:search', () => cb()),
  onAskSelectionRequest: (cb: () => void) => on<null>('app:ask-selection', () => cb()),
  onSelectionAction: (cb: (payload: { action: string; text: string }) => void) =>
    on<{ action: string; text: string }>('app:selection-action', cb),
  onTabSearchRequest: (cb: () => void) => on<null>('app:tab-search', () => cb()),
  onBookmarkRequest: (cb: () => void) => on<null>('app:bookmark', () => cb()),
  onReaderRequest: (cb: () => void) => on<null>('app:reader', () => cb()),
  onTasksRequest: (cb: () => void) => on<null>('app:tasks', () => cb()),
  removeLibrary: (id: number) =>
    ipcRenderer.invoke('library:remove', id) as Promise<Result<{ removed: boolean }>>,
  savePageSummary: (payload: { title: string; url: string; content: string; model?: string }) =>
    ipcRenderer.invoke('library:save-page-summary', payload) as Promise<
      Result<{ videoId: number; created: boolean }>
    >,
  openLibrarySource: (id: number) =>
    ipcRenderer.invoke('library:open-source', id) as Promise<Result<boolean>>,
  onLibraryChanged: (cb: () => void) => on<null>('library:changed', () => cb()),

  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<Result<SettingsSnapshot>>,
  getDiagnostics: () => ipcRenderer.invoke('diagnostics:get') as Promise<Result<DiagnosticsInfo>>,
  exportDiagnostics: () =>
    ipcRenderer.invoke('diagnostics:export') as Promise<
      Result<{ canceled: boolean; path?: string }>
    >,
  clearSitePermissions: () =>
    ipcRenderer.invoke('permissions:clear') as Promise<Result<{ removed: number }>>,
  listSitePermissions: () =>
    ipcRenderer.invoke('permissions:list') as Promise<
      Result<Array<{ origin: string; permission: string; decision: 'allow' | 'deny' }>>
    >,
  revokeSitePermission: (origin: string, permission: string) =>
    ipcRenderer.invoke('permissions:revoke', { origin, permission }) as Promise<
      Result<{ removed: boolean }>
    >,
  beginSidebarDrag: () =>
    ipcRenderer.invoke('browser:begin-drag') as Promise<Result<string | null>>,
  endSidebarDrag: () => ipcRenderer.invoke('browser:end-drag') as Promise<void>,
  setBrowserVisible: (visible: boolean) =>
    ipcRenderer.invoke('browser:set-visible', visible) as Promise<void>,
  setSidebarLayout: (patch: {
    width?: number;
    position?: 'left' | 'right';
    collapsed?: boolean;
  }) =>
    ipcRenderer.invoke('settings:sidebar-layout', patch) as Promise<Result<SettingsSnapshot>>,
  setSidebarWidth: (width: number) =>
    ipcRenderer.invoke('settings:sidebar-width', width) as Promise<Result<SettingsSnapshot>>,
  saveSettings: (next: AppSettings) =>
    ipcRenderer.invoke('settings:set', next) as Promise<Result<SettingsSnapshot>>,
  finishWizard: () =>
    ipcRenderer.invoke('settings:wizard', true) as Promise<Result<SettingsSnapshot>>,
  setWizardVisible: (visible: boolean) =>
    ipcRenderer.invoke('settings:wizard', !visible) as Promise<Result<SettingsSnapshot>>,
  exportSettings: () =>
    ipcRenderer.invoke('settings:export') as Promise<Result<{ canceled: boolean; path?: string }>>,
  importSettings: () =>
    ipcRenderer.invoke('settings:import') as Promise<
      Result<{ canceled: boolean; snapshot?: SettingsSnapshot }>
    >,
  onSettingsChanged: (cb: (snapshot: SettingsSnapshot) => void) =>
    on<SettingsSnapshot>('settings:changed', cb),
  testSearch: (query: string) =>
    ipcRenderer.invoke('search:test', query) as Promise<Result<WebReference[]>>,
  exportRuleGroup: (group: CorrectionRuleGroup) =>
    ipcRenderer.invoke('rules:export', group) as Promise<
      Result<{ canceled: boolean; path?: string }>
    >,
  importRuleGroups: () =>
    ipcRenderer.invoke('rules:import') as Promise<Result<CorrectionRuleGroup[]>>,
  previewCorrection: (text: string, settings?: AppSettings) =>
    ipcRenderer.invoke('correction:preview', text, settings) as Promise<Result<string>>,
  probePlatformModels: (kind: 'ai' | 'asr', platform: AiPlatform | AsrPlatform) =>
    ipcRenderer.invoke('platform:models', { kind, platform }) as Promise<
      Result<{ models: string[]; url: string }>
    >,
  testPlatform: (
    kind: 'ai' | 'asr' | 'search',
    platform: AiPlatform | AsrPlatform | SearchPlatform
  ) =>
    ipcRenderer.invoke('platform:test', { kind, platform }) as Promise<
      Result<{ ok: boolean; ms: number; sample: string }>
    >,
  testAi: (platform?: AiPlatform) =>
    ipcRenderer.invoke('settings:test', platform) as Promise<
      Result<{ latencyMs: number; message: string }>
    >,
  openDataDir: () => ipcRenderer.invoke('settings:open-data') as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url) as Promise<void>,
  backupData: () =>
    ipcRenderer.invoke('data:backup') as Promise<
      Result<{ canceled: boolean; path?: string }>
    >,
  restoreData: () =>
    ipcRenderer.invoke('data:restore') as Promise<
      Result<{ canceled: boolean; restored?: boolean }>
    >,
  changeDataDir: () =>
    ipcRenderer.invoke('data:change-dir') as Promise<
      Result<{ canceled: boolean; target?: string; failed?: number }>
    >,
  getBridgeStatus: () =>
    ipcRenderer.invoke('bridge:status') as Promise<Result<BridgeStatus>>,
  installExtension: () =>
    ipcRenderer.invoke('bridge:install-extension') as Promise<
      Result<{ path: string; browser: string; opened: boolean }>
    >,
  writeClipboard: (text: string) =>
    ipcRenderer.invoke('clipboard:write', text) as Promise<void>,

  getUpdateStatus: () =>
    ipcRenderer.invoke('update:status') as Promise<Result<UpdateStatus>>,
  checkForUpdates: () =>
    ipcRenderer.invoke('update:check') as Promise<Result<UpdateStatus>>,
  downloadUpdate: () =>
    ipcRenderer.invoke('update:download') as Promise<Result<UpdateStatus>>,
  installUpdate: () => ipcRenderer.invoke('update:install') as Promise<void>,
  skipUpdate: (version: string) =>
    ipcRenderer.invoke('update:skip', version) as Promise<Result<UpdateStatus>>,
  openReleasesPage: () => ipcRenderer.invoke('update:open-releases') as Promise<void>,
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => on<UpdateStatus>('update:status', cb),

  summarize: (payload: SummarizeRequest) =>
    ipcRenderer.invoke('ai:summarize', payload) as Promise<Result<{ requestId: string }>>,
  cancelSummary: (requestId: string) =>
    ipcRenderer.invoke('ai:cancel', requestId) as Promise<void>,
  getSummary: (ref: SummaryRef) =>
    ipcRenderer.invoke('library:get-summary', ref) as Promise<Result<StoredSummary | null>>,
  getSummaryVersions: (videoId: number) =>
    ipcRenderer.invoke('library:summary-versions', videoId) as Promise<
      Result<SummaryVersionMeta[]>
    >,
  getSummaryVersion: (id: number) =>
    ipcRenderer.invoke('library:summary-version', id) as Promise<Result<SummaryVersion | null>>,
  restoreSummaryVersion: (id: number) =>
    ipcRenderer.invoke('library:restore-version', id) as Promise<Result<StoredSummary>>,
  onAiDelta: (cb: (event: AiDeltaEvent) => void) => on<AiDeltaEvent>('ai:delta', cb),
  onAiDone: (cb: (event: AiDoneEvent) => void) => on<AiDoneEvent>('ai:done', cb),
  onAiError: (cb: (event: AiErrorEvent) => void) => on<AiErrorEvent>('ai:error', cb),
  onAiStatus: (cb: (event: AiStatusEvent) => void) => on<AiStatusEvent>('ai:status', cb),
  onAiReasoning: (cb: (event: AiReasoningEvent) => void) =>
    on<AiReasoningEvent>('ai:reasoning', cb),

  chat: (payload: ChatRequest) =>
    ipcRenderer.invoke('chat:send', payload) as Promise<Result<{ requestId: string }>>,
  cancelChat: (requestId: string) =>
    ipcRenderer.invoke('chat:cancel', requestId) as Promise<void>,
  onChatDelta: (cb: (event: ChatDeltaEvent) => void) => on<ChatDeltaEvent>('chat:delta', cb),
  onChatDone: (cb: (event: ChatDoneEvent) => void) => on<ChatDoneEvent>('chat:done', cb),
  onChatError: (cb: (event: ChatErrorEvent) => void) => on<ChatErrorEvent>('chat:error', cb),

  transcribe: (requestId: string) =>
    ipcRenderer.invoke('asr:transcribe', { requestId }) as Promise<Result<{ requestId: string }>>,
  cancelTranscribe: (requestId: string) =>
    ipcRenderer.invoke('asr:cancel', requestId) as Promise<void>,
  onAsrProgress: (cb: (event: AsrProgressEvent) => void) => on<AsrProgressEvent>('asr:progress', cb),
  onAsrDone: (cb: (event: AsrDoneEvent) => void) => on<AsrDoneEvent>('asr:done', cb),
  onAsrError: (cb: (event: AsrErrorEvent) => void) => on<AsrErrorEvent>('asr:error', cb),

  translate: (payload: TranslateRequest) =>
    ipcRenderer.invoke('translate:start', payload) as Promise<Result<{ requestId: string }>>,
  cancelTranslate: (requestId: string) =>
    ipcRenderer.invoke('translate:cancel', requestId) as Promise<void>,
  onTranslateProgress: (cb: (event: TranslateProgressEvent) => void) =>
    on<TranslateProgressEvent>('translate:progress', cb),
  onTranslateDone: (cb: (event: TranslateDoneEvent) => void) =>
    on<TranslateDoneEvent>('translate:done', cb),
  onTranslateError: (cb: (event: TranslateErrorEvent) => void) =>
    on<TranslateErrorEvent>('translate:error', cb),

  optimize: (payload: { requestId: string; lines: SubtitleLine[] }) =>
    ipcRenderer.invoke('optimize:start', payload) as Promise<Result<{ requestId: string }>>,
  cancelOptimize: (requestId: string) =>
    ipcRenderer.invoke('optimize:cancel', requestId) as Promise<void>,
  onOptimizeProgress: (cb: (event: OptimizeProgressEvent) => void) =>
    on<OptimizeProgressEvent>('optimize:progress', cb),
  onOptimizeDone: (cb: (event: OptimizeDoneEvent) => void) =>
    on<OptimizeDoneEvent>('optimize:done', cb),
  onOptimizeError: (cb: (event: OptimizeErrorEvent) => void) =>
    on<OptimizeErrorEvent>('optimize:error', cb),

  batchSummarize: (videoIds: number[], concurrency?: number) =>
    ipcRenderer.invoke('batch:summarize', { videoIds, concurrency }) as Promise<
      Result<{ requestId: string }>
    >,
  cancelBatch: (requestId: string) =>
    ipcRenderer.invoke('batch:cancel', requestId) as Promise<void>,
  pauseBatch: (requestId: string) =>
    ipcRenderer.invoke('batch:pause', requestId) as Promise<void>,
  resumeBatch: (requestId: string) =>
    ipcRenderer.invoke('batch:resume', requestId) as Promise<void>,
  removeBatchItem: (requestId: string, videoId: number) =>
    ipcRenderer.invoke('batch:remove', { requestId, videoId }) as Promise<void>,
  onBatchProgress: (cb: (event: BatchProgressEvent) => void) =>
    on<BatchProgressEvent>('batch:progress', cb),
  onBatchDone: (cb: (event: BatchDoneEvent) => void) => on<BatchDoneEvent>('batch:done', cb),
  onBatchError: (cb: (event: BatchErrorEvent) => void) => on<BatchErrorEvent>('batch:error', cb),

  batchUrls: (urls: string[], summarize: boolean) =>
    ipcRenderer.invoke('urlbatch:start', { urls, summarize }) as Promise<
      Result<{ requestId: string }>
    >,
  cancelUrlBatch: (requestId: string) =>
    ipcRenderer.invoke('urlbatch:cancel', requestId) as Promise<void>,
  onUrlBatchProgress: (cb: (event: UrlBatchProgressEvent) => void) =>
    on<UrlBatchProgressEvent>('urlbatch:progress', cb),
  onUrlBatchDone: (cb: (event: UrlBatchDoneEvent) => void) =>
    on<UrlBatchDoneEvent>('urlbatch:done', cb),
  onUrlBatchError: (cb: (event: UrlBatchErrorEvent) => void) =>
    on<UrlBatchErrorEvent>('urlbatch:error', cb),

  getHistory: () => ipcRenderer.invoke('history:list') as Promise<Result<LibraryHistoryItem[]>>,
  getTranscriptions: () =>
    ipcRenderer.invoke('history:transcriptions') as Promise<Result<LibraryTranscriptionItem[]>>,
  deleteHistory: (id: number) =>
    ipcRenderer.invoke('history:delete', id) as Promise<Result<{ removed: boolean }>>,
  clearHistory: () =>
    ipcRenderer.invoke('history:clear') as Promise<Result<{ removed: number }>>,
  listExports: () => ipcRenderer.invoke('exports:list') as Promise<Result<ExportRecord[]>>,
  clearExports: () =>
    ipcRenderer.invoke('exports:clear') as Promise<Result<{ removed: number }>>,
  deleteExport: (id: number) =>
    ipcRenderer.invoke('exports:delete', id) as Promise<Result<{ removed: boolean }>>,
  openExport: (filePath: string) =>
    ipcRenderer.invoke('exports:open', filePath) as Promise<Result<boolean>>,
  revealExport: (filePath: string) =>
    ipcRenderer.invoke('exports:reveal', filePath) as Promise<Result<boolean>>,

  listJobs: () => ipcRenderer.invoke('jobs:list') as Promise<Result<JobRecord[]>>,
  getJob: (id: string) => ipcRenderer.invoke('jobs:get', id) as Promise<Result<JobRecord | null>>,
  cancelJob: (id: string) => ipcRenderer.invoke('jobs:cancel', id) as Promise<void>,
  retryJob: (id: string) =>
    ipcRenderer.invoke('jobs:retry', id) as Promise<Result<{ requestId: string }>>,
  clearFinishedJobs: () =>
    ipcRenderer.invoke('jobs:clear-finished') as Promise<Result<{ removed: number }>>,
  onJobsChanged: (cb: (jobs: JobRecord[]) => void) => on<JobRecord[]>('jobs:changed', cb),

  checkQuality: (info: PageInfo, lines: SubtitleLine[]) =>
    ipcRenderer.invoke('quality:check', { info, lines }) as Promise<Result<QualityReport>>,
  generateChapters: (info: PageInfo, lines: SubtitleLine[]) =>
    ipcRenderer.invoke('chapters:generate', { info, lines }) as Promise<Result<Chapter[]>>,

  testMcp: (server: McpServer) =>
    ipcRenderer.invoke('mcp:test', server) as Promise<Result<McpTool[]>>,
  callMcp: (server: McpServer, name: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke('mcp:call', { server, name, args }) as Promise<Result<string>>,
  importSkill: () =>
    ipcRenderer.invoke('skills:import') as Promise<Result<SkillItem | null>>,

  exportBatch: (payload: { ids: number[]; kind: 'subtitles' | 'summary' }) =>
    ipcRenderer.invoke('export:batch', payload) as Promise<
      Result<{ canceled: true } | { dir: string; exported: number; skipped: string[] }>
    >,
  exportVideo: (payload: ExportPayload) =>
    ipcRenderer.invoke('export:save', payload) as Promise<
      Result<{ path: string } | { canceled: true }>
    >,
  saveTextFile: (payload: SaveTextPayload) =>
    ipcRenderer.invoke('file:save-text', payload) as Promise<Result<SaveTextResult>>
};

contextBridge.exposeInMainWorld('bsub', api);
