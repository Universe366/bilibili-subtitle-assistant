import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PageInfo, SubtitleTrack } from '../shared/types';

const state = vi.hoisted(() => ({ user: '', out: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? state.user : state.user),
    getVersion: () => '0.0.0-test',
    relaunch: () => undefined,
    exit: () => undefined
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: '' })
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`sealed:${text}`),
    decryptString: (buffer: Buffer) => buffer.toString().slice('sealed:'.length)
  }
}));

import {
  closeLibrary,
  getLibraryDetail,
  ingestVideo,
  initLibrary,
  listLibrary,
  removeVideos,
  saveSummary
} from './library';
import { backupData, restoreData } from './backup';
import { loadSettings, saveSettings } from './settings';

const info: PageInfo = {
  kind: 'video',
  bvid: 'BV1backup0001',
  aid: 1,
  cid: 1,
  epId: null,
  seasonId: null,
  page: 1,
  partTitle: '',
  parts: [],
  title: '备份测试视频',
  owner: '测试 UP',
  desc: '',
  duration: 10,
  url: 'https://www.bilibili.com/video/BV1backup0001',
  signature: 'v:BV1backup0001:1'
};

const track: SubtitleTrack = {
  lan: 'zh-CN',
  lanDoc: '中文',
  url: 'https://example.com/1.json',
  isAi: false,
  aiStatus: null,
  source: 'official'
};

describe('backupData / restoreData', () => {
  beforeAll(() => {
    state.user = fs.mkdtempSync(path.join(os.tmpdir(), 'bsub-backup-user-'));
    state.out = fs.mkdtempSync(path.join(os.tmpdir(), 'bsub-backup-out-'));
    process.env.BSUB_BACKUP_DIR = state.out;
    process.env.BSUB_RESTORE_NO_RELAUNCH = '1';
    initLibrary();
    const ingested = ingestVideo({
      info,
      track,
      lines: [{ start: 0, end: 1, text: '备份字幕' }]
    });
    saveSummary(info, '# 备份总结', 'test-model');
    expect(ingested.videoId).toBeGreaterThan(0);
    const settings = loadSettings();
    settings.ai.platforms[0].apiKey = 'sk-backup-secret';
    saveSettings(settings);
  });

  afterAll(() => {
    closeLibrary();
    delete process.env.BSUB_BACKUP_DIR;
    delete process.env.BSUB_RESTORE_DIR;
    delete process.env.BSUB_RESTORE_NO_RELAUNCH;
    fs.rmSync(state.user, { recursive: true, force: true });
    fs.rmSync(state.out, { recursive: true, force: true });
  });

  it('备份不含 Key，恢复后库和本机 Key 都正确', async () => {
    const backup = await backupData();
    expect(backup.canceled).toBe(false);
    const dir = String(backup.path);
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    expect(manifest.version).toBe(2);
    expect(manifest.files['library.db'].sha256).toMatch(/^[a-f0-9]{64}$/);

    const settingsText = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
    expect(settingsText).not.toContain('sk-backup-secret');
    expect(JSON.parse(settingsText).ai.platforms[0].apiKey).toBe('');

    const videoId = listLibrary().videos[0].id;
    removeVideos([videoId]);
    expect(listLibrary().videos).toHaveLength(0);

    process.env.BSUB_RESTORE_DIR = dir;
    const restored = await restoreData();
    expect(restored.canceled).toBe(false);
    expect(restored.restored).toBe(true);

    const videos = listLibrary().videos;
    expect(videos).toHaveLength(1);
    expect(getLibraryDetail(videos[0].id).summary?.content).toContain('备份总结');
    expect(loadSettings().ai.platforms[0].apiKey).toBe('sk-backup-secret');
  });

  it('备份文件被篡改时拒绝恢复', async () => {
    const backup = await backupData();
    const dir = String(backup.path);
    fs.appendFileSync(path.join(dir, 'library.db'), Buffer.from([0]));
    process.env.BSUB_RESTORE_DIR = dir;
    await expect(restoreData()).rejects.toThrow(/校验失败/);
  });
});
