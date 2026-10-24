import { requireDb, toNumber } from './db';
import type { LibraryNote, NoteVersion, NoteVersionMeta } from '../../shared/types';

/** 条目笔记与笔记版本。 */
export function getNote(videoId: number): LibraryNote | null {
  const database = requireDb();
  const row = database
    .prepare('SELECT content_md, updated_at FROM notes WHERE video_id = ?')
    .get(Number(videoId)) as { content_md: string; updated_at: number } | undefined;
  if (!row) return null;
  return {
    videoId: Number(videoId),
    content: String(row.content_md || ''),
    updatedAt: toNumber(row.updated_at)
  };
}

export function saveNote(videoId: number, content: string): LibraryNote | null {
  const database = requireDb();
  const id = Number(videoId);
  if (!database.prepare('SELECT id FROM videos WHERE id = ?').get(id)) {
    throw new Error('视频不存在');
  }
  const text = String(content || '');
  if (!text.trim()) {
    database.prepare('DELETE FROM notes WHERE video_id = ?').run(id);
    database.prepare('DELETE FROM note_versions WHERE video_id = ?').run(id);
    return null;
  }
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO notes (video_id, content_md, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET
         content_md = excluded.content_md,
         updated_at = excluded.updated_at`
    )
    .run(id, text, now, now);

  const latest = database
    .prepare(
      'SELECT content_md FROM note_versions WHERE video_id = ? ORDER BY created_at DESC, id DESC LIMIT 1'
    )
    .get(id) as { content_md: string } | undefined;
  if (!latest || latest.content_md !== text) {
    database
      .prepare('INSERT INTO note_versions (video_id, content_md, created_at) VALUES (?, ?, ?)')
      .run(id, text, now);
    database
      .prepare(
        `DELETE FROM note_versions WHERE video_id = ? AND id NOT IN (
           SELECT id FROM note_versions WHERE video_id = ?
           ORDER BY created_at DESC, id DESC LIMIT 20)`
      )
      .run(id, id);
  }
  return { videoId: id, content: text, updatedAt: now };
}

export function listNoteVersions(videoId: number, limit = 20): NoteVersionMeta[] {
  const database = requireDb();
  const rows = database
    .prepare(
      `SELECT id, created_at, length(content_md) AS chars
       FROM note_versions WHERE video_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(Number(videoId), Math.min(50, Math.max(1, Math.round(limit)))) as Array<
    Record<string, unknown>
  >;
  return rows.map((row) => ({
    id: toNumber(row.id),
    createdAt: toNumber(row.created_at),
    chars: toNumber(row.chars)
  }));
}

export function getNoteVersion(id: number): NoteVersion | null {
  const database = requireDb();
  const row = database
    .prepare('SELECT id, video_id, content_md, created_at FROM note_versions WHERE id = ?')
    .get(Number(id)) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: toNumber(row.id),
    videoId: toNumber(row.video_id),
    content: String(row.content_md || ''),
    createdAt: toNumber(row.created_at),
    chars: String(row.content_md || '').length
  };
}
