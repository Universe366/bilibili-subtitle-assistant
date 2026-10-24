import { app, net } from 'electron';
import type { BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateInfo } from 'electron-updater';
import type { UpdateStatus } from '../shared/types';
import { loadSettings, saveSettings } from './settings';
import { githubFeedUrl, normalizeFeedBase, resolveFeed, type ProbeResult } from './updateFeed';

let win: BrowserWindow | null = null;
let status: UpdateStatus = {
  state: 'idle',
  currentVersion: app.getVersion()
};
let timer: NodeJS.Timeout | null = null;
let initialized = false;

function send(): void {
  if (win && !win.isDestroyed()) win.webContents.send('update:status', status);
}

function setStatus(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch };
  send();
}

function notesOf(info: UpdateInfo): string {
  const notes = info.releaseNotes;
  if (typeof notes === 'string') return notes.slice(0, 2000);
  if (Array.isArray(notes)) {
    return notes
      .map((item) => (item && item.note ? String(item.note) : ''))
      .join('\n')
      .slice(0, 2000);
  }
  return '';
}

const REPO = 'Universe366/shizi';

let currentSource: 'github' | 'mirror' | 'custom' = 'github';

/** 用 HEAD 请求给更新源测速；超时或非 2xx 视为不可用。 */
async function probeFeed(base: string, timeoutMs = 2500): Promise<ProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await net.fetch(`${normalizeFeedBase(base)}/latest.yml`, {
      method: 'HEAD',
      signal: controller.signal
    });
    return { ok: response.ok, ms: Date.now() - started };
  } catch {
    return { ok: false, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function useFeed(source: 'github' | 'mirror' | 'custom', url: string | null): void {
  currentSource = source;
  if (source === 'custom' && url) {
    autoUpdater.setFeedURL({ provider: 'generic', url });
    console.log('[update] 使用自定义更新源', url);
    return;
  }
  if (source === 'mirror' && url) {
    autoUpdater.setFeedURL({ provider: 'generic', url });
    console.log('[update] 使用镜像更新源', url);
    return;
  }
  autoUpdater.setFeedURL({ provider: 'github', owner: 'Universe366', repo: 'shizi' });
}

/** 每次检查前决定用哪个源：显式配置 > 自动测速 > GitHub。 */
async function applyFeed(): Promise<void> {
  const settings = loadSettings();
  const envUrl = String(process.env.BSUB_UPDATE_URL || '').trim();
  const customUrl = String(settings.update.feedUrl || '').trim();
  const mirrorUrl = String(settings.update.mirrorUrl || '').trim();

  if (envUrl || customUrl) {
    useFeed('custom', normalizeFeedBase(envUrl || customUrl));
    return;
  }
  if (!mirrorUrl) {
    useFeed('github', null);
    return;
  }
  if (settings.update.autoFallback !== true) {
    useFeed('mirror', normalizeFeedBase(mirrorUrl));
    return;
  }

  const [github, mirror] = await Promise.all([
    probeFeed(githubFeedUrl(REPO)),
    probeFeed(mirrorUrl)
  ]);
  const choice = resolveFeed({
    mirrorUrl,
    autoFallback: true,
    github,
    mirror
  });
  useFeed(choice.source, choice.url);
  console.log(
    '[update] source',
    choice.source,
    `github=${github.ok ? github.ms + 'ms' : 'fail'}`,
    `mirror=${mirror.ok ? mirror.ms + 'ms' : 'fail'}`
  );
}

export function initUpdater(window: BrowserWindow): void {
  if (initialized) return;
  initialized = true;
  win = window;

  const settings = loadSettings();
  if (!app.isPackaged && process.env.BSUB_UPDATE_TEST !== '1') {
    setStatus({ state: 'disabled', error: '开发模式不检查更新' });
    return;
  }

  autoUpdater.autoDownload = settings.update.autoDownload === true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = console;
  if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true;



  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking', error: undefined }));
  autoUpdater.on('update-available', (info) => {
    console.log('[update] available', info.version);
    const latest = loadSettings();
    if (!status.manual && latest.update.skippedVersion === info.version) {
      setStatus({
        state: 'not-available',
        version: info.version,
        checkedAt: Date.now(),
        error: undefined
      });
      return;
    }
    setStatus({
      state: 'available',
      version: info.version,
      notes: notesOf(info),
      checkedAt: Date.now(),
      error: undefined
    });
    if (latest.update.autoDownload === true) {
      void downloadUpdate();
    }
  });
  autoUpdater.on('update-not-available', (info) => {
    console.log('[update] not available', info.version);
    setStatus({
      state: 'not-available',
      version: info.version,
      checkedAt: Date.now(),
      error: undefined
    });
  });
  autoUpdater.on('download-progress', (progress) => {
    setStatus({ state: 'downloading', progress: Math.round(progress.percent || 0) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[update] downloaded', info.version);
    setStatus({ state: 'downloaded', version: info.version, progress: 100 });
  });
  autoUpdater.on('error', (error) => {
    console.warn('[update] error', error.message);
    setStatus({ state: 'error', error: error.message });
  });

  if (settings.update.autoCheck !== false) {
    setTimeout(() => {
      void checkForUpdates(false);
    }, 15000);
    timer = setInterval(() => {
      void checkForUpdates(false);
    }, 6 * 60 * 60 * 1000);
    timer.unref?.();
  } else if (process.env.BSUB_UPDATE_TEST === '1') {
    setTimeout(() => {
      void checkForUpdates(false);
    }, 5000);
  }
}

export async function checkForUpdates(manual = true): Promise<UpdateStatus> {
  if (status.state === 'disabled') return status;
  try {
    await applyFeed();
    setStatus({ state: 'checking', manual, error: undefined, source: currentSource });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      const settings = loadSettings();
      const mirror = normalizeFeedBase(settings.update.mirrorUrl || '');
      const explicit = Boolean(process.env.BSUB_UPDATE_URL || settings.update.feedUrl);
      if (!mirror || explicit || currentSource === 'custom') throw error;

      const alternate = currentSource === 'mirror' ? 'github' : 'mirror';
      console.warn('[update] 当前源失败，切换重试:', (error as Error).message);
      useFeed(alternate, alternate === 'mirror' ? mirror : null);
      setStatus({ source: currentSource });
      await autoUpdater.checkForUpdates();
    }
  } catch (error) {
    setStatus({
      state: 'error',
      error: (error as Error).message,
      manual,
      checkedAt: Date.now(),
      source: currentSource
    });
  }
  return status;
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (status.state !== 'available') return status;
  try {
    setStatus({ state: 'downloading', progress: 0 });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    setStatus({ state: 'error', error: (error as Error).message });
  }
  return status;
}

export function installUpdate(): void {
  if (status.state !== 'downloaded') return;
  autoUpdater.quitAndInstall(false, true);
}

export function skipUpdate(version: string): UpdateStatus {
  const settings = loadSettings();
  settings.update.skippedVersion = String(version || '').trim();
  saveSettings(settings);
  setStatus({
    state: 'not-available',
    version: settings.update.skippedVersion,
    checkedAt: Date.now(),
    error: undefined
  });
  return status;
}

export function updateStatus(): UpdateStatus {
  return status;
}

export function disposeUpdater(): void {
  if (timer) clearInterval(timer);
  timer = null;
  initialized = false;
}
