import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { BsubApi } from '../shared/api';
import type {
  AiDeltaEvent,
  AiDoneEvent,
  AiErrorEvent,
  AiStatusEvent,
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
  ExportPayload,
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
  LibrarySearchResult
} from '../shared/types';

const on = <T>(channel: string, cb: (payload: T) => void) => {
  const handler = (_event: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const api: BsubApi = {
  listTabs: () => ipcRenderer.invoke('tabs:list') as Promise<TabInfo[]>,
  newTab: (url?: string) => ipcRenderer.invoke('tab:new', url) as Promise<string>,
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

  getPageInfo: () => ipcRenderer.invoke('page:info') as Promise<Result<PageInfo>>,
  getSubtitles: (expectSignature?: string) =>
    ipcRenderer.invoke('page:subtitles', expectSignature) as Promise<Result<SubtitleBundle>>,
  getTrackBody: (url: string) => ipcRenderer.invoke('page:track-body', url) as Promise<Result<TrackBody>>,
  getTime: () =>
    ipcRenderer.invoke('page:time') as Promise<Result<{ currentTime: number; duration: number }>>,
  seek: (time: number) => ipcRenderer.invoke('page:seek', time) as Promise<void>,

  ingestLibrary: (payload: LibraryIngestPayload) =>
    ipcRenderer.invoke('library:ingest', payload) as Promise<Result<LibraryIngestResult>>,
  listLibrary: () => ipcRenderer.invoke('library:list') as Promise<Result<LibraryList>>,
  searchLibrary: (query: string) =>
    ipcRenderer.invoke('library:search', query) as Promise<Result<LibrarySearchResult>>,
  removeLibrary: (id: number) =>
    ipcRenderer.invoke('library:remove', id) as Promise<Result<{ removed: boolean }>>,
  onLibraryChanged: (cb: () => void) => on<null>('library:changed', () => cb()),

  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<Result<SettingsSnapshot>>,
  getDiagnostics: () => ipcRenderer.invoke('diagnostics:get') as Promise<Result<DiagnosticsInfo>>,
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
  getBridgeStatus: () =>
    ipcRenderer.invoke('bridge:status') as Promise<Result<BridgeStatus>>,
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
  onAiDelta: (cb: (event: AiDeltaEvent) => void) => on<AiDeltaEvent>('ai:delta', cb),
  onAiDone: (cb: (event: AiDoneEvent) => void) => on<AiDoneEvent>('ai:done', cb),
  onAiError: (cb: (event: AiErrorEvent) => void) => on<AiErrorEvent>('ai:error', cb),
  onAiStatus: (cb: (event: AiStatusEvent) => void) => on<AiStatusEvent>('ai:status', cb),

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

  batchSummarize: (videoIds: number[]) =>
    ipcRenderer.invoke('batch:summarize', { videoIds }) as Promise<
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

  exportVideo: (payload: ExportPayload) =>
    ipcRenderer.invoke('export:save', payload) as Promise<
      Result<{ path: string } | { canceled: true }>
    >
};

contextBridge.exposeInMainWorld('bsub', api);
