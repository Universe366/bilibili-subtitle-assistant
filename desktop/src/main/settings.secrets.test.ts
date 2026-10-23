import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: () => state.dir,
    getVersion: () => '0.0.0-test'
  },
  session: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`sealed:${text}`),
    decryptString: (buffer: Buffer) => buffer.toString().slice('sealed:'.length)
  }
}));

import {
  DEFAULT_SETTINGS,
  loadSettings,
  migrateSettingsSecrets,
  restoreSettingsFromBackup,
  saveSettings,
  settingsForExport
} from './settings';

function settingsFile(): string {
  return path.join(state.dir, 'settings.json');
}

function seedPlaintext(apiKey: string, token = 'bridge-token'): void {
  const raw = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  raw.ai.platforms[0].apiKey = apiKey;
  raw.bridge.token = token;
  fs.writeFileSync(settingsFile(), JSON.stringify(raw, null, 2), 'utf8');
}

describe('settings 密钥加密', () => {
  beforeAll(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsub-settings-'));
  });

  afterAll(() => {
    fs.rmSync(state.dir, { recursive: true, force: true });
  });

  it('老版本明文 Key 能读出来，并在迁移时加密落盘', () => {
    seedPlaintext('sk-legacy-123456');
    expect(loadSettings().ai.platforms[0].apiKey).toBe('sk-legacy-123456');

    const migrated = migrateSettingsSecrets();
    expect(migrated).toBeGreaterThan(0);

    const disk = fs.readFileSync(settingsFile(), 'utf8');
    expect(disk).not.toContain('sk-legacy-123456');
    expect(disk).toContain('enc:v1:');
    expect(loadSettings().ai.platforms[0].apiKey).toBe('sk-legacy-123456');
  });

  it('保存新 Key 时只写密文，读回来仍是明文', () => {
    seedPlaintext('sk-old-000000');
    const settings = loadSettings();
    settings.ai.platforms[0].apiKey = 'sk-new-999999';
    saveSettings(settings);

    const disk = fs.readFileSync(settingsFile(), 'utf8');
    expect(disk).not.toContain('sk-new-999999');
    expect(loadSettings().ai.platforms[0].apiKey).toBe('sk-new-999999');
  });

  it('导出设置和备份副本都不带 Key / 桥 Token', () => {
    seedPlaintext('sk-secret-abcdef');
    const exported = settingsForExport();
    expect(exported.ai.platforms[0].apiKey).toBe('');
    expect(exported.bridge.token).toBe('');
  });

  it('从备份恢复时保留本机已有的 Key', () => {
    seedPlaintext('sk-keep-me');
    const backup = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    backup.ai.platforms[0].apiKey = '';
    backup.bridge.token = '';

    restoreSettingsFromBackup(backup);
    expect(loadSettings().ai.platforms[0].apiKey).toBe('sk-keep-me');
  });
});
