import type { DatabaseSync } from 'node:sqlite';
import { requireDb, toNumber } from './db';
import type { JobItem, JobItemStatus, JobRecord, JobStatus, JobType } from '../../shared/types';

/** 后台任务记录：创建 / 进度 / 完成 / 中断恢复。 */
export type JobsListener = () => void;

let jobsListener: JobsListener | null = null;
let jobsNotifyTimer: NodeJS.Timeout | null = null;

export function setJobsListener(listener: JobsListener | null): void {
  jobsListener = listener;
}

function notifyJobs(): void {
  if (!jobsListener || jobsNotifyTimer) return;
  jobsNotifyTimer = setTimeout(() => {
    jobsNotifyTimer = null;
    try {
      jobsListener?.();
    } catch {
      // 监听方异常不应影响任务本身
    }
  }, 150);
  jobsNotifyTimer.unref?.();
}

function mapJobItem(row: Record<string, unknown>): JobItem {
  return {
    targetId: String(row.target_id || ''),
    title: String(row.title || ''),
    status: String(row.status || 'pending') as JobItemStatus,
    progress: toNumber(row.progress),
    message: String(row.message || ''),
    error: row.error == null ? null : String(row.error),
    updatedAt: toNumber(row.updated_at)
  };
}

function mapJob(row: Record<string, unknown>, items: JobItem[]): JobRecord {
  return {
    id: String(row.id || ''),
    type: String(row.type || 'summary') as JobType,
    title: String(row.title || ''),
    status: String(row.status || 'running') as JobStatus,
    progress: toNumber(row.progress),
    message: String(row.message || ''),
    error: row.error == null ? null : String(row.error),
    metaJson: row.meta_json == null ? null : String(row.meta_json),
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
    finishedAt: row.finished_at == null ? null : toNumber(row.finished_at),
    items
  };
}

export function createJob(input: {
  id: string;
  type: JobType;
  title: string;
  meta?: unknown;
}): void {
  const database = requireDb();
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO jobs (id, type, title, status, progress, message, meta_json, created_at, updated_at)
       VALUES (?, ?, ?, 'running', 0, '', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type,
         title = excluded.title,
         status = 'running',
         progress = 0,
         message = '',
         error = NULL,
         meta_json = excluded.meta_json,
         updated_at = excluded.updated_at,
         finished_at = NULL`
    )
    .run(
      input.id,
      input.type,
      input.title,
      input.meta === undefined ? null : JSON.stringify(input.meta),
      now,
      now
    );

  // 只保留最近 50 个已结束任务，运行中的永远保留。
  database
    .prepare(
      `DELETE FROM jobs WHERE status IN ('done','failed','cancelled') AND id NOT IN (
         SELECT id FROM jobs ORDER BY created_at DESC LIMIT 50)`
    )
    .run();
  notifyJobs();
}

export function createJobItem(jobId: string, targetId: string, title: string): void {
  const database = requireDb();
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO job_items (job_id, target_id, title, status, progress, message, updated_at)
       VALUES (?, ?, ?, 'pending', 0, '', ?)
       ON CONFLICT(job_id, target_id) DO UPDATE SET
         title = excluded.title,
         status = 'pending',
         progress = 0,
         message = '',
         error = NULL,
         updated_at = excluded.updated_at`
    )
    .run(jobId, targetId, title, now);
  notifyJobs();
}

export function updateJob(
  id: string,
  patch: {
    title?: string;
    progress?: number;
    message?: string;
    status?: JobStatus;
    error?: string | null;
  }
): void {
  const database = requireDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.title != null) {
    fields.push('title = ?');
    values.push(String(patch.title));
  }
  if (patch.progress != null) {
    fields.push('progress = ?');
    values.push(Math.min(100, Math.max(0, Number(patch.progress) || 0)));
  }
  if (patch.message != null) {
    fields.push('message = ?');
    values.push(String(patch.message));
  }
  if (patch.status != null) {
    fields.push('status = ?');
    values.push(patch.status);
  }
  if (patch.error !== undefined) {
    fields.push('error = ?');
    values.push(patch.error == null ? null : String(patch.error));
  }
  if (!fields.length) return;
  fields.push('updated_at = ?');
  values.push(Date.now(), id);
  database
    .prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as Array<string | number | null>));
  notifyJobs();
}

