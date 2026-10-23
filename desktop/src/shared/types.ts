export interface TabInfo {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  active: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  favicon?: string;
  suspended: boolean;
  zoom: number;
}

export interface FindResult {
  tabId: string;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
}

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Section =
  | 'subtitles'
  | 'summary'
  | 'chat'
  | 'library'
  | 'settings';

export interface VideoPart {
  index: number;
  cid: number;
  title: string;
  duration: number;
}

export interface PageInfo {
  ok?: boolean;
  kind: string;
  bvid: string | null;
  aid: number | null;
  cid: number | null;
  epId: number | null;
  seasonId: number | null;
  page: number;
  partTitle: string;
  parts: VideoPart[];
  title: string;
  owner: string;
  desc: string;
  duration: number;
  url: string;
  signature: string;
  cover?: string;
  stat?: { view: number; danmaku: number };
  pubdate?: number;
}

export interface SubtitleTrack {
  lan: string;
  lanDoc: string;
  url: string;
  isAi: boolean;
  aiStatus: number | null;
  source: string;
}

export interface SubtitleDiagnostics {
  groups?: string[];
  sniffed?: unknown[];
  foreignTracks?: Array<{
    from?: string;
    cid?: string;
    lan?: string;
    source?: string;
    url?: string;
  }>;
  sniffCount?: number;
  staleSniffCount?: number;
  signatureChanged?: boolean;
  identityMismatch?: boolean;
  identityUnstable?: boolean;
  reason?: string;
  /** 官方 player/v2 返回的轨数（交叉核对） */
  apiTrackCount?: number;
  /** 因与官方接口不一致被丢弃的轨数 */
  apiFiltered?: number;
}

export interface SubtitleBundle {
  needLogin: boolean;
  tracks: SubtitleTrack[];
  sources: string[];
  errors: Array<{ source?: string; code?: number | string; message?: string }>;
  identity?: string;
  diagnostics?: SubtitleDiagnostics;
}

export interface SubtitleTrackCheck {
  url: string;
  lanDoc: string;
  source: string;
  isAi: boolean;
  lines: number;
  lastEnd: number;
  coverage: number;
  ok: boolean;
  reason: string;
}

export interface SubtitleLine {
  start: number;
  end: number;
  text: string;
}

export interface TrackBody {
  lines: SubtitleLine[];
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface LibraryVideo {
  id: number;
  bvid: string | null;
  cid: number | null;
  title: string;
  owner: string;
  duration: number;
  cover: string | null;
  url: string;
  createdAt: number;
  updatedAt: number;
  /** 最后一次保存总结的时间；null 表示尚未总结 */
  summaryUpdatedAt: number | null;
  summaryModel?: string;
  tags: string[];
  collections: string[];
  trackCount: number;
  lineCount: number;
  /** 当前条目全部字幕轨的字符数（用于批量成本预估） */
  chars: number;
}

export interface LibraryTag {
  name: string;
  count: number;
}

export interface LibraryCollection {
  id: number;
  name: string;
  count: number;
}

export interface CollectionSummary {
  collectionId: number;
  content: string;
  model: string;
  itemCount: number;
  updatedAt: number;
}

export interface NoteVersionMeta {
  id: number;
  createdAt: number;
  chars: number;
}

export interface NoteVersion extends NoteVersionMeta {
  videoId: number;
  content: string;
}

export interface CollectionSummaryVersionMeta {
  id: number;
  model: string;
  itemCount: number;
  createdAt: number;
  chars: number;
}

export interface CollectionSummaryVersion extends CollectionSummaryVersionMeta {
  collectionId: number;
  content: string;
}

export interface ExportRecord {
  id: number;
  path: string;
  kind: string;
  title: string;
  createdAt: number;
}

export interface CollectionResolveItem {
  url: string;
  title: string;
  bvid: string;
  cid: number | null;
  page: number | null;
}

export interface CollectionResolveResult {
  kind: 'season' | 'pages' | 'single';
  title: string;
  total: number;
  items: CollectionResolveItem[];
  sourceUrl: string;
}

export interface LibraryStats {
  videos: number;
  tracks: number;
  segments: number;
  bytes: number;
}

export interface DiagnosticsLog {
  name: string;
  size: number;
  modified: number;
}

export interface DiagnosticsInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  dataDir: string;
  settingsPath: string;
  dbPath: string;
  logs: DiagnosticsLog[];
  library: LibraryStats;
}

export interface LibraryList {
  videos: LibraryVideo[];
  stats: LibraryStats;
  /** 库内视频总数（videos 可能因分页上限被截断） */
  total: number;
}

