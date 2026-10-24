import { requireDb, toNumber } from './db';
import { ensureVideo, uidOf } from './core';
import type {
  PageInfo,
  StoredSummary,
  SummaryRef,
  SummaryVersion,
  SummaryVersionMeta,
  VerificationSummary
} from '../../shared/types';

/** 总结正文与版本历史。 */
function encodeVerification(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function decodeVerification(raw: unknown): VerificationSummary | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as VerificationSummary) : null;
  } catch {
    return null;
  }
}

export function saveSummary(
  info: PageInfo,
  content: string,
  model: string,
  verification?: VerificationSummary | null
): { id: number; updated: boolean; videoId: number } {
  if (!content.trim()) throw new Error('总结内容为空');
  const database = requireDb();
  const now = Date.now();
  const uid = uidOf(info);
  const existing = database.prepare('SELECT id FROM summaries WHERE uid = ?').get(uid) as
    { id: number } | undefined;

  database.exec('BEGIN');
  try {
    const { videoId } = ensureVideo(database, info, now);
    database
      .prepare(
        `INSERT INTO summaries (uid, video_id, content_md, model, created_at, updated_at, verification_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uid) DO UPDATE SET
           video_id = excluded.video_id,
           content_md = excluded.content_md,
           model = excluded.model,
           updated_at = excluded.updated_at,
           verification_json = excluded.verification_json`
      )
      .run(uid, videoId, content, model, now, now, encodeVerification(verification));

    database
      .prepare(
        `INSERT INTO summary_versions (video_id, uid, content_md, model, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(videoId, uid, content, model, now);
    // 每个视频只保留最近 20 个版本，避免批量重跑把库撑大。
    database
      .prepare(
        `DELETE FROM summary_versions WHERE video_id = ? AND id NOT IN (
           SELECT id FROM summary_versions WHERE video_id = ?
           ORDER BY created_at DESC, id DESC LIMIT 20)`
      )
      .run(videoId, videoId);

    database.exec('COMMIT');
    const row = database.prepare('SELECT id FROM summaries WHERE uid = ?').get(uid) as {
      id: number;
    };
    return { id: Number(row.id), updated: Boolean(existing), videoId };
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  }
}

export function getSummaryFor(ref: SummaryRef): StoredSummary | null {
  const database = requireDb();
  const uid = ref.bvid
    ? `v:${ref.bvid}:${ref.cid ?? 0}`
    : ref.epId
      ? `e:${ref.epId}:${ref.cid ?? 0}`
      : '';
  if (!uid) return null;

  let row = database
    .prepare('SELECT content_md, model, updated_at, verification_json FROM summaries WHERE uid = ?')
    .get(uid) as
    | { content_md: string; model: string; updated_at: number; verification_json?: string | null }
    | undefined;

  // 页面 cid 可能取不到/变化；按 bvid 兜底，避免重开视频找不到已保存总结。
  if (!row && ref.bvid) {
    row = database
      .prepare(
        'SELECT content_md, model, updated_at, verification_json FROM summaries WHERE uid LIKE ? ORDER BY updated_at DESC LIMIT 1'
      )
      .get(`v:${ref.bvid}:%`) as
      | { content_md: string; model: string; updated_at: number; verification_json?: string | null }
      | undefined;
  }

  if (!row) return null;
  return {
    content: String(row.content_md || ''),
    model: String(row.model || ''),
    updatedAt: toNumber(row.updated_at),
    verification: decodeVerification(row.verification_json)
  };
}

export function listSummaryVersions(videoId: number, limit = 20): SummaryVersionMeta[] {
  const database = requireDb();
  const rows = database
    .prepare(
      `SELECT id, model, created_at, length(content_md) AS chars
       FROM summary_versions WHERE video_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(Number(videoId), Math.min(50, Math.max(1, Math.round(limit)))) as Array<
    Record<string, unknown>
  >;
  return rows.map((row) => ({
    id: toNumber(row.id),
    model: String(row.model || ''),
    createdAt: toNumber(row.created_at),
    chars: toNumber(row.chars)
  }));
}

export function getSummaryVersion(id: number): SummaryVersion | null {
  const database = requireDb();
  const row = database
    .prepare(
      `SELECT id, video_id, content_md, model, created_at FROM summary_versions WHERE id = ?`
    )
    .get(Number(id)) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: toNumber(row.id),
    videoId: toNumber(row.video_id),
    content: String(row.content_md || ''),
    model: String(row.model || ''),
    createdAt: toNumber(row.created_at),
    chars: String(row.content_md || '').length
  };
}

export function restoreSummaryVersion(id: number): StoredSummary {
  const database = requireDb();
  const row = database
    .prepare('SELECT uid, video_id, content_md, model FROM summary_versions WHERE id = ?')
    .get(Number(id)) as
    { uid: string; video_id: number; content_md: string; model: string } | undefined;
  if (!row) throw new Error('总结版本不存在');

  const now = Date.now();
  database
    .prepare(
      `INSERT INTO summaries (uid, video_id, content_md, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET
         video_id = excluded.video_id,
         content_md = excluded.content_md,
         model = excluded.model,
         updated_at = excluded.updated_at`
    )
    .run(
      String(row.uid),
      toNumber(row.video_id),
      String(row.content_md || ''),
      String(row.model || ''),
      now,
      now
    );

  return {
    content: String(row.content_md || ''),
    model: String(row.model || ''),
    updatedAt: now
  };
}
