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
  LayoutRect,
  Result,
  PageInfo,
  SettingsSnapshot,
  StoredSummary,
  SubtitleBundle,
  SubtitleLine,
  SummarizeRequest,
  SummaryRef,
  TrackBody,
  TabInfo,
  WebReference,
  UpdateStatus,
  ExportPayload,
  SaveTextPayload,
  SaveTextResult,
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
} from './types';

export interface BsubApi {
  listTabs(): Promise<TabInfo[]>;
  newTab(url?: string): Promise<string>;
  /** 打开链接：同一视频已打开时复用标签；start 为秒级播放位置。 */
  openUrl(url: string, start?: number): Promise<{ id: string; reused: boolean; ready: boolean }>;
  moveTab(id: string, index: number): void;
  petPosition(): Promise<{ x: number; y: number } | null>;
  resetPetPosition(): Promise<void>;
  movePet(x: number, y: number): Promise<void>;
  isMediaPlaying(): Promise<{ ok: true; data: boolean }>;
  setPetEnabled(enabled: boolean): Promise<void>;
  focusMain(): Promise<void>;
  setPlaybackRate(rate: number): Promise<{ ok: true; data: number }>;
  setActiveViewVisible(visible: boolean): Promise<void>;
  pinTab(id: string, pinned: boolean): Promise<void>;
  closeTab(id: string): Promise<void>;
  activateTab(id: string): Promise<void>;
  navigate(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  stop(): Promise<void>;
  setLayout(rect: LayoutRect): void;
  onTabs(cb: (tabs: TabInfo[]) => void): () => void;
  reopenClosedTab(): Promise<string | null>;

  listBrowseHistory(query?: string, limit?: number): Promise<Result<HistoryEntry[]>>;
  clearBrowseHistory(): Promise<Result<{ removed: number }>>;
  listBookmarks(): Promise<Result<Bookmark[]>>;
  isBookmarked(url: string): Promise<Result<{ bookmarked: boolean }>>;
  toggleBookmark(payload: {
    url: string;
    title?: string;
    favicon?: string | null;
  }): Promise<Result<{ bookmarked: boolean }>>;
  removeBookmark(url: string): Promise<Result<{ removed: boolean }>>;
  listDownloads(): Promise<Result<DownloadRecord[]>>;
  deleteDownload(id: number): Promise<Result<{ removed: boolean }>>;
  clearDownloads(): Promise<Result<{ removed: number }>>;
  openDownload(id: number): Promise<Result<boolean>>;
  revealDownload(id: number): Promise<Result<boolean>>;
  controlDownload(id: number, action: 'pause' | 'resume' | 'cancel'): Promise<Result<{ state: string }>>;
  clearBrowsingData(): Promise<Result<{ cleared: boolean }>>;
  onDownloadsChanged(cb: () => void): () => void;

  getPageInfo(): Promise<Result<PageInfo>>;
  getPageContext(): Promise<Result<PageContextSummary>>;
  getPageDocument(): Promise<Result<PageDocument>>;
  resolveCollection(input: string): Promise<Result<CollectionResolveResult>>;
  getSubtitles(expectSignature?: string): Promise<Result<SubtitleBundle>>;
  triggerSubtitleMenu(): Promise<Result<boolean>>;
  getTrackBody(url: string): Promise<Result<TrackBody>>;
  getTime(): Promise<Result<{ currentTime: number; duration: number }>>;
  seek(time: number): Promise<void>;

  ingestLibrary(payload: LibraryIngestPayload): Promise<Result<LibraryIngestResult>>;
  listLibrary(sort?: LibrarySort): Promise<Result<LibraryList>>;
  getLibraryItem(id: number): Promise<Result<LibraryDetail>>;
  getNote(videoId: number): Promise<Result<LibraryNote | null>>;
  saveNote(videoId: number, content: string): Promise<Result<LibraryNote | null>>;
  getNoteVersions(videoId: number): Promise<Result<NoteVersionMeta[]>>;
  getNoteVersion(id: number): Promise<Result<NoteVersion | null>>;
  listTags(): Promise<Result<LibraryTag[]>>;
  setLibraryTags(videoId: number, tags: string[]): Promise<Result<{ tags: string[] }>>;
  renameTag(name: string, newName: string): Promise<Result<{ renamed: boolean }>>;
  deleteTag(name: string): Promise<Result<{ removed: boolean }>>;
  bulkTag(videoIds: number[], name: string): Promise<Result<{ linked: number }>>;
  bulkCollection(videoIds: number[], name: string): Promise<Result<{ linked: number }>>;
  bulkRemove(videoIds: number[]): Promise<Result<{ removed: number }>>;
  importLocalMedia(): Promise<
    Result<{ canceled: boolean; requestId?: string; filename?: string }>
  >;
  previewPodcast(url: string): Promise<Result<PodcastFeed>>;
  importPodcast(payload: {
    audioUrl: string;
    title: string;
    pageUrl?: string;
    duration?: number;
  }): Promise<Result<{ requestId: string }>>;
  listTrash(): Promise<Result<TrashItem[]>>;
  restoreTrash(id: number): Promise<Result<{ videoId: number }>>;
  deleteTrash(id: number): Promise<Result<{ removed: boolean }>>;
  clearTrash(): Promise<Result<{ removed: number }>>;
  vacuumLibrary(): Promise<Result<{ before: number; after: number }>>;
  listCollections(): Promise<Result<LibraryCollection[]>>;
  createCollection(name: string): Promise<Result<LibraryCollection>>;
  addToCollection(videoId: number, name: string): Promise<Result<{ collections: string[] }>>;
  removeFromCollection(
    videoId: number,
    name: string
  ): Promise<Result<{ collections: string[] }>>;
  renameCollection(id: number, name: string): Promise<Result<{ renamed: boolean }>>;
  deleteCollection(id: number): Promise<Result<{ removed: boolean }>>;
  getCollectionSummary(collectionId: number): Promise<Result<CollectionSummary | null>>;
  getCollectionSummaryVersions(
    collectionId: number
  ): Promise<Result<CollectionSummaryVersionMeta[]>>;
  getCollectionSummaryVersion(id: number): Promise<Result<CollectionSummaryVersion | null>>;
  restoreCollectionSummaryVersion(id: number): Promise<Result<CollectionSummary>>;
  summarizeCollection(collectionId: number): Promise<Result<{ requestId: string }>>;
  onCollectionSummaryDone(
    cb: (event: { collectionId: number; summary: CollectionSummary }) => void
  ): () => void;
  onCollectionSummaryError(
    cb: (event: { collectionId: number; error: string }) => void
  ): () => void;
  searchLibrary(query: string): Promise<Result<LibrarySearchResult>>;
  globalSearch(query: string): Promise<Result<GlobalSearchResult>>;
  onSearchRequest(cb: () => void): () => void;
  onAskSelectionRequest(cb: () => void): () => void;
  onSelectionAction(cb: (payload: { action: string; text: string }) => void): () => void;
  onTabSearchRequest(cb: () => void): () => void;
  onBookmarkRequest(cb: () => void): () => void;
  onReaderRequest(cb: () => void): () => void;
  onTasksRequest(cb: () => void): () => void;
  removeLibrary(id: number): Promise<Result<{ removed: boolean }>>;
  savePageSummary(payload: {
    title: string;
    url: string;
    content: string;
    model?: string;
  }): Promise<Result<{ videoId: number; created: boolean }>>;
  openLibrarySource(id: number): Promise<Result<boolean>>;
  onLibraryChanged(cb: () => void): () => void;

  getSettings(): Promise<Result<SettingsSnapshot>>;
  getDiagnostics(): Promise<Result<DiagnosticsInfo>>;
  exportDiagnostics(): Promise<Result<{ canceled: boolean; path?: string }>>;
  clearSitePermissions(): Promise<Result<{ removed: number }>>;
  listSitePermissions(): Promise<
    Result<Array<{ origin: string; permission: string; decision: 'allow' | 'deny' }>>
  >;
  revokeSitePermission(origin: string, permission: string): Promise<Result<{ removed: boolean }>>;
  saveSettings(next: AppSettings): Promise<Result<SettingsSnapshot>>;
  finishWizard(): Promise<Result<SettingsSnapshot>>;
  setWizardVisible(visible: boolean): Promise<Result<SettingsSnapshot>>;
  setSidebarWidth(width: number): Promise<Result<SettingsSnapshot>>;
  setBrowserVisible(visible: boolean): Promise<void>;
  beginSidebarDrag(): Promise<Result<string | null>>;
  endSidebarDrag(): Promise<void>;
  setSidebarLayout(patch: {
    width?: number;
    position?: 'left' | 'right';
    collapsed?: boolean;
  }): Promise<Result<SettingsSnapshot>>;
  exportSettings(): Promise<Result<{ canceled: boolean; path?: string }>>;
  importSettings(): Promise<Result<{ canceled: boolean; snapshot?: SettingsSnapshot }>>;
  onSettingsChanged(cb: (snapshot: SettingsSnapshot) => void): () => void;
  testSearch(query: string): Promise<Result<WebReference[]>>;
  previewCorrection(text: string, settings?: AppSettings): Promise<Result<string>>;
  exportRuleGroup(group: CorrectionRuleGroup): Promise<Result<{ canceled: boolean; path?: string }>>;
  importRuleGroups(): Promise<Result<CorrectionRuleGroup[]>>;
  testAi(platform?: AiPlatform): Promise<Result<{ latencyMs: number; message: string }>>;
  probePlatformModels(
    kind: 'ai' | 'asr',
    platform: AiPlatform | AsrPlatform
  ): Promise<Result<{ models: string[]; url: string }>>;
  testPlatform(
    kind: 'ai' | 'asr' | 'search',
    platform: AiPlatform | AsrPlatform | SearchPlatform
  ): Promise<Result<{ ok: boolean; ms: number; sample: string }>>;
  openDataDir(): Promise<void>;
  openExternal(url: string): Promise<void>;
  backupData(): Promise<Result<{ canceled: boolean; path?: string }>>;
  restoreData(): Promise<Result<{ canceled: boolean; restored?: boolean }>>;
  changeDataDir(): Promise<
    Result<{ canceled: boolean; target?: string; failed?: number }>
  >;
  getBridgeStatus(): Promise<Result<BridgeStatus>>;
  installExtension(): Promise<Result<{ path: string; browser: string; opened: boolean }>>;
  writeClipboard(text: string): Promise<void>;

  getUpdateStatus(): Promise<Result<UpdateStatus>>;
  checkForUpdates(): Promise<Result<UpdateStatus>>;
  downloadUpdate(): Promise<Result<UpdateStatus>>;
  installUpdate(): Promise<void>;
  skipUpdate(version: string): Promise<Result<UpdateStatus>>;
  openReleasesPage(): Promise<void>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;

  summarize(payload: SummarizeRequest): Promise<Result<{ requestId: string }>>;
  cancelSummary(requestId: string): Promise<void>;
  getSummary(ref: SummaryRef): Promise<Result<StoredSummary | null>>;
  getSummaryVersions(videoId: number): Promise<Result<SummaryVersionMeta[]>>;
  getSummaryVersion(id: number): Promise<Result<SummaryVersion | null>>;
  restoreSummaryVersion(id: number): Promise<Result<StoredSummary>>;
  onAiDelta(cb: (event: AiDeltaEvent) => void): () => void;
  onAiDone(cb: (event: AiDoneEvent) => void): () => void;
  onAiError(cb: (event: AiErrorEvent) => void): () => void;
  onAiStatus(cb: (event: AiStatusEvent) => void): () => void;
  onAiReasoning(cb: (event: AiReasoningEvent) => void): () => void;

  chat(payload: ChatRequest): Promise<Result<{ requestId: string }>>;
  cancelChat(requestId: string): Promise<void>;
  onChatDelta(cb: (event: ChatDeltaEvent) => void): () => void;
  onChatDone(cb: (event: ChatDoneEvent) => void): () => void;
  onChatError(cb: (event: ChatErrorEvent) => void): () => void;

  transcribe(requestId: string): Promise<Result<{ requestId: string }>>;
  cancelTranscribe(requestId: string): Promise<void>;
  onAsrProgress(cb: (event: AsrProgressEvent) => void): () => void;
  onAsrDone(cb: (event: AsrDoneEvent) => void): () => void;
  onAsrError(cb: (event: AsrErrorEvent) => void): () => void;

  translate(payload: TranslateRequest): Promise<Result<{ requestId: string }>>;
  cancelTranslate(requestId: string): Promise<void>;
  onTranslateProgress(cb: (event: TranslateProgressEvent) => void): () => void;
  onTranslateDone(cb: (event: TranslateDoneEvent) => void): () => void;
  onTranslateError(cb: (event: TranslateErrorEvent) => void): () => void;

  optimize(payload: { requestId: string; lines: SubtitleLine[] }): Promise<Result<{ requestId: string }>>;
  cancelOptimize(requestId: string): Promise<void>;
  onOptimizeProgress(cb: (event: OptimizeProgressEvent) => void): () => void;
  onOptimizeDone(cb: (event: OptimizeDoneEvent) => void): () => void;
  onOptimizeError(cb: (event: OptimizeErrorEvent) => void): () => void;

  batchSummarize(
    videoIds: number[],
    concurrency?: number
  ): Promise<Result<{ requestId: string }>>;
  cancelBatch(requestId: string): Promise<void>;
  pauseBatch(requestId: string): Promise<void>;
  resumeBatch(requestId: string): Promise<void>;
  removeBatchItem(requestId: string, videoId: number): Promise<void>;
  onBatchProgress(cb: (event: BatchProgressEvent) => void): () => void;
  onBatchDone(cb: (event: BatchDoneEvent) => void): () => void;
  onBatchError(cb: (event: BatchErrorEvent) => void): () => void;

  batchUrls(urls: string[], summarize: boolean): Promise<Result<{ requestId: string }>>;
  cancelUrlBatch(requestId: string): Promise<void>;
  onUrlBatchProgress(cb: (event: UrlBatchProgressEvent) => void): () => void;
  onUrlBatchDone(cb: (event: UrlBatchDoneEvent) => void): () => void;
  onUrlBatchError(cb: (event: UrlBatchErrorEvent) => void): () => void;

  getHistory(): Promise<Result<LibraryHistoryItem[]>>;
  getTranscriptions(): Promise<Result<LibraryTranscriptionItem[]>>;
  deleteHistory(id: number): Promise<Result<{ removed: boolean }>>;
  clearHistory(): Promise<Result<{ removed: number }>>;
  listExports(): Promise<Result<ExportRecord[]>>;
  clearExports(): Promise<Result<{ removed: number }>>;
  deleteExport(id: number): Promise<Result<{ removed: boolean }>>;
  openExport(filePath: string): Promise<Result<boolean>>;
  revealExport(filePath: string): Promise<Result<boolean>>;

  listJobs(): Promise<Result<JobRecord[]>>;
  getJob(id: string): Promise<Result<JobRecord | null>>;
  cancelJob(id: string): Promise<void>;
  retryJob(id: string): Promise<Result<{ requestId: string }>>;
  clearFinishedJobs(): Promise<Result<{ removed: number }>>;
  onJobsChanged(cb: (jobs: JobRecord[]) => void): () => void;

  checkQuality(info: PageInfo, lines: SubtitleLine[]): Promise<Result<QualityReport>>;
  generateChapters(info: PageInfo, lines: SubtitleLine[]): Promise<Result<Chapter[]>>;

  testMcp(server: McpServer): Promise<Result<McpTool[]>>;
  callMcp(server: McpServer, name: string, args: Record<string, unknown>): Promise<Result<string>>;
  importSkill(): Promise<Result<SkillItem | null>>;

  exportBatch(payload: { ids: number[]; kind: 'subtitles' | 'summary' }): Promise<
    Result<{ canceled: true } | { dir: string; exported: number; skipped: string[] }>
  >;
  exportVideo(payload: ExportPayload): Promise<Result<{ path: string } | { canceled: true }>>;
  saveTextFile(payload: SaveTextPayload): Promise<Result<SaveTextResult>>;

  zoomIn(): Promise<void>;
  zoomOut(): Promise<void>;
  zoomReset(): Promise<void>;
  findInPage(query: string, options?: { forward?: boolean; findNext?: boolean }): Promise<void>;
  stopFind(): Promise<void>;
  onFindResult(cb: (result: FindResult) => void): () => void;
}
