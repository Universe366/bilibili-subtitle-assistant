import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { BsubApi } from '../shared/api';
import type {
  AiDeltaEvent,
  AiDoneEvent,
  AiErrorEvent,
  AiPlatform,
  AppSettings,
  BridgeStatus,
  ExportPayload,
  LayoutRect,
  PageInfo,
  Result,
  SettingsSnapshot,
  StoredSummary,
  SubtitleBundle,
  SubtitleLine,
  SummarizeRequest,
  SummaryRef,
  TabInfo,
  TrackBody,
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
  setLayout: (rect: LayoutRect) => ipcRenderer.send('layout:set', rect),
  onTabs: (cb: (tabs: TabInfo[]) => void) => on<TabInfo[]>('tabs:changed', cb),

  getPageInfo: () => ipcRenderer.invoke('page:info') as Promise<Result<PageInfo>>,
  getSubtitles: () => ipcRenderer.invoke('page:subtitles') as Promise<Result<SubtitleBundle>>,
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
  saveSettings: (next: AppSettings) =>
    ipcRenderer.invoke('settings:set', next) as Promise<Result<SettingsSnapshot>>,
  testAi: (platform?: AiPlatform) =>
    ipcRenderer.invoke('settings:test', platform) as Promise<
      Result<{ latencyMs: number; message: string }>
    >,
  openDataDir: () => ipcRenderer.invoke('settings:open-data') as Promise<void>,
  getBridgeStatus: () =>
    ipcRenderer.invoke('bridge:status') as Promise<Result<BridgeStatus>>,
  writeClipboard: (text: string) =>
    ipcRenderer.invoke('clipboard:write', text) as Promise<void>,

  summarize: (payload: SummarizeRequest) =>
    ipcRenderer.invoke('ai:summarize', payload) as Promise<Result<{ requestId: string }>>,
  cancelSummary: (requestId: string) =>
    ipcRenderer.invoke('ai:cancel', requestId) as Promise<void>,
  getSummary: (ref: SummaryRef) =>
    ipcRenderer.invoke('library:get-summary', ref) as Promise<Result<StoredSummary | null>>,
  onAiDelta: (cb: (event: AiDeltaEvent) => void) => on<AiDeltaEvent>('ai:delta', cb),
  onAiDone: (cb: (event: AiDoneEvent) => void) => on<AiDoneEvent>('ai:done', cb),
  onAiError: (cb: (event: AiErrorEvent) => void) => on<AiErrorEvent>('ai:error', cb),

  exportVideo: (payload: ExportPayload) =>
    ipcRenderer.invoke('export:save', payload) as Promise<
      Result<{ path: string } | { canceled: true }>
    >
};

contextBridge.exposeInMainWorld('bsub', api);
