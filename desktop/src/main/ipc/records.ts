import fs from 'node:fs';
import path from 'node:path';
import { app, dialog, ipcMain, shell } from 'electron';
import type {
  ExportPayload,
  ExportRecord,
  LibraryHistoryItem,
  LibraryTranscriptionItem,
  Result
} from '../../shared/types';
import {
  addExportRecord,
  clearExports,
  clearHistory,
  deleteExport,
  deleteHistoryItem,
  listExports,
  listHistory,
  listTranscriptions
} from '../library';
import { buildExport, exportFilters } from '../exporters';
import { loadSettings } from '../settings';
import { failure, type IpcContext } from './shared';

/** 历史记录 / 导出记录 / 文件保存 相关 IPC。 */
export function registerRecordsIpc(ctx: IpcContext): void {
  ipcMain.handle('history:list', (): Result<LibraryHistoryItem[]> => {
    try {
      return { ok: true, data: listHistory() };
    } catch (error) {
      return failure<LibraryHistoryItem[]>(error);
    }
  });

  ipcMain.handle('history:delete', (_event, id: number): Result<{ removed: boolean }> => {
    try {
      return { ok: true, data: { removed: deleteHistoryItem(id) } };
    } catch (error) {
      return failure<{ removed: boolean }>(error);
    }
  });

  ipcMain.handle('history:transcriptions', (): Result<LibraryTranscriptionItem[]> => {
    try {
      return { ok: true, data: listTranscriptions() };
    } catch (error) {
      return failure<LibraryTranscriptionItem[]>(error);
    }
  });

  ipcMain.handle('history:clear', (): Result<{ removed: number }> => {
    try {
      return { ok: true, data: { removed: clearHistory() } };
    } catch (error) {
      return failure<{ removed: number }>(error);
    }
  });

  ipcMain.handle('exports:list', (): Result<ExportRecord[]> => {
    try {
      return { ok: true, data: listExports() };
    } catch (error) {
      return failure<ExportRecord[]>(error);
    }
  });

  ipcMain.handle('exports:clear', (): Result<{ removed: number }> => {
    try {
      return { ok: true, data: { removed: clearExports() } };
    } catch (error) {
      return failure<{ removed: number }>(error);
    }
  });

  ipcMain.handle('exports:delete', (_event, id: number): Result<{ removed: boolean }> => {
    try {
      return { ok: true, data: { removed: deleteExport(Number(id)) } };
    } catch (error) {
      return failure<{ removed: boolean }>(error);
    }
  });

  ipcMain.handle('exports:open', async (_event, filePath: string) => {
    try {
      const message = await shell.openPath(String(filePath || ''));
      return message ? { ok: false as const, error: message } : { ok: true as const, data: true };
    } catch (error) {
      return failure<boolean>(error);
    }
  });

  ipcMain.handle('exports:reveal', (_event, filePath: string): Result<boolean> => {
    try {
      shell.showItemInFolder(String(filePath || ''));
      return { ok: true, data: true };
    } catch (error) {
      return failure<boolean>(error);
    }
  });

  ipcMain.handle(
    'export:save',
    async (
      _event,
      payload: ExportPayload
    ): Promise<Result<{ path: string } | { canceled: true }>> => {
      try {
        if (!payload || !payload.info) throw new Error('缺少视频信息');
        const settings = loadSettings();
        const built = buildExport({
          ...payload,
          includeTimestamps: payload.includeTimestamps ?? settings.export.includeTimestamps,
          filenamePattern: payload.filenamePattern || settings.export.filenamePattern,
          template: payload.template || settings.export.template,
          assFontSize: payload.assFontSize || settings.export.assFontSize,
          estimateTimestamps: payload.estimateTimestamps ?? settings.export.estimateTimestamps
        });
        let target = payload.savePath;

        if (!target) {
          const picked = await dialog.showSaveDialog(ctx.win, {
            title: '导出',
            defaultPath: path.join(app.getPath('documents'), `${built.filename}.${built.ext}`),
            filters: exportFilters(payload.format)
          });
          if (picked.canceled || !picked.filePath) {
            return { ok: true, data: { canceled: true } };
          }
          target = picked.filePath;
        }

        fs.writeFileSync(target, built.content, 'utf8');
        addExportRecord(
          target,
          '字幕',
          `${payload.info?.title || '未命名视频'} · ${payload.format}`
        );
        console.log('[m4] exported', payload.format, target, `chars=${built.content.length}`);
        return { ok: true, data: { path: target } };
      } catch (error) {
        return failure<{ path: string } | { canceled: true }>(error);
      }
    }
  );

  ipcMain.handle(
    'file:save-text',
    async (
      _event,
      payload: { content: string; filename?: string; savePath?: string }
    ): Promise<Result<{ path: string } | { canceled: true }>> => {
      try {
        const content = String(payload?.content || '');
        if (!content.trim()) throw new Error('导出内容为空');
        if (content.length > 50 * 1024 * 1024) throw new Error('导出内容过大');
        let target = String(payload?.savePath || '');
        if (!target) {
          const picked = await dialog.showSaveDialog(ctx.win, {
            title: '导出',
            defaultPath: path.join(
              app.getPath('documents'),
              String(payload?.filename || 'export.md')
            ),
            filters: [
              { name: 'Markdown', extensions: ['md'] },
              { name: '文本', extensions: ['txt'] },
              { name: '所有文件', extensions: ['*'] }
            ]
          });
          if (picked.canceled || !picked.filePath) {
            return { ok: true, data: { canceled: true } };
          }
          target = picked.filePath;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf8');
        addExportRecord(target, '文本', String(payload?.filename || path.basename(target)));
        console.log('[export] text saved', target, `chars=${content.length}`);
        return { ok: true, data: { path: target } };
      } catch (error) {
        return failure<{ path: string } | { canceled: true }>(error);
      }
    }
  );
}