export interface LibraryNote {
  videoId: number;
  content: string;
  updatedAt: number;
}

export interface LibraryDetail {
  video: LibraryVideo;
  /** 没有入库字幕时（只存过总结）为 null */
  bundle: LibraryBundle | null;
  summary: StoredSummary | null;
  note: LibraryNote | null;
}

export type LibrarySort = 'updated' | 'created' | 'title' | 'duration';

export type JobType =
  | 'summary'
  | 'asr'
  | 'translate'
  | 'optimize'
  | 'batch-summary'
  | 'url-batch'
  | 'collection-summary';

export type JobStatus = 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

export type JobItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface JobItem {
  targetId: string;
  title: string;
  status: JobItemStatus;
  progress: number;
  message: string;
  error: string | null;
  updatedAt: number;
}

export interface JobRecord {
  id: string;
  type: JobType;
  title: string;
  status: JobStatus;
  progress: number;
  message: string;
  error: string | null;
  /** 任务参数（例如链接批量是否顺带总结），供“重试失败项”使用 */
  metaJson: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  items: JobItem[];
}

export interface LibraryHistoryItem {
  id: number;
  videoId: number;
  bvid: string | null;
  cid: number | null;
  title: string;
  owner: string;
  url: string;
  model: string;
  content: string;
  updatedAt: number;
}

export interface LibraryTranscriptionItem {
  videoId: number;
  bvid: string | null;
  title: string;
  owner: string;
  url: string;
  trackCount: number;
  lineCount: number;
  updatedAt: number;
  lanDoc: string;
}

export interface LibraryBundle {
  info: PageInfo;
  track: SubtitleTrack;
  lines: SubtitleLine[];
}

export interface Chapter {
  start: number;
  end: number;
  title: string;
}

export interface QualityIssue {
  code: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
  lineIndex?: number;
  start?: number;
  end?: number;
}

export interface QualityStats {
  lines: number;
  duration: number;
  coverage: number;
  charsPerSecond: number;
}

export interface QualityReport {
  issues: QualityIssue[];
  stats: QualityStats;
}

export interface BatchProgressEvent {
  requestId: string;
  percent: number;
  message: string;
}

export interface BatchDoneEvent {
  requestId: string;
  succeeded: number;
  failed: Array<{ videoId: number; title: string; error: string }>;
  /** 用户主动停止：已完成的条目仍然有效 */
  cancelled?: boolean;
}

export interface BatchErrorEvent {
  requestId: string;
  error: string;
}

export interface UrlBatchProgressEvent {
  requestId: string;
  index: number;
  total: number;
  url: string;
  title: string;
  stage: string;
  percent: number;
}

export interface UrlBatchDoneEvent {
  requestId: string;
  succeeded: number;
  failed: Array<{ url: string; title?: string; error: string }>;
  cancelled?: boolean;
}

export interface UrlBatchErrorEvent {
  requestId: string;
  error: string;
}

export interface LibraryIngestPayload {
  info: PageInfo;
  track: SubtitleTrack;
  lines: SubtitleLine[];
}

export interface LibraryIngestResult {
  videoId: number;
  trackId: number;
  lineCount: number;
  created: boolean;
}

export interface LibrarySearchMatch {
  videoId: number;
  bvid: string | null;
  title: string;
  owner: string;
  cover: string | null;
  url: string;
  start: number;
  end: number;
  text: string;
  lanDoc: string;
}

export interface LibrarySearchResult {
  query: string;
  /** 字幕正文命中的总条数 */
  total: number;
  matches: LibrarySearchMatch[];
  /** 标题 / UP 名命中的视频（字幕正文之外的第二类结果） */
  videos: LibraryVideo[];
  mode: 'fts' | 'like';
}

export interface SummarySearchHit {
  videoId: number;
  title: string;
  owner: string;
  url: string;
  bvid: string | null;
  cid: number | null;
  updatedAt: number;
  snippet: string;
}

export interface CollectionSearchHit {
  collectionId: number;
  name: string;
  snippet: string;
  updatedAt: number;
}

export interface GlobalSearchResult {
  query: string;
  items: LibraryVideo[];
  lines: LibrarySearchMatch[];
  summaries: SummarySearchHit[];
  collections: CollectionSearchHit[];
  total: number;
}

export interface AiPlatform {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  models?: string[];
  homepage?: string;
  keyUrl?: string;
  kind?: string;
}

export interface McpServer {
  id: string;
  name: string;
  url: string;
  token: string;
  headers: Record<string, string>;
  enabled: boolean;
  transport: 'http' | 'sse';
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema?: unknown;
}

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  body: string;
  enabled: boolean;
  source: 'builtin' | 'manual' | 'file';
}

