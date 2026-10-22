import { app, dialog, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { checkpointLibrary, closeLibrary, initLibrary } from './library';
import { loadSettings, saveSettings } from './settings';

const POINTER_NAME = 'bsub-desktop-location.txt';
const CLEANUP_NAME = 'bsub-desktop-cleanup.txt';

function pointerFile(): string {
  return path.join(app.getPath('appData'), POINTER_NAME);
}

function cleanupFile(): string {
  return path.join(app.getPath('appData'), CLEANUP_NAME);
}

function readCleanupPaths(): string[] {
  try {
    return fs
      .readFileSync(cleanupFile(), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeCleanupPaths(paths: string[]): void {
  try {
    const unique = [...new Set(paths.filter(Boolean))];
    if (!unique.length) {
      fs.rmSync(cleanupFile(), { force: true });
      return;
    }
    fs.writeFileSync(cleanupFile(), `${unique.join('\n')}\n`, 'utf8');
  } catch {
    // 清理标记写失败不影响迁移本身
  }
}

function rememberOldDataDir(oldDir: string): void {
  writeCleanupPaths([...readCleanupPaths(), path.resolve(oldDir)]);
}

/** 新进程已用新目录启动后，再删除旧目录，避免和仍在运行的旧进程抢文件。 */
export function scheduleOldDataCleanup(): void {
  const paths = readCleanupPaths();
  if (!paths.length) return;
  const current = path.resolve(app.getPath('userData'));
  setTimeout(() => {
    const remaining: string[] = [];
    for (const value of paths) {
      const oldDir = path.resolve(value);
      if (
        oldDir.length <= 3 ||
        samePath(oldDir, current) ||
        isInside(current, oldDir) ||
        isInside(oldDir, current)
      ) {
        continue;
      }
      try {
        fs.rmSync(oldDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
        console.log('[data] removed old data dir', oldDir);
      } catch (error) {
        console.warn('[data] old data dir cleanup failed', oldDir, (error as Error).message);
        remaining.push(oldDir);
      }
    }
    writeCleanupPaths(remaining);
  }, 2500);
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isSkippable(name: string): boolean {
  return (
    /^(Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|ShaderCache|GrShaderCache|Crashpad)$/i.test(
      name
    ) ||
    /^(SingletonLock|SingletonSocket|SingletonCookie|lockfile)$/i.test(name) ||
    /\.(lock|tmp)$/i.test(name) ||
    /-(journal|wal|shm)$/i.test(name)
  );
}

function copyDir(from: string, to: string): number {
  let failed = 0;
  const walk = (source: string, target: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(source, { withFileTypes: true });
    } catch {
      failed += 1;
      return;
    }
    fs.mkdirSync(target, { recursive: true });
    for (const entry of entries) {
      if (isSkippable(entry.name)) continue;
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);
      try {
        if (entry.isDirectory()) {
          walk(sourcePath, targetPath);
        } else if (entry.isFile()) {
          fs.copyFileSync(sourcePath, targetPath);
        }
      } catch {
        failed += 1;
      }
    }
  };
  walk(from, to);
  return failed;
}

/** 启动时读取自定义数据目录；必须在任何 userData 读写之前调用。 */
export function applyDataDirOverride(): string | null {
  try {
    const file = pointerFile();
    if (!fs.existsSync(file)) return null;
    const target = fs.readFileSync(file, 'utf8').trim();
    if (!target) return null;
    const resolved = path.resolve(target);
    if (!fs.existsSync(resolved)) return null;
    app.setPath('userData', resolved);
    return resolved;
  } catch {
    return null;
  }
}

/** 选择新目录 → 复制数据 → 写入指向文件。调用方负责重启应用。 */
export async function changeDataDir(): Promise<{
  canceled: boolean;
  target?: string;
  failed?: number;
}> {
  const current = app.getPath('userData');
  const result = await dialog.showOpenDialog({
    title: '选择新的数据保存位置',
    defaultPath: path.dirname(current),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };

  const target = path.resolve(result.filePaths[0]);
  if (samePath(target, current)) {
    throw new Error('新位置与当前数据目录相同，无需迁移。');
  }
  if (isInside(target, current) || isInside(current, target)) {
    throw new Error('新位置不能是当前数据目录的子目录或父目录，请选择其他目录。');
  }
  if (fs.existsSync(target)) {
    if (!fs.statSync(target).isDirectory()) {
      throw new Error('目标路径不是文件夹。');
    }
    if (fs.readdirSync(target).length > 0) {
      throw new Error('目标文件夹不是空文件夹，请选择空目录，避免与已有文件混在一起。');
    }
  } else {
    fs.mkdirSync(target, { recursive: true });
  }

  const confirm = await dialog.showMessageBox({
    type: 'question',
    buttons: ['迁移并重启', '取消'],
    defaultId: 0,
    cancelId: 1,
    title: '迁移数据位置',
    message: '将迁移数据到新位置',
    detail: `当前：${current}\n迁移到：${target}\n\n会复制设置、字幕库、总结、登录状态和日志；复制完成后应用会自动重启。`
  });
  if (confirm.response !== 0) return { canceled: true };

  checkpointLibrary();
  try {
    saveSettings(loadSettings());
  } catch {
    // 设置写入失败时仍然继续复制已有文件
  }
  closeLibrary();
  try {
    await session.defaultSession.cookies.flushStore();
  } catch {
    // 忽略：复制阶段会记录失败文件
  }
  try {
    session.defaultSession.flushStorageData();
  } catch {
    // 忽略
  }

  try {
    const failed = copyDir(current, target);
    for (const name of ['settings.json', 'library.db']) {
      if (!fs.existsSync(path.join(target, name))) {
        throw new Error(`迁移失败：没有复制到 ${name}，原数据仍保留在 ${current}。`);
      }
    }
    rememberOldDataDir(current);
    // 如果迁回旧位置，不要把新位置本身留在待删除列表里。
    writeCleanupPaths(readCleanupPaths().filter((item) => !samePath(item, target)));
    fs.writeFileSync(pointerFile(), `${target}\n`, 'utf8');
    return { canceled: false, target, failed };
  } catch (error) {
    // 迁移失败时把当前数据库重新打开，避免应用继续运行却没有库。
    try {
      initLibrary();
    } catch {
      // ignore
    }
    throw error;
  }
}
