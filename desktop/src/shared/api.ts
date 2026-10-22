import type {
  AiDeltaEvent,
  AiDoneEvent,
  AiErrorEvent,
  AiStatusEvent,
  AiPlatform,
  AsrPlatform,
  SearchPlatform,
  AppSettings,
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
  OptimizeSuggestion,
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
  LibraryIngestPayload,
  LibraryIngestResult,
  LibraryList,
  LibrarySearchResult
} from './types';

export interface BsubApi {
  listTabs(): Promise<TabInfo[]>;
  newTab(url?: string): Promise<string>;
  closeTab(id: string): Promise<void>;
  activateTab(id: string): Promise<void>;
  navigate(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  stop(): Promise<void>;
  setLayout(rect: LayoutRect): void;
  onTabs(cb: (tabs: TabInfo[]) => void): () => void;

  getPageInfo(): Promise<Result<PageInfo>>;
  getSubtitles(): Promise<Result<SubtitleBundle>>;
  getTrackBody(url: string): Promise<Result<TrackBody>>;
  getTime(): Promise<Result<{ currentTime: number; duration: number }>>;
  seek(time: number): Promise<void>;

  ingestLibrary(payload: LibraryIngestPayload): Promise<Result<LibraryIngestResult>>;
  listLibrary(): Promise<Result<LibraryList>>;
  searchLibrary(query: string): Promise<Result<LibrarySearchResult>>;
  removeLibrary(id: number): Promise<Result<{ removed: boolean }>>;
  onLibraryChanged(cb: () => void): () => void;

  getSettings(): Promise<Result<SettingsSnapshot>>;
  saveSettings(next: AppSettings): Promise<Result<SettingsSnapshot>>;
  setSidebarWidth(width: number): Promise<Result<SettingsSnapshot>>;
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
  getBridgeStatus(): Promise<Result<BridgeStatus>>;
  writeClipboard(text: string): Promise<void>;

  getUpdateStatus(): Promise<Result<UpdateStatus>>;
  checkForUpdates(): Promise<Result<UpdateStatus>>;
  downloadUpdate(): Promise<Result<UpdateStatus>>;
  installUpdate(): Promise<void>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;

  summarize(payload: SummarizeRequest): Promise<Result<{ requestId: string }>>;
  cancelSummary(requestId: string): Promise<void>;
  getSummary(ref: SummaryRef): Promise<Result<StoredSummary | null>>;
  onAiDelta(cb: (event: AiDeltaEvent) => void): () => void;
  onAiDone(cb: (event: AiDoneEvent) => void): () => void;
  onAiError(cb: (event: AiErrorEvent) => void): () => void;
  onAiStatus(cb: (event: AiStatusEvent) => void): () => void;

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

  batchSummarize(videoIds: number[]): Promise<Result<{ requestId: string }>>;
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

  checkQuality(info: PageInfo, lines: SubtitleLine[]): Promise<Result<QualityReport>>;
  generateChapters(info: PageInfo, lines: SubtitleLine[]): Promise<Result<Chapter[]>>;

  testMcp(server: McpServer): Promise<Result<McpTool[]>>;
  callMcp(server: McpServer, name: string, args: Record<string, unknown>): Promise<Result<string>>;
  importSkill(): Promise<Result<SkillItem | null>>;

  exportVideo(payload: ExportPayload): Promise<Result<{ path: string } | { canceled: true }>>;

  zoomIn(): Promise<void>;
  zoomOut(): Promise<void>;
  zoomReset(): Promise<void>;
  findInPage(query: string, options?: { forward?: boolean; findNext?: boolean }): Promise<void>;
  stopFind(): Promise<void>;
  onFindResult(cb: (result: FindResult) => void): () => void;
}