export function updateJobItem(
  jobId: string,
  targetId: string,
  patch: {
    title?: string;
    status?: JobItemStatus;
    progress?: number;
    message?: string;
    error?: string | null;
  }
): void {
  const database = requireDb();
  const fields = ['updated_at = ?'];
  const values: unknown[] = [Date.now()];
  if (patch.title != null) {
    fields.push('title = ?');
    values.push(String(patch.title));
  }
  if (patch.status != null) {
    fields.push('status = ?');
    values.push(patch.status);
  }
  if (patch.progress != null) {
    fields.push('progress = ?');
    values.push(Math.min(100, Math.max(0, Number(patch.progress) || 0)));
  }
  if (patch.message != null) {
    fields.push('message = ?');
    values.push(String(patch.message));
  }
  if (patch.error !== undefined) {
    fields.push('error = ?');
    values.push(patch.error == null ? null : String(patch.error));
  }
  values.push(jobId, targetId);
  const result = database
    .prepare(`UPDATE job_items SET ${fields.join(', ')} WHERE job_id = ? AND target_id = ?`)
    .run(...(values as Array<string | number | null>));
  if (!toNumber(result.changes)) {
    database
      .prepare(
        `INSERT INTO job_items (job_id, target_id, title, status, progress, message, error, updated_at)
         VALUES (?, ?, '', ?, ?, ?, ?, ?)`
      )
      .run(
        jobId,
        targetId,
        patch.status || 'pending',
        Math.min(100, Math.max(0, Number(patch.progress) || 0)),
        patch.message || '',
        patch.error == null ? null : patch.error,
        Date.now()
      );
  }
  notifyJobs();
}

export function finishJob(
  id: string,
  status: JobStatus,
  error?: string | null,
  message?: string
): void {
  const database = requireDb();
  const now = Date.now();
  database
    .prepare(
      `UPDATE jobs SET
         status = ?,
         progress = CASE WHEN ? = 'done' THEN 100 ELSE progress END,
         message = ?,
         error = ?,
         finished_at = ?,
         updated_at = ?
       WHERE id = ?`
    )
    .run(
      status,
      status,
      message == null
        ? status === 'done'
          ? '完成'
          : status === 'cancelled'
            ? '已取消'
            : '失败'
        : message,
      error == null ? null : error,
      now,
      now,
      id
    );
  notifyJobs();
}

function itemsForJobs(database: DatabaseSync, ids: string[]): Map<string, JobItem[]> {
  const map = new Map<string, JobItem[]>();
  if (!ids.length) return map;
  const rows = database
    .prepare(
      `SELECT * FROM job_items WHERE job_id IN (${ids.map(() => '?').join(',')}) ORDER BY id ASC`
    )
    .all(...ids) as Array<Record<string, unknown>>;
  for (const row of rows) {
    const jobId = String(row.job_id || '');
    if (!map.has(jobId)) map.set(jobId, []);
    map.get(jobId)?.push(mapJobItem(row));
  }
  return map;
}

export function listJobs(limit = 40): JobRecord[] {
  const database = requireDb();
  const safeLimit = Math.min(100, Math.max(1, Math.round(limit)));
  const rows = database
    .prepare(
      `SELECT * FROM jobs
       ORDER BY CASE WHEN status IN ('running','paused') THEN 0 ELSE 1 END, updated_at DESC
       LIMIT ?`
    )
    .all(safeLimit) as Array<Record<string, unknown>>;
  const items = itemsForJobs(
    database,
    rows.map((row) => String(row.id || ''))
  );
  return rows.map((row) => mapJob(row, items.get(String(row.id || '')) || []));
}

export function getJob(id: string): JobRecord | null {
  const database = requireDb();
  const row = database.prepare('SELECT * FROM jobs WHERE id = ?').get(String(id)) as
    Record<string, unknown> | undefined;
  if (!row) return null;
  const items = itemsForJobs(database, [String(row.id || '')]);
  return mapJob(row, items.get(String(row.id || '')) || []);
}

export function clearFinishedJobs(): number {
  const database = requireDb();
  const result = database
    .prepare("DELETE FROM jobs WHERE status IN ('done','failed','cancelled')")
    .run();
  notifyJobs();
  return toNumber(result.changes);
}

export function markStaleJobs(): number {
  const database = requireDb();
  const now = Date.now();
  const result = database
    .prepare(
      `UPDATE jobs SET status = 'failed', error = '应用退出，任务中断', message = '已中断',
         finished_at = ?, updated_at = ?
       WHERE status IN ('running','paused')`
    )
    .run(now, now);
  return toNumber(result.changes);
}
