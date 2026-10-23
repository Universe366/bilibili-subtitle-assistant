import { app, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { librarySchemaVersion, listLibrary } from './library';
import { permissionSummary } from './permissions';
import { settingsForExport } from './settings';
import { logDirectory } from './logger';

function stamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function copyIfExists(source: string, target: string): boolean {
  try {
    if (!fs.existsSync(source)) return false;
    fs.copyFileSync(source, target);
    return true;
  } catch {
    return false;
  }
}

/**
 * 导出一个可发给维护者的诊断目录：版本、数据规模、脱敏设置、站点权限和日志。
 * 不包含字幕正文、总结正文、API Key。
 */
export async function exportDiagnostics(): Promise<{ canceled: boolean; path?: string }> {
  const direct = String(process.env.BSUB_DIAG_DIR || '').trim();
  let parent = direct;
  if (!parent) {
    const result = await dialog.showOpenDialog({
      title: '选择诊断包保存位置',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    parent = result.filePaths[0];
  }

  const dataDir = app.getPath('userData');
  const target = path.join(parent, `bsub-diagnostics-${stamp()}`);
  fs.mkdirSync(target, { recursive: true });

  let stats: unknown = null;
  try {
    stats = listLibrary().stats;
  } catch {
    stats = null;
  }

  const summary = {
    createdAt: new Date().toISOString(),
    app: {
      version: app.getVersion(),
      packaged: app.isPackaged,
      locale: app.getLocale()
    },
    runtime: {
      electron: process.versions.electron || '',
      chrome: process.versions.chrome || '',
      node: process.versions.node || '',
      platform: process.platform,
      arch: process.arch
    },
    data: {
      dir: dataDir,
      schemaVersion: librarySchemaVersion(),
      stats
    },
    settings: settingsForExport(),
    permissions: permissionSummary(),
    logs: [] as string[]
  };

  const logTarget = path.join(target, 'logs');
  fs.mkdirSync(logTarget, { recursive: true });
  for (const name of ['startup.log', 'fatal.log']) {
    if (copyIfExists(path.join(dataDir, name), path.join(logTarget, name))) {
      summary.logs.push(`logs/${name}`);
    }
  }
  try {
    const dir = logDirectory();
    if (dir && fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.log')) continue;
        if (copyIfExists(path.join(dir, name), path.join(logTarget, name))) {
          summary.logs.push(`logs/${name}`);
        }
      }
    }
  } catch {
    // 日志目录不可读时仍导出其余信息
  }

  fs.writeFileSync(path.join(target, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  fs.writeFileSync(
    path.join(target, 'README.txt'),
    [
      '拾字 诊断包',
      '',
      '包含：运行环境、版本、数据规模、脱敏后的设置、站点权限、日志。',
      '不包含：字幕正文、总结正文、笔记、API Key。',
      '',
      '反馈问题时请附上 summary.json 与 logs/ 目录。'
    ].join('\n'),
    'utf8'
  );
  return { canceled: false, path: target };
}
