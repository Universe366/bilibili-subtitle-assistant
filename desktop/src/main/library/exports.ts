import { requireDb, toNumber } from './db';
import type { ExportRecord } from '../../shared/types';

/** 导出记录（最近导出的文件）。 */
export function addExportRecord(filePath: string, kind: string, title: string): void {
  const database = requireDb();
  database
    .prepare('INSERT INTO exports (path, kind, title, created_at) VALUES (?, ?, ?, ?)')
    .run(String(filePath || ''), String(kind || ''), String(title || ''), Date.now());
  database
    .prepare(
      `DELETE FROM exports WHERE id NOT IN (
         SELECT id FROM exports ORDER BY created_at DESC, id DESC LIMIT 100)`
    )
    .run();
}

export function listExports(limit = 50): ExportRecord[] {
  const database = requireDb();
  const rows = database
    .prepare(
      `SELECT id, path, kind, title, created_at FROM exports
       ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(Math.min(100, Math.max(1, Math.round(limit)))) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: toNumber(row.id),
    path: String(row.path || ''),
    kind: String(row.kind || ''),
    title: String(row.title || ''),
    createdAt: toNumber(row.created_at)
  }));
}

export function clearExports(): number {
  const database = requireDb();
  const result = database.prepare('DELETE FROM exports').run();
  return toNumber(result.changes);
}

export function deleteExport(id: number): boolean {
  const database = requireDb();
  const result = database.prepare('DELETE FROM exports WHERE id = ?').run(Number(id));
  return toNumber(result.changes) > 0;
}
