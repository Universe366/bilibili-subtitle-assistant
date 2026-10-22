import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  LibraryBundle,
  LibraryHistoryItem,
  LibraryTranscriptionItem,
  LibraryIngestPayload,
  LibraryIngestResult,
  LibraryList,
  LibrarySearchMatch,
  LibrarySearchResult,
  LibraryStats,
  LibraryVideo,
  PageInfo,
  StoredSummary,
  SummaryRef
} from '../shared/types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  bvid TEXT,
  cid INTEGER,
  ep_id INTEGER,
  title TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  duration REAL NOT NULL DEFAULT 0,
  cover TEXT,
  pubdate INTEGER,
  url TEXT NOT NULL DEFAULT '',
  signature TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  lan TEXT NOT NULL DEFAULT '',
  lan_doc TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  is_ai INTEGER NOT NULL DEFAULT 0,
  url TEXT NOT NULL DEFAULT '',
  line_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(video_id, lan, source)
);

CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  content_md TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_summaries_video ON summaries(video_id);

CREATE INDEX IF NOT EXISTS idx_segments_track ON segments(track_id, start_ms);
CREATE INDEX IF NOT EXISTS idx_tracks_video ON tracks(video_id);
CREATE INDEX IF NOT EXISTS idx_videos_updated ON videos(updated_at DESC);
`;

let db: DatabaseSync | null = null;
let dbFile = '';
let ftsEnabled = true;

export function initLibrary(): void {
  if (db) return;
  dbFile = path.join(app.getPath('userData'), 'library.db');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(text, tokenize='trigram');");
  } catch (error) {
    ftsEnabled = false;
    console.warn('[library] FTS5 不可用，退化为 LIKE 搜索:', (error as Error).message);
  }
  console.log('[library] ready', dbFile, `fts=${ftsEnabled}`);
}

export function checkpointLibrary(): void {
  const database = requireDb();
  try {
    database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    // WAL 可能已被其他连接占用，备份仍会复制主库文件
  }
}

export function closeLibrary(): void {
  try {
    db?.close();
  } catch {
    // ignore
  }
  db = null;
}

export function libraryPath(): string {
  return dbFile;
}

function requireDb(): DatabaseSync {
  if (!db) initLibrary();
  if (!db) throw new Error('数据库未初始化');
  return db;
}

function uidOf(info: PageInfo): string {
  if (info.bvid) return `v:${info.bvid}:${info.cid ?? 0}`;
  if (info.epId) return `e:${info.epId}:${info.cid ?? 0}`;
  return `u:${info.url || info.title || Date.now()}`;
}

function toNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function ensureVideo(
  database: DatabaseSync,
  info: PageInfo,
  now: number
): { videoId: number; created: boolean } {
  const uid = uidOf(info);
  const existing = database.prepare('SELECT id FROM videos WHERE uid = ?').get(uid) as
    | { id: number }
    | undefined;

  database
    .prepare(
      `INSERT INTO videos (uid, bvid, cid, ep_id, title, owner, duration, cover, pubdate, url, signature, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET
         bvid = excluded.bvid,
         cid = excluded.cid,
         ep_id = excluded.ep_id,
         title = excluded.title,
         owner = excluded.owner,
         duration = excluded.duration,
         cover = excluded.cover,
         pubdate = excluded.pubdate,
         url = excluded.url,
         signature = excluded.signature,
         updated_at = excluded.updated_at`
    )
    .run(
      uid,
      info.bvid ?? null,
      info.cid ?? null,
      info.epId ?? null,
      info.title || '',
      info.owner || '',
      toNumber(info.duration),
      info.cover ?? null,
      info.pubdate ?? null,
      info.url || '',
      info.signature || '',
      now,
      now
    );

  const row = database.prepare('SELECT id FROM videos WHERE uid = ?').get(uid) as { id: number };
  return { videoId: Number(row.id), created: !existing };
}

export function ingestVideo(payload: LibraryIngestPayload): LibraryIngestResult {
  const database = requireDb();
  const { info, track, lines } = payload || ({} as LibraryIngestPayload);

  if (!info) throw new Error('缺少视频信息');
  if (!track || !track.url) throw new Error('缺少字幕轨');
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('字幕正文为空');
  if (lines.length > 50000) throw new Error('字幕行数异常');

  const now = Date.now();
  const cleaned = lines
    .map((line) => {
      const start = Math.max(0, Math.round(toNumber(line.start) * 1000));
      const end = Math.max(start, Math.round(toNumber(line.end) * 1000));
      return { start, end, text: String(line.text || '').trim() };
    })
    .filter((line) => line.text.length > 0);

  if (!cleaned.length) throw new Error('字幕正文为空');

  database.exec('BEGIN');
  try {
    const { videoId, created } = ensureVideo(database, info, now);

    database
      .prepare(
        `INSERT INTO tracks (video_id, lan, lan_doc, source, is_ai, url, line_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id, lan, source) DO UPDATE SET
           lan_doc = excluded.lan_doc,
           is_ai = excluded.is_ai,
           url = excluded.url,
           line_count = excluded.line_count,
           updated_at = excluded.updated_at`
      )
      .run(
        videoId,
        track.lan || '',
        track.lanDoc || track.lan || '',
        track.source || '',
        track.isAi ? 1 : 0,
        track.url,
        cleaned.length,
        now,
        now
      );

    const trackRow = database
      .prepare('SELECT id FROM tracks WHERE video_id = ? AND lan = ? AND source = ?')
      .get(videoId, track.lan || '', track.source || '') as { id: number };
    const trackId = Number(trackRow.id);

    if (ftsEnabled) {
      database
        .prepare('DELETE FROM segments_fts WHERE rowid IN (SELECT id FROM segments WHERE track_id = ?)')
        .run(trackId);
    }
    database.prepare('DELETE FROM segments WHERE track_id = ?').run(trackId);

    const insert = database.prepare(
      'INSERT INTO segments (track_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?)'
    );
    const insertFts = ftsEnabled
      ? database.prepare('INSERT INTO segments_fts (rowid, text) VALUES (?, ?)')
      : null;

    for (const line of cleaned) {
      const result = insert.run(trackId, line.start, line.end, line.text);
      if (insertFts) insertFts.run(Number(result.lastInsertRowid), line.text);
    }

    database
      .prepare('UPDATE tracks SET line_count = ?, updated_at = ? WHERE id = ?')
      .run(cleaned.length, now, trackId);
    database.exec('COMMIT');

    return { videoId, trackId, lineCount: cleaned.length, created };
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  }
}

export function listLibrary(): LibraryList {
  const database = requireDb();
  const rows = database
    .prepare(
      `SELECT v.id, v.bvid, v.cid, v.title, v.owner, v.duration, v.cover, v.url, v.updated_at,
              (SELECT COUNT(*) FROM tracks t WHERE t.video_id = v.id) AS track_count,
              (SELECT COALESCE(SUM(t.line_count), 0) FROM tracks t WHERE t.video_id = v.id) AS line_count
       FROM videos v
       ORDER BY v.updated_at DESC
       LIMIT 500`
    )
    .all() as Array<Record<string, unknown>>;

  const statsRow = database
    .prepare(
      `SELECT (SELECT COUNT(*) FROM videos) AS videos,
              (SELECT COUNT(*) FROM tracks) AS tracks,
              (SELECT COUNT(*) FROM segments) AS segments`
    )
    .get() as Record<string, unknown>;

  let bytes = 0;
  for (const file of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try {
      bytes += fs.statSync(file).size;
    } catch {
      // 文件可能尚未生成
    }
  }

  const stats: LibraryStats = {
    videos: toNumber(statsRow.videos),
    tracks: toNumber(statsRow.tracks),
    segments: toNumber(statsRow.segments),
    bytes
  };

  const videos: LibraryVideo[] = rows.map((row) => ({
    id: toNumber(row.id),
    bvid: row.bvid == null ? null : String(row.bvid),
    cid: row.cid == null ? null : toNumber(row.cid),
    title: String(row.title || ''),
    owner: String(row.owner || ''),
    duration: toNumber(row.duration),
    cover: row.cover == null ? null : String(row.cover),
    url: String(row.url || ''),
    updatedAt: toNumber(row.updated_at),
    trackCount: toNumber(row.track_count),
    lineCount: toNumber(row.line_count)
  }));

  return { videos, stats };
}

function sanitizeQuery(input: string): string {
  return String(input || '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim()
    .slice(0, 100);
}

export function searchLibrary(input: string, limit = 60): LibrarySearchResult {
  const database = requireDb();
  const query = sanitizeQuery(input);
  if (!query) return { query: '', total: 0, matches: [], mode: 'like' };

  const useFts = ftsEnabled && query.length >= 3;
  const parameter = useFts ? `"${query.replace(/"/g, '""')}"` : `%${query}%`;

  const selectSql = useFts
    ? `SELECT s.start_ms, s.end_ms, s.text, v.id AS video_id, v.bvid, v.title, v.owner, v.cover, v.url, t.lan_doc
       FROM segments_fts
       JOIN segments s ON s.id = segments_fts.rowid
       JOIN tracks t ON t.id = s.track_id
       JOIN videos v ON v.id = t.video_id
       WHERE segments_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    : `SELECT s.start_ms, s.end_ms, s.text, v.id AS video_id, v.bvid, v.title, v.owner, v.cover, v.url, t.lan_doc
       FROM segments s
       JOIN tracks t ON t.id = s.track_id
       JOIN videos v ON v.id = t.video_id
       WHERE s.text LIKE ?
       ORDER BY v.updated_at DESC, s.start_ms ASC
       LIMIT ?`;

  const countSql = useFts
    ? 'SELECT COUNT(*) AS total FROM segments_fts WHERE segments_fts MATCH ?'
    : 'SELECT COUNT(*) AS total FROM segments WHERE text LIKE ?';

  let rows: Array<Record<string, unknown>> = [];
  let total = 0;
  try {
    rows = database.prepare(selectSql).all(parameter, limit) as Array<Record<string, unknown>>;
    total = toNumber((database.prepare(countSql).get(parameter) as { total?: unknown })?.total);
  } catch (error) {
    console.warn('[library] 搜索失败:', (error as Error).message);
    return { query, total: 0, matches: [], mode: useFts ? 'fts' : 'like' };
  }

  const matches: LibrarySearchMatch[] = rows.map((row) => ({
    videoId: toNumber(row.video_id),
    bvid: row.bvid == null ? null : String(row.bvid),
    title: String(row.title || ''),
    owner: String(row.owner || ''),
    cover: row.cover == null ? null : String(row.cover),
    url: String(row.url || ''),
    start: toNumber(row.start_ms) / 1000,
    end: toNumber(row.end_ms) / 1000,
    text: String(row.text || ''),
    lanDoc: String(row.lan_doc || '')
  }));

  return { query, total, matches, mode: useFts ? 'fts' : 'like' };
}

export function removeVideo(id: number): boolean {
  const database = requireDb();
  if (ftsEnabled) {
    database
      .prepare(
        'DELETE FROM segments_fts WHERE rowid IN (SELECT s.id FROM segments s JOIN tracks t ON t.id = s.track_id WHERE t.video_id = ?)'
      )
      .run(id);
  }
  const result = database.prepare('DELETE FROM videos WHERE id = ?').run(id);
  return toNumber(result.changes) > 0;
}

export function saveSummary(
  info: PageInfo,
  content: string,
  model: string
): { id: number; updated: boolean } {
  if (!content.trim()) throw new Error('总结内容为空');
  const database = requireDb();
  const now = Date.now();
  const uid = uidOf(info);
  const existing = database.prepare('SELECT id FROM summaries WHERE uid = ?').get(uid) as
    | { id: number }
    | undefined;

  database.exec('BEGIN');
  try {
    const { videoId } = ensureVideo(database, info, now);
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
      .run(uid, videoId, content, model, now, now);
    database.exec('COMMIT');
    const row = database.prepare('SELECT id FROM summaries WHERE uid = ?').get(uid) as { id: number };
    return { id: Number(row.id), updated: Boolean(existing) };
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

  const row = database
    .prepare('SELECT content_md, model, updated_at FROM summaries WHERE uid = ?')
    .get(uid) as { content_md: string; model: string; updated_at: number } | undefined;

  if (!row) return null;
  return {
    content: String(row.content_md || ''),
    model: String(row.model || ''),
    updatedAt: toNumber(row.updated_at)
  };
}


export function libraryVideoBundle(videoId: number): LibraryBundle {
  const database = requireDb();
  const video = database
    .prepare('SELECT * FROM videos WHERE id = ?')
    .get(videoId) as Record<string, unknown> | undefined;
  if (!video) throw new Error('视频不存在');
  const trackRow = database
    .prepare(
      'SELECT * FROM tracks WHERE video_id = ? ORDER BY line_count DESC, updated_at DESC LIMIT 1'
    )
    .get(videoId) as Record<string, unknown> | undefined;
  if (!trackRow) throw new Error('视频没有字幕轨');
  const rows = database
    .prepare('SELECT start_ms, end_ms, text FROM segments WHERE track_id = ? ORDER BY start_ms')
    .all(Number(trackRow.id)) as Array<Record<string, unknown>>;

  const info: PageInfo = {
    kind: 'video',
    bvid: video.bvid ? String(video.bvid) : null,
    aid: null,
    cid: video.cid == null ? null : Number(video.cid),
    epId: video.ep_id == null ? null : Number(video.ep_id),
    seasonId: null,
    page: 1,
    partTitle: '',
    parts: [],
    title: String(video.title || ''),
    owner: String(video.owner || ''),
    desc: '',
    duration: Number(video.duration) || 0,
    url: String(video.url || ''),
    signature: String(video.signature || '')
  };

  return {
    info,
    track: {
      lan: String(trackRow.lan || ''),
      lanDoc: String(trackRow.lan_doc || trackRow.lan || ''),
      url: String(trackRow.url || ''),
      isAi: Boolean(trackRow.is_ai),
      aiStatus: null,
      source: String(trackRow.source || '')
    },
    lines: rows.map((row) => ({
      start: toNumber(row.start_ms) / 1000,
      end: toNumber(row.end_ms) / 1000,
      text: String(row.text || '')
    }))
  };
}

export function listHistory(limit = 100): LibraryHistoryItem[] {
  const database = requireDb();
  const rows = database
    .prepare(
      `SELECT s.id, s.video_id, v.bvid, v.cid, v.title, v.owner, v.url, s.model, s.content_md, s.updated_at
       FROM summaries s JOIN videos v ON v.id = s.video_id
       ORDER BY s.updated_at DESC
       LIMIT ?`
    )
    .all(Math.min(500, Math.max(1, Math.round(limit)))) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id),
    videoId: Number(row.video_id),
    bvid: row.bvid ? String(row.bvid) : null,
    cid: row.cid == null ? null : Number(row.cid),
    title: String(row.title || ''),
    owner: String(row.owner || ''),
    url: String(row.url || ''),
    model: String(row.model || ''),
    content: String(row.content_md || ''),
    updatedAt: toNumber(row.updated_at)
  }));
}

export function deleteHistoryItem(id: number): boolean {
  const database = requireDb();
  const result = database.prepare('DELETE FROM summaries WHERE id = ?').run(Number(id));
  return Number(result.changes) > 0;
}

export function clearHistory(): number {
  const database = requireDb();
  const result = database.prepare('DELETE FROM summaries').run();
  return Number(result.changes) || 0;
}


export function listTranscriptions(limit = 200): LibraryTranscriptionItem[] {
  const database = requireDb();
  const rows = database
    .prepare(
      `SELECT v.id, v.bvid, v.title, v.owner, v.url, v.updated_at,
              COUNT(t.id) AS track_count,
              COALESCE(SUM(t.line_count), 0) AS line_count,
              COALESCE(MAX(t.lan_doc), '') AS lan_doc
       FROM videos v JOIN tracks t ON t.video_id = v.id
       GROUP BY v.id
       ORDER BY v.updated_at DESC
       LIMIT ?`
    )
    .all(Math.min(500, Math.max(1, Math.round(limit)))) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    videoId: Number(row.id),
    bvid: row.bvid ? String(row.bvid) : null,
    title: String(row.title || ''),
    owner: String(row.owner || ''),
    url: String(row.url || ''),
    trackCount: Number(row.track_count) || 0,
    lineCount: Number(row.line_count) || 0,
    updatedAt: toNumber(row.updated_at),
    lanDoc: String(row.lan_doc || '')
  }));
}
