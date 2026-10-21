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
  | 'chat'
  | 'summary'
  | 'library'
  | 'batch'
  | 'history'
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
  foreignTracks?: Array<{ cid?: string; source?: string; url?: string }>;
  sniffCount?: number;
  staleSniffCount?: number;
  signatureChanged?: boolean;
  identityMismatch?: boolean;
  identityUnstable?: boolean;
  reason?: string;
}

export interface SubtitleBundle {
  needLogin: boolean;
  tracks: SubtitleTrack[];
  sources: string[];
  errors: Array<{ source?: string; message?: string }>;
  identity?: string;
  diagnostics?: SubtitleDiagnostics;
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
  updatedAt: number;
  trackCount: number;
  lineCount: number;
}

export interface LibraryStats {
  videos: number;
  tracks: number;
  segments: number;
  bytes: number;
}

export interface LibraryList {
  videos: LibraryVideo[];
  stats: LibraryStats;
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
}

export interface BatchErrorEvent {
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
  total: number;
  matches: LibrarySearchMatch[];
  mode: 'fts' | 'like';
}

export interface AiPlatform {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
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
}

export interface PromptTemplate {
  id: string;
  name: string;
  text: string;
}

export type SearchProvider = 'anysearch' | 'exa' | 'tavily' | 'brave';
export type SearchTimeRange = 'any' | 'year' | 'month' | 'week';

export interface WebReference {
  title: string;
  url: string;
  snippet: string;
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
  };
  ai: {
    activeId: string;
    platforms: AiPlatform[];
    temperature: number;
    maxTokens: number;
    stream: boolean;
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
  };
  skills: {
    enabled: boolean;
    items: SkillItem[];
  };
  search: {
    enabled: boolean;
    provider: SearchProvider;
    apiKey: string;
    maxResults: number;
    includeContent: boolean;
    timeRange: SearchTimeRange;
    verify: boolean;
  };
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
  };
  bridge: {
    enabled: boolean;
    port: number;
    token: string;
  };
  update: {
    autoCheck: boolean;
    feedUrl: string;
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
}

export interface AiDeltaEvent {
  requestId: string;
  delta: string;
}

export interface AiStatusEvent {
  requestId: string;
  status: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  requestId: string;
  info: PageInfo;
  lines: SubtitleLine[];
  messages: ChatMessage[];
}

export interface ChatDeltaEvent {
  requestId: string;
  delta: string;
}

export interface ChatDoneEvent {
  requestId: string;
  text: string;
  model: string;
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
}

export interface AiDoneEvent {
  requestId: string;
  text: string;
  model: string;
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


