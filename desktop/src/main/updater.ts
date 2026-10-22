import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateInfo } from 'electron-updater';
import type { UpdateStatus } from '../shared/types';
import { loadSettings } from './settings';

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

  const feedUrl = String(process.env.BSUB_UPDATE_URL || settings.update.feedUrl || '').trim();
  if (feedUrl) {
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
      console.log('[update] 使用自定义更新源', feedUrl);
    } catch (error) {
      console.warn('[update] 设置更新源失败:', (error as Error).message);
    }
  }

  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking', error: undefined }));
  autoUpdater.on('update-available', (info) => {
    console.log('[update] available', info.version);
    setStatus({
      state: 'available',
      version: info.version,
      notes: notesOf(info),
      checkedAt: Date.now(),
      error: undefined
    });
    if (settings.update.autoDownload === true) {
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
    setStatus({ state: 'checking', manual, error: undefined });
    await autoUpdater.checkForUpdates();
  } catch (error) {
    setStatus({
      state: 'error',
      error: (error as Error).message,
      manual,
      checkedAt: Date.now()
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

export function updateStatus(): UpdateStatus {
  return status;
}

export function disposeUpdater(): void {
  if (timer) clearInterval(timer);
  timer = null;
  initialized = false;
}
