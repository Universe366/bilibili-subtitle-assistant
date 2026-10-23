import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '' }
}));

import { migrateUserDataDirs } from './userDataMigration';

let root = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsub-migrate-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(file: string, content = 'x'): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

describe('userData 迁移', () => {
  it('把核心数据复制到 shizi，旧目录保留', () => {
    const legacy = path.join(root, 'bsub-desktop');
    write(path.join(legacy, 'settings.json'), '{"general":{}}');
    write(path.join(legacy, 'library.db'), 'db');
    write(path.join(legacy, 'Network', 'Cookies'), 'cookie');
    write(path.join(legacy, 'Cache', 'x.bin'), 'cache');

    const result = migrateUserDataDirs(root);
    expect(result.status).toBe('migrated');
    expect(fs.readFileSync(path.join(root, 'shizi', 'settings.json'), 'utf8')).toContain('general');
    expect(fs.readFileSync(path.join(root, 'shizi', 'library.db'), 'utf8')).toBe('db');
    expect(fs.existsSync(path.join(root, 'shizi', 'Network', 'Cookies'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'shizi', 'Cache'))).toBe(false);
    expect(fs.existsSync(path.join(legacy, 'settings.json'))).toBe(true);

    expect(migrateUserDataDirs(root).status).toBe('exists');
  });

  it('自定义数据目录只迁移指针', () => {
    const legacy = path.join(root, 'bsub-desktop');
    write(path.join(root, 'bsub-desktop-location.txt'), 'D:\\Data\\bsub');
    fs.mkdirSync(legacy, { recursive: true });

    const result = migrateUserDataDirs(root);
    expect(result.status).toBe('pointer');
    expect(fs.readFileSync(path.join(root, 'shizi-location.txt'), 'utf8')).toContain('Data');
  });

  it('旧目录没有可迁移数据时返回 failed 且不留下空目录', () => {
    fs.mkdirSync(path.join(root, 'bsub-desktop'), { recursive: true });
    const result = migrateUserDataDirs(root);
    expect(result.status).toBe('failed');
    expect(fs.existsSync(path.join(root, 'shizi'))).toBe(false);
  });
});
