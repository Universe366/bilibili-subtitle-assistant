import type {
  AiDeltaEvent,
  AiDoneEvent,
  AiErrorEvent,
  AiPlatform,
  AppSettings,
  BridgeStatus,
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
  testAi(platform?: AiPlatform): Promise<Result<{ latencyMs: number; message: string }>>;
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

  exportVideo(payload: ExportPayload): Promise<Result<{ path: string } | { canceled: true }>>;
}
