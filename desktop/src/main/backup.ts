import { app, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { checkpointLibrary, closeLibrary } from './library';

const FORMAT = 'bsub-data-backup';
const VERSION = 1;

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

function manifest(): Record<string, unknown> {
  return {
    format: FORMAT,
    version: VERSION,
    appVersion: app.getVersion(),
    createdAt: new Date().toISOString()
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
  const settingsFile = path.join(dataDir, 'settings.json');

  checkpointLibrary();
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest(), null, 2), 'utf8');
  if (fs.existsSync(settingsFile)) {
    fs.copyFileSync(settingsFile, path.join(target, 'settings.json'));
  }
  if (fs.existsSync(dbFile)) {
    fs.copyFileSync(dbFile, path.join(target, 'library.db'));
  }
  fs.writeFileSync(
    path.join(target, 'README.txt'),
    [
      'B站字幕助手 数据备份',
      '',
      '包含 settings.json（含 API Key / 桥 Token）与 library.db（字幕、总结、历史）。',
      '请妥善保管，不要上传或分享这个目录。',
      '',
      `应用版本：${app.getVersion()}`,
      `备份时间：${new Date().toLocaleString('zh-CN')}`
    ].join('\n'),
    'utf8'
  );
  return { canceled: false, path: target };
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
  if (!fs.existsSync(manifestFile)) throw new Error('所选目录不是 B站字幕助手 备份（缺少 manifest.json）');
  let data: any = null;
  try {
    data = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch {
    throw new Error('备份 manifest.json 无法解析');
  }
  if (data?.format !== FORMAT || Number(data?.version) !== VERSION) {
    throw new Error('备份格式或版本不受支持');
  }

  const dataDir = userData();
  const settingsSource = path.join(source, 'settings.json');
  const dbSource = path.join(source, 'library.db');
  if (!fs.existsSync(dbSource)) throw new Error('备份里没有 library.db');

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
  if (fs.existsSync(settingsSource)) {
    fs.copyFileSync(settingsSource, path.join(dataDir, 'settings.json'));
  }

  if (process.env.BSUB_RESTORE_NO_RELAUNCH !== '1') {
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 300);
  }
  return { canceled: false, restored: true };
}
