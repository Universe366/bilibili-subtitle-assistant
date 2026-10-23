import { app, dialog } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { checkpointLibrary, closeLibrary } from './library';
import { restoreSettingsFromBackup, settingsForExport } from './settings';

const FORMAT = 'bsub-data-backup';
const VERSION = 2;

interface FileDigest {
  size: number;
  sha256: string;
}

interface BackupManifest {
  format: string;
  version: number;
  appVersion: string;
  createdAt: string;
  files?: Record<string, FileDigest>;
}

function stamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function userData(): string {
  return app.getPath('userData');
}

function digest(file: string): FileDigest {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(file));
  return { size: fs.statSync(file).size, sha256: hash.digest('hex') };
}

function manifest(files: Record<string, FileDigest>): BackupManifest {
  return {
    format: FORMAT,
    version: VERSION,
    appVersion: app.getVersion(),
    createdAt: new Date().toISOString(),
    files
  };
}

export async function backupData(): Promise<{ canceled: boolean; path?: string }> {
  const direct = String(process.env.BSUB_BACKUP_DIR || '').trim();
  let parent = direct;
  if (!parent) {
    const result = await dialog.showOpenDialog({
      title: '选择备份保存位置',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    parent = result.filePaths[0];
  }

  const target = path.join(parent, `bsub-backup-${stamp()}`);
  fs.mkdirSync(target, { recursive: true });
  const dataDir = userData();
  const dbFile = path.join(dataDir, 'library.db');

  checkpointLibrary();
  const files: Record<string, FileDigest> = {};

  // 备份里的设置不包含 API Key 和桥 Token：备份经常被放进网盘或发给别人。
  const settings = settingsForExport();
  const settingsTarget = path.join(target, 'settings.json');
  fs.writeFileSync(settingsTarget, JSON.stringify(settings, null, 2), 'utf8');
  files['settings.json'] = digest(settingsTarget);

  if (fs.existsSync(dbFile)) {
    const dbTarget = path.join(target, 'library.db');
    fs.copyFileSync(dbFile, dbTarget);
    files['library.db'] = digest(dbTarget);
  }

  fs.writeFileSync(
    path.join(target, 'manifest.json'),
    JSON.stringify(manifest(files), null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(target, 'README.txt'),
    [
      '拾字 数据备份',
      '',
      '包含 settings.json（不含 API Key / 桥 Token）与 library.db（字幕、总结、笔记、历史）。',
      '恢复后需要在设置里重新填写 API Key；桥 Token 会自动重新生成。',
      '',
      `应用版本：${app.getVersion()}`,
      `备份时间：${new Date().toLocaleString('zh-CN')}`,
      '',
      'manifest.json 里记录了每个文件的 SHA-256，恢复时会校验完整性。'
    ].join('\n'),
    'utf8'
  );
  return { canceled: false, path: target };
}

function verifyFiles(source: string, data: BackupManifest): void {
  if (!data.files) return; // v1 备份没有校验信息，兼容旧目录
  for (const [name, expected] of Object.entries(data.files)) {
    const file = path.join(source, name);
    if (!fs.existsSync(file)) throw new Error(`备份缺少文件：${name}`);
    const actual = digest(file);
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      throw new Error(`备份文件校验失败：${name} 可能已损坏或被修改`);
    }
  }
}

export async function restoreData(): Promise<{ canceled: boolean; restored?: boolean }> {
  const direct = String(process.env.BSUB_RESTORE_DIR || '').trim();
  let source = direct;
  if (!source) {
    const result = await dialog.showOpenDialog({
      title: '选择 bsub-backup-* 备份目录',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    source = result.filePaths[0];
  }
  const manifestFile = path.join(source, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error('所选目录不是拾字备份（缺少 manifest.json）');
  let data: BackupManifest | null = null;
  try {
    data = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as BackupManifest;
  } catch {
    throw new Error('备份 manifest.json 无法解析');
  }
  if (data?.format !== FORMAT || ![1, VERSION].includes(Number(data?.version))) {
    throw new Error('备份格式或版本不受支持');
  }

  const dataDir = userData();
  const settingsSource = path.join(source, 'settings.json');
  const dbSource = path.join(source, 'library.db');
  if (!fs.existsSync(dbSource)) throw new Error('备份里没有 library.db');

  if (String(process.env.BSUB_RESTORE_SKIP_CHECK || '') !== '1') {
    verifyFiles(source, data);
  }

  // 恢复前先给当前数据留一份，避免恢复错版本后无法回退。
  const safety = path.join(dataDir, `pre-restore-${stamp()}`);
  fs.mkdirSync(safety, { recursive: true });
  for (const name of ['settings.json', 'library.db']) {
    const file = path.join(dataDir, name);
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(safety, name));
  }

  closeLibrary();
  for (const name of ['library.db-wal', 'library.db-shm']) {
    const file = path.join(dataDir, name);
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
  fs.copyFileSync(dbSource, path.join(dataDir, 'library.db'));

  // 设置用「合并」而不是覆盖：备份里的 Key 是空的，保留本机已填的 Key。
  if (fs.existsSync(settingsSource)) {
    try {
      const rawSettings = JSON.parse(fs.readFileSync(settingsSource, 'utf8'));
      restoreSettingsFromBackup(rawSettings);
    } catch (error) {
      console.warn('[backup] 设置合并失败，保留当前设置:', (error as Error).message);
    }
  }

  if (process.env.BSUB_RESTORE_NO_RELAUNCH !== '1') {
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 300);
  }
  return { canceled: false, restored: true };
}
