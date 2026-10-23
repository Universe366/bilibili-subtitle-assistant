import fs from 'node:fs';
import { dialog, ipcMain } from 'electron';
import type {
  Chapter,
  CorrectionRuleGroup,
  McpServer,
  McpTool,
  PageInfo,
  QualityReport,
  Result,
  SkillItem,
  SubtitleLine,
  WebReference
} from '../../shared/types';
import { callMcpTool, listMcpTools } from '../mcp';
import { readSkillFile } from '../skills';
import { checkSubtitles } from '../quality';
import { generateChapters } from '../chapters';
import { testSearch } from '../search';
import { loadSettings } from '../settings';

import { failure, type IpcContext } from './shared';

/** MCP / Skills / 搜索测试 / 校对规则 / 字幕质量与章节 相关 IPC。 */
export function registerToolsIpc(ctx: IpcContext): void {
  ipcMain.handle('mcp:test', async (_event, server: McpServer): Promise<Result<McpTool[]>> => {
    try {
      return { ok: true, data: await listMcpTools(server) };
    } catch (error) {
      return failure<McpTool[]>(error);
    }
  });

  ipcMain.handle(
    'mcp:call',
    async (
      _event,
      payload: { server: McpServer; name: string; args: Record<string, unknown> }
    ): Promise<Result<string>> => {
      try {
        return {
          ok: true,
          data: await callMcpTool(payload.server, payload.name, payload.args || {})
        };
      } catch (error) {
        return failure<string>(error);
      }
    }
  );

  ipcMain.handle('skills:import', async (): Promise<Result<SkillItem | null>> => {
    try {
      const picked = await dialog.showOpenDialog(ctx.win, {
        title: '导入 SKILL.md',
        properties: ['openFile'],
        filters: [{ name: 'Skill', extensions: ['md'] }]
      });
      const file = picked.filePaths[0];
      if (picked.canceled || !file) return { ok: true, data: null };
      return { ok: true, data: readSkillFile(file) };
    } catch (error) {
      return failure<SkillItem | null>(error);
    }
  });

  ipcMain.handle(
    'quality:check',
    (_event, payload: { info: PageInfo; lines: SubtitleLine[] }): Result<QualityReport> => {
      try {
        if (!payload || !payload.info || !Array.isArray(payload.lines)) {
          throw new Error('缺少字幕数据');
        }
        return { ok: true, data: checkSubtitles(payload.info, payload.lines) };
      } catch (error) {
        return failure<QualityReport>(error);
      }
    }
  );

  ipcMain.handle(
    'chapters:generate',
    async (
      _event,
      payload: { info: PageInfo; lines: SubtitleLine[] }
    ): Promise<Result<Chapter[]>> => {
      try {
        if (!payload || !payload.info || !Array.isArray(payload.lines) || !payload.lines.length) {
          throw new Error('缺少字幕数据');
        }
        return { ok: true, data: await generateChapters(payload.info, payload.lines) };
      } catch (error) {
        return failure<Chapter[]>(error);
      }
    }
  );

  ipcMain.handle('search:test', async (_event, query: string): Promise<Result<WebReference[]>> => {
    try {
      const q = String(query || '').trim() || 'B站 视频 总结';
      return { ok: true, data: await testSearch(loadSettings(), q) };
    } catch (error) {
      return failure<WebReference[]>(error);
    }
  });

  ipcMain.handle('rules:export', async (_event, group: CorrectionRuleGroup) => {
    try {
      const result = await dialog.showSaveDialog({
        defaultPath: `${String(group?.name || '字幕规则组').replace(/[\\/:*?"<>|]/g, '_')}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePath) return { ok: true, data: { canceled: true } };
      fs.writeFileSync(
        result.filePath,
        JSON.stringify({ version: 1, groups: [group] }, null, 2),
        'utf8'
      );
      return { ok: true, data: { canceled: false, path: result.filePath } };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('rules:import', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePaths.length) {
        return { ok: true, data: [] as CorrectionRuleGroup[] };
      }
      const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
      const rows = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.groups)
          ? parsed.groups
          : [];
      const groups: CorrectionRuleGroup[] = rows
        .filter((row: any) => row && typeof row === 'object')
        .map((row: any, index: number) => ({
          id: `group_${Date.now().toString(36)}_${index}`,
          name: String(row.name || `导入规则组 ${index + 1}`).slice(0, 80),
          enabled: row.enabled !== false,
          rules: (Array.isArray(row.rules) ? row.rules : [])
            .filter((rule: any) => rule && typeof rule === 'object')
            .map((rule: any, ruleIndex: number) => ({
              id: `rule_${Date.now().toString(36)}_${ruleIndex}`,
              pattern: String(rule.pattern ?? rule.from ?? ''),
              replacement: String(rule.replacement ?? rule.to ?? ''),
              regex: rule.regex === true,
              caseSensitive: rule.caseSensitive === true
            }))
        }));
      return { ok: true, data: groups };
    } catch (error) {
      return failure(error);
    }
  });
}
