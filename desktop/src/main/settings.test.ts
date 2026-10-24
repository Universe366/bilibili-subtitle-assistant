import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: () => state.dir,
    getName: () => 'shizi',
    getVersion: () => '0.0.0'
  }
}));

import { loadSettings, saveSettings } from './settings';

describe('设置的持久化字段', () => {
  beforeAll(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-settings-'));
  });

  afterAll(() => {
    fs.rmSync(state.dir, { recursive: true, force: true });
  });

  it('桌宠 / 悬浮球 / 搜索引擎保存后不会丢', () => {
    const settings = loadSettings();
    settings.general.petEnabled = true;
    settings.general.assistantEnabled = true;
    settings.general.petX = 120;
    settings.general.petY = 80;
    settings.general.petSize = 140;
    settings.general.petOpacity = 0.7;
    settings.general.petSound = false;
    settings.general.petIdleTalk = false;
    settings.general.petAlwaysOnTop = false;
    settings.general.searchEngine = 'bing';
    settings.general.searchEngineCustom = 'https://s.example/?q={q}';
    saveSettings(settings);

    const reloaded = loadSettings();
    expect(reloaded.general.petEnabled).toBe(true);
    expect(reloaded.general.assistantEnabled).toBe(true);
    expect(reloaded.general.petX).toBe(120);
    expect(reloaded.general.petY).toBe(80);
    expect(reloaded.general.petSize).toBe(140);
    expect(reloaded.general.petOpacity).toBe(0.7);
    expect(reloaded.general.petSound).toBe(false);
    expect(reloaded.general.petIdleTalk).toBe(false);
    expect(reloaded.general.petAlwaysOnTop).toBe(false);
    expect(reloaded.general.searchEngine).toBe('bing');
    expect(reloaded.general.searchEngineCustom).toBe('https://s.example/?q={q}');
  });

  it('非法搜索引擎回退 B 站，坐标非法归零', () => {
    const settings = loadSettings();
    settings.general.searchEngine = 'nonsense' as unknown as 'bilibili';
    settings.general.petX = Number.NaN;
    settings.general.petY = -1;
    saveSettings(settings);
    const reloaded = loadSettings();
    expect(reloaded.general.searchEngine).toBe('bilibili');
    expect(reloaded.general.petX).toBe(0);
    expect(reloaded.general.petY).toBe(-1);
  });
});
