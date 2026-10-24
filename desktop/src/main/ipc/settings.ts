import fs from 'node:fs';
import path from 'node:path';
import { app, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron';
import type {
  AiPlatform,
  AsrPlatform,
  AppSettings,
  BridgeStatus,
  Result,
  SearchPlatform,
  UpdateStatus
} from '../../shared/types';
import {
  activePlatform,
  isMaskedSecret,
  loadSettings,
  saveSettings,
  setSidebarLayout,
  setSidebarWidth,
  settingsForExport,
  settingsSnapshot,
  testPlatform
} from '../settings';
import { bridgeStatus, restartBridge } from '../bridge';
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  skipUpdate,
  updateStatus
} from '../updater';
import { clearSitePermissions, permissionSummary, revokeSitePermission } from '../permissions';
import { exportDiagnostics } from '../diagnostics';
import { backupData, restoreData } from '../backup';
import { changeDataDir } from '../dataDir';
import { installBrowserExtension } from '../extension-install';
import { probePlatformModels, testPlatformConnection } from '../platform';

import { listLibrary } from '../library';
import { failure, type IpcContext } from './shared';
import { setPetEnabled } from '../petWindow';

/** 设置 / 更新 / 桥 / 权限 / 数据目录 / 诊断 相关 IPC。 */
export function registerSettingsIpc(ctx: IpcContext): void {
  ipcMain.handle('pet:set-enabled', (_event, enabled: boolean) => {
    setPetEnabled(enabled === true);
  });


  ipcMain.handle('settings:get', (): Result<ReturnType<typeof settingsSnapshot>> => {
    try {
      return { ok: true, data: settingsSnapshot() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'settings:set',
    async (_event, next: AppSettings): Promise<Result<ReturnType<typeof settingsSnapshot>>> => {
      try {
        const saved = saveSettings(next);
        nativeTheme.themeSource = saved.general.theme;
        ctx.tabs.setSuspendMinutes(saved.general.suspendMinutes);
        await restartBridge(ctx.win);
        const snapshot = settingsSnapshot();
        ctx.send('settings:changed', snapshot);
        return { ok: true, data: snapshot };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'settings:wizard',
    async (_event, done: boolean): Promise<Result<ReturnType<typeof settingsSnapshot>>> => {
      try {
        const settings = loadSettings();
        settings.general.wizardDone = done === true;
        saveSettings(settings);
        const snapshot = settingsSnapshot();
        ctx.send('settings:changed', snapshot);
        return { ok: true, data: snapshot };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'settings:export',
    async (): Promise<Result<{ canceled: boolean; path?: string }>> => {
      try {
        const result = await dialog.showSaveDialog(ctx.win, {
          title: '导出设置',
          defaultPath: path.join(app.getPath('documents'), 'bsub-settings.json'),
          filters: [{ name: 'JSON', extensions: ['json'] }]
        });
        if (result.canceled || !result.filePath) return { ok: true, data: { canceled: true } };
        // 导出的设置不含 API Key / 桥 Token；重新导入时保留本机原值。
        fs.writeFileSync(result.filePath, JSON.stringify(settingsForExport(), null, 2), 'utf8');
        return { ok: true, data: { canceled: false, path: result.filePath } };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'settings:import',
    async (): Promise<
      Result<{ canceled: boolean; snapshot?: ReturnType<typeof settingsSnapshot> }>
    > => {
      try {
        const result = await dialog.showOpenDialog(ctx.win, {
          title: '导入设置',
          properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }]
        });
        const file = result.filePaths[0];
        if (result.canceled || !file) return { ok: true, data: { canceled: true } };
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as AppSettings;
        const saved = saveSettings(raw);
        nativeTheme.themeSource = saved.general.theme;
        ctx.tabs.setSuspendMinutes(saved.general.suspendMinutes);
        await restartBridge(ctx.win);
        return { ok: true, data: { canceled: false, snapshot: settingsSnapshot() } };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle('bridge:status', (): Result<BridgeStatus> => {
    try {
      return { ok: true, data: bridgeStatus() };
    } catch (error) {
      return failure<BridgeStatus>(error);
    }
  });

  ipcMain.handle(
    'bridge:install-extension',
    async (): Promise<Result<{ path: string; browser: string; opened: boolean }>> => {
      try {
        return { ok: true, data: await installBrowserExtension(ctx.win) };
      } catch (error) {
        return failure<{ path: string; browser: string; opened: boolean }>(error);
      }
    }
  );

  ipcMain.handle('system:open-external', async (_event, url: string) => {
    const value = String(url || '');
    if (!/^https?:\/\//i.test(value)) throw new Error('只允许打开 http/https 链接');
    await shell.openExternal(value);
  });

  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(String(text ?? ''));
  });

  ipcMain.handle('update:status', (): Result<UpdateStatus> => {
    try {
      return { ok: true, data: updateStatus() };
    } catch (error) {
      return failure<UpdateStatus>(error);
    }
  });

  ipcMain.handle('update:check', async (): Promise<Result<UpdateStatus>> => {
    try {
      return { ok: true, data: await checkForUpdates(true) };
    } catch (error) {
      return failure<UpdateStatus>(error);
    }
  });

  ipcMain.handle('update:download', async (): Promise<Result<UpdateStatus>> => {
    try {
      return { ok: true, data: await downloadUpdate() };
    } catch (error) {
      return failure<UpdateStatus>(error);
    }
  });

  ipcMain.handle('update:skip', (_event, version: string) => {
    return { ok: true, data: skipUpdate(version) };
  });

  ipcMain.handle('update:open-releases', async () => {
    await shell.openExternal('https://github.com/Universe366/shizi-extension/releases/latest');
  });

  ipcMain.handle('update:install', () => {
    installUpdate();
  });

  ipcMain.handle(
    'platform:models',
    async (_event, payload: { kind: 'ai' | 'asr'; platform: AiPlatform | AsrPlatform }) => {
      try {
        return { ok: true, data: await probePlatformModels(payload.kind, payload.platform) };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'platform:test',
    async (
      _event,
      payload: {
        kind: 'ai' | 'asr' | 'search';
        platform: AiPlatform | AsrPlatform | SearchPlatform;
      }
    ) => {
      try {
        return { ok: true, data: await testPlatformConnection(payload.kind, payload.platform) };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle('settings:test', async (_event, platform?: AiPlatform) => {
    try {
      let target = platform || activePlatform();
      if (isMaskedSecret(target.apiKey)) {
        const saved = loadSettings().ai.platforms.find((item) => item.id === target.id);
        if (saved) target = { ...target, apiKey: saved.apiKey };
      }
      return { ok: true, data: await testPlatform(target) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'settings:sidebar-layout',
    (_event, patch: { width?: number; position?: 'left' | 'right'; collapsed?: boolean }) => {
      try {
        setSidebarLayout(patch || {});
        const snapshot = settingsSnapshot();
        ctx.send('settings:changed', snapshot);
        return { ok: true, data: snapshot };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle('settings:sidebar-width', (_event, width: number) => {
    try {
      setSidebarWidth(Number(width));
      const snapshot = settingsSnapshot();
      ctx.send('settings:changed', snapshot);
      return { ok: true, data: snapshot };
    } catch (error) {
      return failure(error);
    }
  });

  let dragRestoreTimer: NodeJS.Timeout | null = null;
  let dragActive = false;

  ipcMain.handle('browser:begin-drag', async () => {
    try {
      if (dragRestoreTimer) clearTimeout(dragRestoreTimer);
      dragActive = true;
      const snapshot = await ctx.tabs.captureActiveView();
      if (!dragActive) {
        ctx.tabs.setActiveViewVisible(true);
        return { ok: true, data: null };
      }
      ctx.tabs.setActiveViewVisible(false);
      dragRestoreTimer = setTimeout(() => {
        dragActive = false;
        ctx.tabs.setActiveViewVisible(true);
        dragRestoreTimer = null;
      }, 12000);
      return { ok: true, data: snapshot };
    } catch (error) {
      dragActive = false;
      ctx.tabs.setActiveViewVisible(true);
      return failure(error);
    }
  });

  ipcMain.handle('browser:end-drag', () => {
    dragActive = false;
    if (dragRestoreTimer) {
      clearTimeout(dragRestoreTimer);
      dragRestoreTimer = null;
    }
    ctx.tabs.setActiveViewVisible(true);
  });

  ipcMain.handle('browser:set-visible', (_event, visible: boolean) => {
    ctx.tabs.setActiveViewVisible(visible === true);
  });

  ipcMain.handle('data:backup', async () => {
    try {
      return { ok: true, data: await backupData() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('data:restore', async () => {
    try {
      return { ok: true, data: await restoreData() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('data:change-dir', async () => {
    try {
      const result = await changeDataDir();
      if (result.canceled || !result.target) {
        return { ok: true, data: result };
      }
      await dialog.showMessageBox({
        type: 'info',
        title: '迁移完成',
        message: '数据已迁移到新位置',
        detail: `应用现在会重启，之后将从以下目录读写数据：\n${result.target}${
          result.failed ? `\n\n有 ${result.failed} 个缓存/锁定文件未复制，不影响设置与字幕库。` : ''
        }\n\n旧数据目录会在新进程启动后自动删除。`
      });
      app.relaunch();
      app.exit(0);
      return { ok: true, data: result };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('diagnostics:get', () => {
    try {
      const dataDir = app.getPath('userData');
      const logs = ['startup.log', 'fatal.log']
        .map((name) => {
          const file = path.join(dataDir, name);
          try {
            const stat = fs.statSync(file);
            return { name, size: stat.size, modified: stat.mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((item): item is { name: string; size: number; modified: number } => Boolean(item));
      return {
        ok: true,
        data: {
          version: app.getVersion(),
          electron: process.versions.electron || '',
          chrome: process.versions.chrome || '',
          node: process.versions.node || '',
          platform: process.platform,
          arch: process.arch,
          dataDir,
          settingsPath: path.join(dataDir, 'settings.json'),
          dbPath: path.join(dataDir, 'library.db'),
          logs,
          library: listLibrary().stats
        }
      };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('permissions:clear', (): Result<{ removed: number }> => {
    try {
      return { ok: true, data: { removed: clearSitePermissions() } };
    } catch (error) {
      return failure<{ removed: number }>(error);
    }
  });

  ipcMain.handle('permissions:list', () => {
    try {
      return { ok: true as const, data: permissionSummary() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'permissions:revoke',
    (_event, payload: { origin: string; permission: string }): Result<{ removed: boolean }> => {
      try {
        return {
          ok: true,
          data: {
            removed: revokeSitePermission(
              String(payload?.origin || ''),
              String(payload?.permission || '')
            )
          }
        };
      } catch (error) {
        return failure<{ removed: boolean }>(error);
      }
    }
  );

  ipcMain.handle(
    'diagnostics:export',
    async (): Promise<Result<{ canceled: boolean; path?: string }>> => {
      try {
        return { ok: true, data: await exportDiagnostics() };
      } catch (error) {
        return failure<{ canceled: boolean; path?: string }>(error);
      }
    }
  );

  ipcMain.handle('settings:open-data', async () => {
    await shell.openPath(app.getPath('userData'));
  });
}
