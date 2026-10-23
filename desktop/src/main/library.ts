import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  GlobalSearchResult,
  JobItem,
  JobItemStatus,
  JobRecord,
  JobStatus,
  JobType,
  LibraryBundle,
  LibraryCollection,
  LibraryDetail,
  LibraryHistoryItem,
  LibrarySort,
  LibraryTag,
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
  SummaryRef,
  SummarySearchHit,
  SummaryVersion,
  SummaryVersionMeta
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

CREATE TABLE IF NOT EXISTS summary_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  content_md TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_summary_versions_video
  ON summary_versions(video_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS video_tags (
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (video_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_video_tags_tag ON video_tags(tag_id);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (collection_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_items_video ON collection_items(video_id);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  progress REAL NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  error TEXT,
  meta_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS job_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  progress REAL NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  error TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE(job_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_updated ON jobs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_items_job ON job_items(job_id);

CREATE INDEX IF NOT EXISTS idx_segments_track ON segments(track_id, start_ms);
CREATE INDEX IF NOT EXISTS idx_tracks_video ON tracks(video_id);
CREATE INDEX IF NOT EXISTS idx_videos_updated ON videos(updated_at DESC);
`;

let db: DatabaseSync | null = null;
let dbFile = '';
let ftsEnabled = true;
let staleChecked = false;

export function initLibrary(): void {
  if (db) return;
  dbFile = path.join(app.getPath('userData'), 'library.db');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  // 老库只有最新一份总结：升级时补一条版本记录，之后每次生成都会追加。
  try {
    db.exec(
      `INSERT INTO summary_versions (video_id, uid, content_md, model, created_at)
       SELECT s.video_id, s.uid, s.content_md, s.model, s.updated_at
       FROM summaries s
       WHERE NOT EXISTS (SELECT 1 FROM summary_versions v WHERE v.uid = s.uid)`
    );
  } catch (error) {
    console.warn('[library] 总结版本迁移失败:', (error as Error).message);
  }

  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(text, tokenize='trigram');");
  } catch (error) {
    ftsEnabled = false;
    console.warn('[library] FTS5 不可用，退化为 LIKE 搜索:', (error as Error).message);
  }
  if (!staleChecked) {
    staleChecked = true;
    const interrupted = markStaleJobs();
    if (interrupted) console.warn('[library] 标记中断任务', interrupted);
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

const VIDEO_COLUMNS = `
  SELECT v.id, v.bvid, v.cid, v.title, v.owner, v.duration, v.cover, v.url,
         v.created_at, v.updated_at,
         (SELECT COUNT(*) FROM tracks t WHERE t.video_id = v.id) AS track_count,
         (SELECT COALESCE(SUM(t.line_count), 0) FROM tracks t WHERE t.video_id = v.id) AS line_count,
         (SELECT MAX(s.updated_at) FROM summaries s WHERE s.video_id = v.id) AS summary_at,
         (SELECT s.model FROM summaries s WHERE s.video_id = v.id
            ORDER BY s.updated_at DESC LIMIT 1) AS summary_model,
         (SELECT group_concat(tg.name, char(31)) FROM video_tags vt
            JOIN tags tg ON tg.id = vt.tag_id WHERE vt.video_id = v.id) AS tags,
         (SELECT group_concat(cl.name, char(30)) FROM collection_items ci
            JOIN collections cl ON cl.id = ci.collection_id
            WHERE ci.video_id = v.id) AS collections,
         (SELECT COALESCE(SUM(length(sg.text)), 0) FROM segments sg
            JOIN tracks t2 ON t2.id = sg.track_id WHERE t2.video_id = v.id) AS char_count
  FROM videos v`;

function mapVideoRow(row: Record<string, unknown>): LibraryVideo {
  const summaryAt = row.summary_at == null ? null : toNumber(row.summary_at);
  return {
    id: toNumber(row.id),
    bvid: row.bvid == null ? null : String(row.bvid),
    cid: row.cid == null ? null : toNumber(row.cid),
    title: String(row.title || ''),
    owner: String(row.owner || ''),
    duration: toNumber(row.duration),
    cover: row.cover == null ? null : String(row.cover),
    url: String(row.url || ''),
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
    summaryUpdatedAt: summaryAt && summaryAt > 0 ? summaryAt : null,
    summaryModel: row.summary_model == null ? undefined : String(row.summary_model),
    tags: row.tags == null ? [] : String(row.tags).split('\u001f').filter(Boolean),
    collections:
      row.collections == null ? [] : String(row.collections).split('\u001e').filter(Boolean),
    trackCount: toNumber(row.track_count),
    lineCount: toNumber(row.line_count),
    chars: toNumber(row.char_count)
  };
}

const LIBRARY_ORDER: Record<LibrarySort, string> = {
  updated: 'v.updated_at DESC',
  created: 'v.created_at DESC',
  title: 'v.title COLLATE NOCASE ASC, v.updated_at DESC',
  duration: 'v.duration DESC, v.updated_at DESC'
};

export function listLibrary(sort: LibrarySort = 'updated'): LibraryList {
  const database = requireDb();
  const order = LIBRARY_ORDER[sort] || LIBRARY_ORDER.updated;
  const rows = database
    .prepare(`${VIDEO_COLUMNS} ORDER BY ${order} LIMIT 500`)
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

  return { videos: rows.map(mapVideoRow), stats, total: stats.videos };
}

export function listTags(): LibraryTag[] {
  const database = requireDb();
  const rows = database
    .prepare(
      `SELECT tg.name, COUNT(vt.video_id) AS count
       FROM tags tg LEFT JOIN video_tags vt ON vt.tag_id = tg.id
       GROUP BY tg.id
       ORDER BY count DESC, tg.name ASC`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    name: String(row.name || ''),
    count: toNumber(row.count)
  }));
}

export function setVideoTags(videoId: number, names: string[]): string[] {
  const database = requireDb();
  const id = Number(videoId);
  const exists = database.prepare('SELECT id FROM videos WHERE id = ?').get(id);
  if (!exists) throw new Error('视频不存在');

  const clean: string[] = [];
  for (const raw of Array.isArray(names) ? names : []) {
    const name = String(raw || '').trim().slice(0, 24);
    if (!name) continue;
    if (clean.some((item) => item.toLowerCase() === name.toLowerCase())) continue;
    clean.push(name);
    if (clean.length >= 8) break;
  }

  database.exec('BEGIN');
  try {
    database.prepare('DELETE FROM video_tags WHERE video_id = ?').run(id);
    const insertTag = database.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
    const findTag = database.prepare('SELECT id FROM tags WHERE name = ?');
    const link = database.prepare(
      'INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)'
    );
    for (const name of clean) {
      insertTag.run(name);
      const row = findTag.get(name) as { id: number } | undefined;
      if (row) link.run(id, Number(row.id));
    }
    database
      .prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM video_tags)')
      .run();
    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  }
  return clean;
}

export function renameTag(oldName: string, newName: string): void {
  const database = requireDb();
  const from = String(oldName || '').trim();
  const to = String(newName || '').trim().slice(0, 24);
  if (!to) throw new Error('标签名称不能为空');
  if (!from || from === to) return;

  const source = database.prepare('SELECT id FROM tags WHERE name = ?').get(from) as
    | { id: number }
    | undefined;
  if (!source) throw new Error('标签不存在');
  const sourceId = Number(source.id);
  const target = database.prepare('SELECT id FROM tags WHERE name = ?').get(to) as
    | { id: number }
    | undefined;

  database.exec('BEGIN');
  try {
    if (target && Number(target.id) !== sourceId) {
      // 目标标签已存在：把关联并过去，再删掉旧标签（合并）。
      database
        .prepare(
          'INSERT OR IGNORE INTO video_tags (video_id, tag_id) SELECT video_id, ? FROM video_tags WHERE tag_id = ?'
        )
        .run(Number(target.id), sourceId);
      database.prepare('DELETE FROM video_tags WHERE tag_id = ?').run(sourceId);
      database.prepare('DELETE FROM tags WHERE id = ?').run(sourceId);
    } else {
      database.prepare('UPDATE tags SET name = ? WHERE id = ?').run(to, sourceId);
    }
    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // ignore
    }
    if (/UNIQUE/i.test((error as Error).message)) throw new Error('已有同名标签');
    throw error;
  }
}

export function deleteTag(name: string): boolean {
  const database = requireDb();
  const clean = String(name || '').trim();
  const row = database.prepare('SELECT id FROM tags WHERE name = ?').get(clean) as
    | { id: number }
    | undefined;
  if (!row) return false;
  const id = Number(row.id);
  database.prepare('DELETE FROM video_tags WHERE tag_id = ?').run(id);
  const result = database.prepare('DELETE FROM tags WHERE id = ?').run(id);
  return toNumber(result.changes) > 0;
}

export function listCollections(): LibraryCollection[] {
  const database = requireDb();
  const rows = database
    .prepare(
      `SELECT cl.id, cl.name, COUNT(ci.video_id) AS count
       FROM collections cl LEFT JOIN collection_items ci ON ci.collection_id = cl.id
       GROUP BY cl.id
       ORDER BY cl.name COLLATE NOCASE ASC`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: toNumber(row.id),
    name: String(row.name || ''),
    count: toNumber(row.count)
  }));
}

export function getVideoCollections(videoId: number): string[] {
  const database = requireDb();
  const rows = database
    .prepare(
      `SELECT cl.name FROM collection_items ci
       JOIN collections cl ON cl.id = ci.collection_id
       WHERE ci.video_id = ? ORDER BY cl.name COLLATE NOCASE ASC`
    )
    .all(Number(videoId)) as Array<Record<string, unknown>>;
  return rows.map((row) => String(row.name || '')).filter(Boolean);
}

export function addVideoToCollection(videoId: number, name: string): string[] {
  const database = requireDb();
  const id = Number(videoId);
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) throw new Error('合集名称不能为空');
  if (!database.prepare('SELECT id FROM videos WHERE id = ?').get(id)) {
    throw new Error('视频不存在');
  }

  const now = Date.now();
  database.exec('BEGIN');
  try {
    database
      .prepare('INSERT OR IGNORE INTO collections (name, created_at) VALUES (?, ?)')
      .run(clean, now);
    const row = database.prepare('SELECT id FROM collections WHERE name = ?').get(clean) as
      | { id: number }
      | undefined;
    if (row) {
      database
        .prepare('INSERT OR IGNORE INTO collection_items (collection_id, video_id, added_at) VALUES (?, ?, ?)')
        .run(Number(row.id), id, now);
    }
    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  }
  return getVideoCollections(id);
}

export function removeVideoFromCollection(videoId: number, name: string): string[] {
  const database = requireDb();
  const id = Number(videoId);
  const clean = String(name || '').trim();
  const row = database.prepare('SELECT id FROM collections WHERE name = ?').get(clean) as
    | { id: number }
    | undefined;
  if (row) {
    const collectionId = Number(row.id);
    database
      .prepare('DELETE FROM collection_items WHERE collection_id = ? AND video_id = ?')
      .run(collectionId, id);
    // 合集空了就删掉，避免筛选器里堆一串空名字。
    database
      .prepare(
        `DELETE FROM collections WHERE id = ? AND NOT EXISTS (
           SELECT 1 FROM collection_items WHERE collection_id = ?)`
      )
      .run(collectionId, collectionId);
  }
  return getVideoCollections(id);
}

export function renameCollection(id: number, name: string): void {
  const database = requireDb();
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) throw new Error('合集名称不能为空');
  const exists = database.prepare('SELECT id FROM collections WHERE id = ?').get(Number(id));
  if (!exists) throw new Error('合集不存在');
  try {
    database.prepare('UPDATE collections SET name = ? WHERE id = ?').run(clean, Number(id));
  } catch (error) {
    if (/UNIQUE/i.test((error as Error).message)) throw new Error('已有同名合集');
    throw error;
  }
}

export function deleteCollection(id: number): boolean {
  const database = requireDb();
  const result = database.prepare('DELETE FROM collections WHERE id = ?').run(Number(id));
  return toNumber(result.changes) > 0;
}

function sanitizeQuery(input: string): string {
  return String(input || '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim()
    .slice(0, 100);
}

function searchTerms(input: string): string[] {
  return sanitizeQuery(input)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function ftsExpression(terms: string[]): string {
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' AND ');
}

/** 标题 / UP / 标签 / 合集命中：和字幕命中分开返回，避免搜标题时得到「没有匹配的字幕」。 */
function searchVideoRows(database: DatabaseSync, terms: string[]): LibraryVideo[] {
  if (!terms.length) return [];
  const where = terms
    .map(
      () =>
        `(v.title LIKE ? OR v.owner LIKE ?
          OR v.id IN (SELECT vt.video_id FROM video_tags vt
                      JOIN tags tg ON tg.id = vt.tag_id WHERE tg.name LIKE ?)
          OR v.id IN (SELECT ci.video_id FROM collection_items ci
                      JOIN collections cl ON cl.id = ci.collection_id WHERE cl.name LIKE ?))`
    )
    .join(' AND ');
  const params = terms.flatMap((term) => {
    const pattern = `%${term}%`;
    return [pattern, pattern, pattern, pattern];
  });
  const rows = database
    .prepare(`${VIDEO_COLUMNS} WHERE ${where} ORDER BY v.updated_at DESC LIMIT 20`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapVideoRow);
}

export function searchLibrary(input: string, limit = 60): LibrarySearchResult {
  const database = requireDb();
  const terms = searchTerms(input);
  if (!terms.length) {
    return { query: '', total: 0, matches: [], videos: [], mode: 'like' };
  }

  const videos = searchVideoRows(database, terms);
  // trigram 分词对 <3 字的词不生效；任何一个词过短就退回 LIKE。
  const useFts = ftsEnabled && terms.every((term) => term.length >= 3);
  const likeParams = terms.map((term) => `%${term}%`);
  const where = useFts
    ? 'segments_fts MATCH ?'
    : terms.map(() => 's.text LIKE ?').join(' AND ');
  const params = useFts ? [ftsExpression(terms)] : likeParams;

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
       WHERE ${where}
       ORDER BY v.updated_at DESC, s.start_ms ASC
       LIMIT ?`;

  const countSql = useFts
    ? 'SELECT COUNT(*) AS total FROM segments_fts WHERE segments_fts MATCH ?'
    : `SELECT COUNT(*) AS total FROM segments s WHERE ${where}`;

  let rows: Array<Record<string, unknown>> = [];
  let total = 0;
  try {
    rows = database.prepare(selectSql).all(...params, limit) as Array<Record<string, unknown>>;
    total = toNumber((database.prepare(countSql).get(...params) as { total?: unknown })?.total);
  } catch (error) {
    console.warn('[library] 搜索失败:', (error as Error).message);
    return {
      query: sanitizeQuery(input),
      total: 0,
      matches: [],
      videos,
      mode: useFts ? 'fts' : 'like'
    };
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

  return {
    query: sanitizeQuery(input),
    total,
    matches,
    videos,
    mode: useFts ? 'fts' : 'like'
  };
}

function snippetAround(content: string, term: string, radius = 70): string {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + term.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export function searchSummaries(input: string, limit = 12): SummarySearchHit[] {
  const database = requireDb();
  const terms = searchTerms(input);
  if (!terms.length) return [];
  const where = terms.map(() => 's.content_md LIKE ?').join(' AND ');
  const params = terms.map((term) => `%${term}%`);
  const rows = database
    .prepare(
      `SELECT s.video_id, s.content_md, s.updated_at,
              v.title, v.owner, v.url, v.bvid, v.cid
       FROM summaries s JOIN videos v ON v.id = s.video_id
       WHERE ${where}
       ORDER BY s.updated_at DESC
       LIMIT ?`
    )
    .all(...params, Math.min(50, Math.max(1, Math.round(limit)))) as Array<
    Record<string, unknown>
  >;

  return rows.map((row) => ({
    videoId: toNumber(row.video_id),
    title: String(row.title || ''),
    owner: String(row.owner || ''),
    url: String(row.url || ''),
    bvid: row.bvid == null ? null : String(row.bvid),
    cid: row.cid == null ? null : toNumber(row.cid),
    updatedAt: toNumber(row.updated_at),
    snippet: snippetAround(String(row.content_md || ''), terms[0])
  }));
}

export function globalSearch(input: string): GlobalSearchResult {
  const library = searchLibrary(input, 40);
  const summaries = searchSummaries(input, 12);
  const items = library.videos.slice(0, 8);
  const lines = library.matches.slice(0, 30);
  return {
    query: library.query,
    items,
    lines,
    summaries,
    total: library.total + library.videos.length + summaries.length
  };
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

  let row = database
    .prepare('SELECT content_md, model, updated_at FROM summaries WHERE uid = ?')
    .get(uid) as { content_md: string; model: string; updated_at: number } | undefined;

  // 页面 cid 可能取不到/变化；按 bvid 兜底，避免重开视频找不到已保存总结。
  if (!row && ref.bvid) {
    row = database
      .prepare(
        'SELECT content_md, model, updated_at FROM summaries WHERE uid LIKE ? ORDER BY updated_at DESC LIMIT 1'
      )
      .get(`v:${ref.bvid}:%`) as
      | { content_md: string; model: string; updated_at: number }
      | undefined;
  }

  if (!row) return null;
  return {
    content: String(row.content_md || ''),
    model: String(row.model || ''),
    updatedAt: toNumber(row.updated_at)
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
    | { uid: string; video_id: number; content_md: string; model: string }
    | undefined;
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

export function getLibraryDetail(videoId: number): LibraryDetail {
  const database = requireDb();
  const row = database
    .prepare(`${VIDEO_COLUMNS} WHERE v.id = ?`)
    .get(Number(videoId)) as Record<string, unknown> | undefined;
  if (!row) throw new Error('视频不存在');

  let bundle: LibraryBundle | null = null;
  try {
    bundle = libraryVideoBundle(Number(videoId));
  } catch {
    // 只存过总结、没有入库字幕的视频：详情页仍要能打开总结。
    bundle = null;
  }

  const summaryRow = database
    .prepare(
      `SELECT content_md, model, updated_at FROM summaries
       WHERE video_id = ? ORDER BY updated_at DESC LIMIT 1`
    )
    .get(Number(videoId)) as
    | { content_md: string; model: string; updated_at: number }
    | undefined;

  return {
    video: mapVideoRow(row),
    bundle,
    summary: summaryRow
      ? {
          content: String(summaryRow.content_md || ''),
          model: String(summaryRow.model || ''),
          updatedAt: toNumber(summaryRow.updated_at)
        }
      : null
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
  const row = database.prepare('SELECT video_id FROM summaries WHERE id = ?').get(Number(id)) as
    | { video_id: number }
    | undefined;
  if (row) {
    // 删除总结时把版本一起清掉，否则「历史版本」还能把已删内容恢复回来。
    database
      .prepare('DELETE FROM summary_versions WHERE video_id = ?')
      .run(Number(row.video_id));
  }
  const result = database.prepare('DELETE FROM summaries WHERE id = ?').run(Number(id));
  return Number(result.changes) > 0;
}

export function clearHistory(): number {
  const database = requireDb();
  database.prepare('DELETE FROM summary_versions').run();
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

/* ---------- 后台任务（任务中心） ---------- */

type JobsListener = () => void;

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
    .prepare(
      `UPDATE job_items SET ${fields.join(', ')} WHERE job_id = ? AND target_id = ?`
    )
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
  const items = itemsForJobs(database, rows.map((row) => String(row.id || '')));
  return rows.map((row) => mapJob(row, items.get(String(row.id || '')) || []));
}

export function getJob(id: string): JobRecord | null {
  const database = requireDb();
  const row = database.prepare('SELECT * FROM jobs WHERE id = ?').get(String(id)) as
    | Record<string, unknown>
    | undefined;
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