export interface AsrPlatform {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  models?: string[];
  homepage?: string;
  keyUrl?: string;
  transport?: AsrTransport;
  paramStyle?: 'auto' | 'minimal' | 'full';
  audioFormat?: AsrFormat;
  keyField?: string;
}

export interface SearchPlatform {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  apiKey: string;
  homepage?: string;
  keyUrl?: string;
  reuseAiKey?: string;
}

export interface SearchSettings {
  enabled: boolean;
  activeId: string;
  platforms: SearchPlatform[];
  maxResults: number;
  includeContent: boolean;
  timeRange: SearchTimeRange;
  verify: boolean;
  verifySummary: boolean;
  verifyItemCount: number;
  keylessFallback: boolean;
  /** 无 Key 兜底引擎顺序：exa / anysearch / searxng */
  keylessOrder: string[];
  cacheMinutes: number;
  autoSearchOnChat: boolean;
  alwaysSearchOnChat: boolean;
  useVideoMeta: boolean;
  useComments: boolean;
  /** 总结前让 AI 从字幕里挑「实体 + 具体说法」生成检索词 */
  aiQueryGeneration: boolean;
  /** 用户补充的核实查询，每行一条 */
  extraVerifyQueries: string;
}

export type AsrTransport = 'auto' | 'multipart' | 'base64-json' | 'chat-audio';
export type AsrFormat = 'auto' | 'm4a' | 'wav';

export interface AsrSettings {
  activeId: string;
  platforms: AsrPlatform[];
  language: string;
  chunkSeconds: number;
  transport: AsrTransport;
  audioFormat: AsrFormat;
  concurrency: number;
  timeoutSeconds: number;
  maxFileMb: number;
  overlapSeconds: number;
  autoOptimizeAfter: boolean;
  autoApplyAfter: boolean;
}

export interface PromptTemplate {
  id: string;
  name: string;
  text: string;
}

export type SearchTimeRange = 'any' | 'year' | 'month' | 'week';

export interface WebReference {
  title: string;
  url: string;
  snippet: string;
}

export type VerifyVerdict = 'support' | 'refute' | 'irrelevant';

export interface VerifiedReference extends WebReference {
  verdict?: VerifyVerdict;
  /** 可注册域，用于「多来源一致 / 冲突」统计 */
  site?: string;
  consistency?: 'multi' | 'single' | 'conflict';
}

export interface VerificationItem {
  label?: string;
  query: string;
  line: string;
  context?: string;
  references: VerifiedReference[];
}

export interface VerificationSummary {
  items: VerificationItem[];
  references: VerifiedReference[];
  supplements: string[];
  attempted: number;
  failed: number;
  judged: boolean;
  dropped: number;
  error?: string;
}

export interface CorrectionRule {
  id: string;
  pattern: string;
  replacement: string;
  regex: boolean;
  caseSensitive: boolean;
}

export interface CorrectionRuleGroup {
  id: string;
  name: string;
  enabled: boolean;
  rules: CorrectionRule[];
}

export interface GlossaryTerm {
  id: string;
  from: string;
  to: string;
  note: string;
}

export type ThemeMode = 'system' | 'light' | 'dark';

export interface AppSettings {
  general: {
    theme: ThemeMode;
    closeToTray: boolean;
    suspendMinutes: number;
    cacheSubtitles: boolean;
    /** 字幕正文缓存天数（0 = 不缓存） */
    subtitleCacheDays: number;
    fontScale: number;
    sidebarWidth: number;
    sidebarPosition: 'left' | 'right';
    sidebarCollapsed: boolean;
    autoFollow: boolean;
    /** 首次使用向导是否已完成 */
    wizardDone: boolean;
  };
  ai: {
    activeId: string;
    platforms: AiPlatform[];
    temperature: number;
    maxTokens: number;
    stream: boolean;
    preProofread: boolean;
    sendOnEnter: boolean;
    expandReasoning: boolean;
    presetVersion: number;
  };
  asr: AsrSettings;
  prompt: {
    activeId: string;
    templates: PromptTemplate[];
    chat: string;
    translate: string;
    optimize: string;
    chapters: string;
  };
  mcp: {
    enabled: boolean;
    servers: McpServer[];
    callTimeoutMs: number;
    maxToolRounds: number;
  };
  skills: {
    enabled: boolean;
    builtinVersion: number;
    items: SkillItem[];
  };
  search: SearchSettings;
  correction: {
    enabled: boolean;
    groups: CorrectionRuleGroup[];
    glossary: {
      enabled: boolean;
      terms: GlossaryTerm[];
    };
  };
  export: {
    format: ExportFormat;
    includeTimestamps: boolean;
    filenamePattern: string;
    template: ExportTemplate;
    assFontSize: number;
    estimateTimestamps: boolean;
  };
  bridge: {
    enabled: boolean;
    port: number;
    token: string;
  };
  update: {
    autoCheck: boolean;
    autoDownload: boolean;
    feedUrl: string;
    skippedVersion: string;
  };
  dataDir: string;
}

