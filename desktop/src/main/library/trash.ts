import type { DatabaseSync } from 'node:sqlite';
import { isFtsEnabled, requireDb, toNumber } from './db';
import { pruneOrphans } from './core';
import type { TrashItem } from '../../shared/types';

/** 回收站：软删除快照、30 天/200 条保留、恢复与彻底删除。 */
const TRASH_KEEP_DAYS = 30;
const TRASH_LIMIT = 200;

interface TrashPayload {
  video: Record<string, unknown>;
  tracks: Array<Record<string, unknown> & { segments: Array<Record<string, unknown>> }>;
  summaries: Array<Record<string, unknown>>;
  summaryVersions: Array<Record<string, unknown>>;
  note: Record<string, unknown> | null;
  noteVersions: Array<Record<string, unknown>>;
  tags: string[];
  collections: string[];
}

function snapshotVideo(database: DatabaseSync, videoId: number): TrashPayload | null {
  const video = database.prepare('SELECT * FROM videos WHERE id = ?').get(videoId) as
    Record<string, unknown> | undefined;
  if (!video) return null;

  const tracks = (
    database.prepare('SELECT * FROM tracks WHERE video_id = ? ORDER BY id').all(videoId) as Array<
      Record<string, unknown>
    >
  ).map((track) => ({
    ...track,
    segments: database
      .prepare('SELECT start_ms, end_ms, text FROM segments WHERE track_id = ? ORDER BY start_ms')
      .all(Number(track.id)) as Array<Record<string, unknown>>
  }));

  return {
    video,
    tracks,
    summaries: database.prepare('SELECT * FROM summaries WHERE video_id = ?').all(videoId) as Array<
      Record<string, unknown>
    >,
    summaryVersions: database
      .prepare('SELECT * FROM summary_versions WHERE video_id = ? ORDER BY id')
      .all(videoId) as Array<Record<string, unknown>>,
    note:
      (database.prepare('SELECT * FROM notes WHERE video_id = ?').get(videoId) as
        Record<string, unknown> | undefined) || null,
    noteVersions: database
      .prepare('SELECT * FROM note_versions WHERE video_id = ? ORDER BY id')
      .all(videoId) as Array<Record<string, unknown>>,
    tags: (
      database
        .prepare(
          'SELECT t.name FROM tags t JOIN video_tags vt ON vt.tag_id = t.id WHERE vt.video_id = ?'
        )
        .all(videoId) as Array<{ name: string }>
    ).map((row) => String(row.name || '')),
    collections: (
      database
        .prepare(
          'SELECT c.name FROM collections c JOIN collection_items ci ON ci.collection_id = c.id WHERE ci.video_id = ?'
        )
        .all(videoId) as Array<{ name: string }>
    ).map((row) => String(row.name || ''))
  };
}

function addTrashEntry(database: DatabaseSync, videoId: number): boolean {
  const payload = snapshotVideo(database, videoId);
  if (!payload) return false;
  const video = payload.video;
  const lineCount = payload.tracks.reduce((total, track) => total + track.segments.length, 0);
  database
    .prepare(
      `INSERT INTO trash
         (video_id, uid, title, owner, track_count, line_count, has_summary, has_note, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      videoId,
      String(video.uid || ''),
      String(video.title || ''),
      String(video.owner || ''),
      payload.tracks.length,
      lineCount,
      payload.summaries.length > 0 ? 1 : 0,
      payload.note ? 1 : 0,
      JSON.stringify(payload),
      Date.now()
    );
  return true;
}

export function purgeExpiredTrash(days = TRASH_KEEP_DAYS): number {
  const database = requireDb();
  const cutoff = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000;
  return toNumber(database.prepare('DELETE FROM trash WHERE created_at < ?').run(cutoff).changes);
}

export function trimTrash(limit = TRASH_LIMIT): number {
  const database = requireDb();
  return toNumber(
    database
      .prepare(
        `DELETE FROM trash WHERE id NOT IN (
           SELECT id FROM trash ORDER BY created_at DESC, id DESC LIMIT ?)`
      )
      .run(Math.max(1, Math.round(limit))).changes
  );
}

export function removeVideos(ids: number[], options: { trash?: boolean } = {}): number {
  const database = requireDb();
  const clean = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (!clean.length) return 0;
  database.exec('BEGIN');
  try {
    let removed = 0;
    for (const id of clean) {
      if (options.trash !== false) addTrashEntry(database, id);
      if (isFtsEnabled()) {
        database
          .prepare(
            'DELETE FROM segments_fts WHERE rowid IN (SELECT s.id FROM segments s JOIN tracks t ON t.id = s.track_id WHERE t.video_id = ?)'
          )
          .run(id);
      }
      removed += toNumber(database.prepare('DELETE FROM videos WHERE id = ?').run(id).changes);
    }
    if (removed) pruneOrphans(database);
    database.exec('COMMIT');
    return removed;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  }
}

export function listTrash(limit = 200): TrashItem[] {
  const database = requireDb();
  const rows = database
    .prepare(
      `SELECT id, video_id, title, owner, track_count, line_count, has_summary, has_note, created_at
       FROM trash ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(Math.min(500, Math.max(1, Math.round(limit)))) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: toNumber(row.id),
    videoId: toNumber(row.video_id),
    title: String(row.title || ''),
    owner: String(row.owner || ''),
    trackCount: toNumber(row.track_count),
    lineCount: toNumber(row.line_count),
    hasSummary: toNumber(row.has_summary) > 0,
    hasNote: toNumber(row.has_note) > 0,
    deletedAt: toNumber(row.created_at)
  }));
}

