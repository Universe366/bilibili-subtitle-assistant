import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * 0.33.0 起产品名/包名从 bsub-desktop 改为 shizi，userData 默认目录随之变化。
 *
 * 首次启动时把旧目录里的核心数据复制到新目录：
 * - 只复制设置、库、权限、会话、登录态和日志，不复制可再生成的缓存；
 * - 先写临时目录，成功后再改名，避免半成品目录；
 * - 旧目录保留，作为回退；
 * - 如果用户迁移过数据目录（存在 location 指针），只迁移指针，不动自定义目录。
 */
export const LEGACY_DIR_NAME = 'bsub-desktop';
export const CURRENT_DIR_NAME = 'shizi';

const FILES = [
  'settings.json',
  'library.db',
  'library.db-wal',
  'library.db-shm',
  'permissions.json',
  'session.json',
  'startup.log',
  'fatal.log'
];
const DIRS = ['Network', 'Local Storage', 'logs'];

export type MigrationStatus = 'none' | 'migrated' | 'exists' | 'pointer' | 'failed';

export interface MigrationResult {
  status: MigrationStatus;
  target?: string;
  error?: string;
}

export function migrateUserDataDirs(appData: string): MigrationResult {
  const legacyDir = path.join(appData, LEGACY_DIR_NAME);
  const targetDir = path.join(appData, CURRENT_DIR_NAME);
  if (!fs.existsSync(legacyDir)) return { status: 'none' };

  const legacyPointer = path.join(appData, `${LEGACY_DIR_NAME}-location.txt`);
  const currentPointer = path.join(appData, `${CURRENT_DIR_NAME}-location.txt`);
  try {
    if (fs.existsSync(legacyPointer)) {
      if (!fs.existsSync(currentPointer)) fs.copyFileSync(legacyPointer, currentPointer);
      const target = fs.readFileSync(legacyPointer, 'utf8').trim();
      return { status: 'pointer', target: target || undefined };
    }

    if (fs.existsSync(targetDir)) {
      // 空目录视为上次失败留下的壳，可以安全重建；非空目录不覆盖。
      if (fs.readdirSync(targetDir).length > 0) return { status: 'exists', target: targetDir };
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    const tempDir = `${targetDir}.migrating`;
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });
    let copied = 0;
    for (const name of FILES) {
      const source = path.join(legacyDir, name);
      if (!fs.existsSync(source)) continue;
      fs.copyFileSync(source, path.join(tempDir, name));
      copied += 1;
    }
    for (const name of DIRS) {
      const source = path.join(legacyDir, name);
      if (!fs.existsSync(source)) continue;
      fs.cpSync(source, path.join(tempDir, name), {
        recursive: true,
        filter: (file) => !/(Cache|GPUCache|Code Cache|SingletonLock|lockfile)$/i.test(file)
      });
      copied += 1;
    }
    if (!copied) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      return { status: 'failed', error: '旧数据目录里没有可迁移的数据' };
    }
    fs.renameSync(tempDir, targetDir);
    return { status: 'migrated', target: targetDir };
  } catch (error) {
    try {
      fs.rmSync(`${targetDir}.migrating`, { recursive: true, force: true });
    } catch {
      // ignore
    }
    return { status: 'failed', error: (error as Error).message };
  }
}

/** 启动时调用；必须在 applyDataDirOverride 之前。失败时返回旧目录用于兜底。 */
export function migrateLegacyUserData(): { result: MigrationResult; fallback?: string } {
  try {
    const result = migrateUserDataDirs(app.getPath('appData'));
    if (result.status === 'failed') {
      return { result, fallback: path.join(app.getPath('appData'), LEGACY_DIR_NAME) };
    }
    return { result };
  } catch (error) {
    return {
      result: { status: 'failed', error: (error as Error).message },
      fallback: path.join(app.getPath('appData'), LEGACY_DIR_NAME)
    };
  }
}