export type UpdateState =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  version?: string;
  progress?: number;
  error?: string;
  notes?: string;
  manual?: boolean;
  checkedAt?: number;
}

export interface BridgeStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  token: string;
  error?: string;
}

export interface SettingsSnapshot {
  settings: AppSettings;
  dataDir: string;
  version: string;
}

export type ExportFormat = 'md' | 'srt' | 'vtt' | 'ass' | 'txt' | 'json';
export type ExportTemplate = 'plain' | 'timestamped' | 'notes' | 'meeting';

export interface ExportPayload {
  format: ExportFormat;
  info: PageInfo;
  track: SubtitleTrack | null;
  lines: SubtitleLine[];
  summary?: string;
  savePath?: string;
  includeTimestamps?: boolean;
  filenamePattern?: string;
  translatedLines?: SubtitleLine[];
  translationLanguage?: string;
  template?: ExportTemplate;
  assFontSize?: number;
  estimateTimestamps?: boolean;
}

export interface SaveTextPayload {
  content: string;
  filename?: string;
  /** 指定路径时跳过保存对话框（测试/自动化用） */
  savePath?: string;
}

export type SaveTextResult = { path: string } | { canceled: true };

export interface AiDeltaEvent {
  requestId: string;
  delta: string;
}

export interface AiStatusEvent {
  requestId: string;
  status: string;
}

export interface AiReasoningEvent {
  requestId: string;
  delta: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  reasoning?: string;
}

export interface ChatRequest {
  requestId: string;
  info: PageInfo;
  lines: SubtitleLine[];
  messages: ChatMessage[];
  skillIds?: string[];
}

export interface ChatDeltaEvent {
  requestId: string;
  delta: string;
  reasoning?: string;
}

export interface ChatDoneEvent {
  requestId: string;
  text: string;
  model: string;
  reasoning?: string;
}

export interface ChatErrorEvent {
  requestId: string;
  error: string;
}

export type AsrStage = 'prepare' | 'download' | 'convert' | 'transcribe' | 'merge';

export interface AsrProgressEvent {
  requestId: string;
  stage: AsrStage;
  percent: number;
  message: string;
}

export interface AsrDoneEvent {
  requestId: string;
  lines: SubtitleLine[];
  model: string;
  duration: number;
}

export interface AsrErrorEvent {
  requestId: string;
  error: string;
}

export interface TranslateRequest {
  requestId: string;
  lines: SubtitleLine[];
  target: string;
}

export interface TranslateProgressEvent {
  requestId: string;
  percent: number;
  message: string;
}

export interface TranslateDoneEvent {
  requestId: string;
  lines: SubtitleLine[];
  language: string;
}

export interface TranslateErrorEvent {
  requestId: string;
  error: string;
}

export interface OptimizeSuggestion {
  index: number;
  original: string;
  suggestion: string;
  verdict?: 'support' | 'refute' | 'unknown';
  evidence?: string;
  sources?: number;
  supportCount?: number;
  refuteCount?: number;
  consistency?: 'multi' | 'single' | 'conflict';
}

export interface OptimizeProgressEvent {
  requestId: string;
  percent: number;
  message: string;
}

export interface OptimizeDoneEvent {
  requestId: string;
  suggestions: OptimizeSuggestion[];
}

export interface OptimizeErrorEvent {
  requestId: string;
  error: string;
}

export interface SummarizeRequest {
  requestId?: string;
  info: PageInfo;
  lines: SubtitleLine[];
  /** 跳过「先校对字幕」直接生成（快速总结） */
  skipProofread?: boolean;
}

export interface AiDoneEvent {
  requestId: string;
  text: string;
  model: string;
  verification?: VerificationSummary;
}

export interface AiErrorEvent {
  requestId: string;
  error: string;
}

export interface SummaryRef {
  bvid: string | null;
  cid: number | null;
  epId: number | null;
}

export interface StoredSummary {
  content: string;
  model: string;
  updatedAt: number;
}

export interface SummaryVersionMeta {
  id: number;
  model: string;
  createdAt: number;
  chars: number;
}

export interface SummaryVersion extends SummaryVersionMeta {
  videoId: number;
  content: string;
}


