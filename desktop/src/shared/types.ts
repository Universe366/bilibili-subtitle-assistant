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
}

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Section = 'subtitles' | 'summary' | 'library' | 'settings';

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

export interface SubtitleBundle {
  needLogin: boolean;
  tracks: SubtitleTrack[];
  sources: string[];
  errors: Array<{ source?: string; message?: string }>;
  identity?: string;
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

export interface AppSettings {
  ai: {
    activeId: string;
    platforms: AiPlatform[];
  };
  prompt: {
    summary: string;
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

export type ExportFormat = 'md' | 'srt' | 'txt' | 'json';

export interface ExportPayload {
  format: ExportFormat;
  info: PageInfo;
  track: SubtitleTrack | null;
  lines: SubtitleLine[];
  summary?: string;
  savePath?: string;
}

export interface AiDeltaEvent {
  requestId: string;
  delta: string;
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