export function restoreTrash(id: number): { videoId: number } {
  const database = requireDb();
  const row = database.prepare('SELECT id, payload FROM trash WHERE id = ?').get(Number(id)) as
    { id: number; payload: string } | undefined;
  if (!row) throw new Error('回收站记录不存在');

  let payload: TrashPayload;
  try {
    payload = JSON.parse(row.payload) as TrashPayload;
  } catch {
    throw new Error('回收站数据已损坏，无法恢复');
  }
  const video = payload.video || {};
  const uid = String(video.uid || '');
  if (!uid) throw new Error('回收站数据缺少条目标识');
  if (database.prepare('SELECT id FROM videos WHERE uid = ?').get(uid)) {
    throw new Error('同一个视频已经在库里，无法重复恢复');
  }

  const now = Date.now();
  database.exec('BEGIN');
  try {
    const videoResult = database
      .prepare(
        `INSERT INTO videos
           (uid, bvid, cid, ep_id, title, owner, duration, cover, pubdate, url, signature, kind, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        uid,
        video.bvid == null ? null : String(video.bvid),
        video.cid == null ? null : toNumber(video.cid),
        video.ep_id == null ? null : toNumber(video.ep_id),
        String(video.title || ''),
        String(video.owner || ''),
        toNumber(video.duration),
        video.cover == null ? null : String(video.cover),
        video.pubdate == null ? null : toNumber(video.pubdate),
        String(video.url || ''),
        String(video.signature || ''),
        String(video.kind || ''),
        String(video.source || ''),
        toNumber(video.created_at) || now,
        now
      );
    const videoId = toNumber(videoResult.lastInsertRowid);

    for (const track of payload.tracks || []) {
      const trackResult = database
        .prepare(
          `INSERT INTO tracks (video_id, lan, lan_doc, source, is_ai, url, line_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          videoId,
          String(track.lan || ''),
          String(track.lan_doc || track.lan || ''),
          String(track.source || ''),
          toNumber(track.is_ai) ? 1 : 0,
          String(track.url || ''),
          toNumber(track.line_count),
          toNumber(track.created_at) || now,
          toNumber(track.updated_at) || now
        );
      const trackId = toNumber(trackResult.lastInsertRowid);
      const insertSegment = database.prepare(
        'INSERT INTO segments (track_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?)'
      );
      const insertFts = isFtsEnabled()
        ? database.prepare('INSERT INTO segments_fts (rowid, text) VALUES (?, ?)')
        : null;
      for (const segment of track.segments || []) {
        const result = insertSegment.run(
          trackId,
          toNumber(segment.start_ms),
          toNumber(segment.end_ms),
          String(segment.text || '')
        );
        if (insertFts) insertFts.run(toNumber(result.lastInsertRowid), String(segment.text || ''));
      }
    }

    for (const summary of payload.summaries || []) {
      database
        .prepare(
          `INSERT INTO summaries (uid, video_id, content_md, model, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          String(summary.uid || ''),
          videoId,
          String(summary.content_md || ''),
          String(summary.model || ''),
          toNumber(summary.created_at) || now,
          toNumber(summary.updated_at) || now
        );
    }
    for (const version of payload.summaryVersions || []) {
      database
        .prepare(
          `INSERT INTO summary_versions (video_id, uid, content_md, model, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          videoId,
          String(version.uid || ''),
          String(version.content_md || ''),
          String(version.model || ''),
          toNumber(version.created_at) || now
        );
    }

    if (payload.note) {
      database
        .prepare(
          `INSERT INTO notes (video_id, content_md, created_at, updated_at) VALUES (?, ?, ?, ?)`
        )
        .run(
          videoId,
          String(payload.note.content_md || ''),
          toNumber(payload.note.created_at) || now,
          toNumber(payload.note.updated_at) || now
        );
    }
    for (const version of payload.noteVersions || []) {
      database
        .prepare('INSERT INTO note_versions (video_id, content_md, created_at) VALUES (?, ?, ?)')
        .run(videoId, String(version.content_md || ''), toNumber(version.created_at) || now);
    }

    for (const name of payload.tags || []) {
      const clean = String(name || '').trim();
      if (!clean) continue;
      database.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(clean);
      const tag = database.prepare('SELECT id FROM tags WHERE name = ?').get(clean) as
        { id: number } | undefined;
      if (tag) {
        database
          .prepare('INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)')
          .run(videoId, toNumber(tag.id));
      }
    }
    for (const name of payload.collections || []) {
      const clean = String(name || '').trim();
      if (!clean) continue;
      database
        .prepare('INSERT OR IGNORE INTO collections (name, created_at) VALUES (?, ?)')
        .run(clean, now);
      const collection = database
        .prepare('SELECT id FROM collections WHERE name = ?')
        .get(clean) as { id: number } | undefined;
      if (collection) {
        database
          .prepare(
            'INSERT OR IGNORE INTO collection_items (collection_id, video_id, added_at) VALUES (?, ?, ?)'
          )
          .run(toNumber(collection.id), videoId, now);
      }
    }

    database.prepare('DELETE FROM trash WHERE id = ?').run(Number(id));
    database.exec('COMMIT');
    return { videoId };
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  }
}

export function deleteTrash(id: number): boolean {
  const database = requireDb();
  return toNumber(database.prepare('DELETE FROM trash WHERE id = ?').run(Number(id)).changes) > 0;
}

export function clearTrash(): number {
  const database = requireDb();
  return toNumber(database.prepare('DELETE FROM trash').run().changes);
}
