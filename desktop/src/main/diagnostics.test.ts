import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PageInfo, SubtitleTrack } from '../shared/types';

const state = vi.hoisted(() => ({ user: '', diag: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? state.user : state.user),
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    getLocale: () => 'zh-CN'
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showMessageBox: async () => ({ response: 1, checkboxChecked: false })
  },
  session: {
    defaultSession: {}
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`sealed:${text}`),
    decryptString: (buffer: Buffer) => buffer.toString().slice('sealed:'.length)
  }
}));

import { closeLibrary, ingestVideo, initLibrary } from './library';
import { exportDiagnostics } from './diagnostics';

const info: PageInfo = {
  kind: 'video',
  bvid: 'BV1diag00001',
  aid: 1,
  cid: 1,
  epId: null,
  seasonId: null,
  page: 1,
  partTitle: '',
  parts: [],
  title: '诊断测试视频',
  owner: '测试 UP',
  desc: '',
  duration: 10,
  url: 'https://www.bilibili.com/video/BV1diag00001',
  signature: 'v:BV1diag00001:1'
};

const track: SubtitleTrack = {
  lan: 'zh-CN',
  lanDoc: '中文',
  url: 'https://example.com/1.json',
  isAi: false,
  aiStatus: null,
  source: 'official'
};

describe('exportDiagnostics', () => {
  beforeAll(() => {
    state.user = fs.mkdtempSync(path.join(os.tmpdir(), 'bsub-diag-user-'));
    state.diag = fs.mkdtempSync(path.join(os.tmpdir(), 'bsub-diag-out-'));
    process.env.BSUB_DIAG_DIR = state.diag;
    initLibrary();
    ingestVideo({ info, track, lines: [{ start: 0, end: 1, text: '内容' }] });
  });

  afterAll(() => {
    closeLibrary();
    delete process.env.BSUB_DIAG_DIR;
    fs.rmSync(state.user, { recursive: true, force: true });
    fs.rmSync(state.diag, { recursive: true, force: true });
  });

  it('导出目录包含 summary.json、版本与数据规模，且不含正文', async () => {
    const result = await exportDiagnostics();
    expect(result.canceled).toBe(false);
    expect(result.path).toBeTruthy();
    const summaryFile = path.join(String(result.path), 'summary.json');
    expect(fs.existsSync(summaryFile)).toBe(true);

    const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
    expect(summary.app.version).toBe('0.0.0-test');
    expect(summary.data.schemaVersion).toBe(5);
    expect(summary.data.stats.videos).toBe(1);
    expect(summary.settings.ai.platforms.length).toBeGreaterThan(0);
    expect(JSON.stringify(summary)).not.toContain('sk-');
    expect(fs.existsSync(path.join(String(result.path), 'README.txt'))).toBe(true);
  });
});
