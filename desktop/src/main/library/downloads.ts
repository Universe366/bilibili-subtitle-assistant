import { requireDb, toNumber } from './db';
import type { DownloadRecord, DownloadState } from '../../shared/types';

/** 下载记录（浏览器下载面板）。 */
export function addDownload(input: {
  url: string;
  filename: string;
  path?: string;
  total?: number;
}): number {
  const database = requireDb();
  const result = database
    .prepare(
      `INSERT INTO downloads (url, filename, path, state, total, received, started_at)
       VALUES (?, ?, ?, 'progressing', ?, 0, ?)`
    )
    .run(
      String(input.url || ''),
      String(input.filename || ''),
      String(input.path || ''),
      toNumber(input.total),
      Date.now()
    );
  return toNumber(result.lastInsertRowid);
}

export function updateDownload(
  id: number,
  patch: {
    state?: DownloadState;
    path?: string;
    total?: number;
    received?: number;
    finished?: boolean;
  }
): void {
  const database = requireDb();
  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  if (patch.state) {
    fields.push('state = ?');
    values.push(patch.state);
  }
  if (patch.path !== undefined) {
    fields.push('path = ?');
    values.push(String(patch.path || ''));
  }
  if (patch.total !== undefined) {
    fields.push('total = ?');
    values.push(toNumber(patch.total));
  }
  if (patch.received !== undefined) {
    fields.push('received = ?');
    values.push(toNumber(patch.received));
  }
  if (patch.finished) {
    fields.push('finished_at = ?');
    values.push(Date.now());
  }
  if (!fields.length) return;
  values.push(Number(id));
  database.prepare(`UPDATE downloads SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function listDownloads(limit = 100): DownloadRecord[] {
  const database = requireDb();
  const rows = database
    .prepare(
      `SELECT id, url, filename, path, state, total, received, started_at, finished_at
       FROM downloads ORDER BY started_at DESC LIMIT ?`
    )
    .all(Math.min(300, Math.max(1, Math.round(limit)))) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: toNumber(row.id),
    url: String(row.url || ''),
    filename: String(row.filename || ''),
    path: String(row.path || ''),
    state: String(row.state || 'progressing') as DownloadState,
    total: toNumber(row.total),
    received: toNumber(row.received),
    startedAt: toNumber(row.started_at),
    finishedAt: row.finished_at == null ? null : toNumber(row.finished_at)
  }));
}

export function deleteDownload(id: number): boolean {
  const database = requireDb();
  return (
    toNumber(database.prepare('DELETE FROM downloads WHERE id = ?').run(Number(id)).changes) > 0
  );
}

export function clearDownloads(): number {
  const database = requireDb();
  return toNumber(database.prepare('DELETE FROM downloads').run().changes);
}
