import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  bindLibraryDatabase,
  hasLibraryDatabase,
  libraryFilePath,
  releaseLibraryDatabase,
  isFtsEnabled,
  requireDb,
  setFtsEnabled,
  setLibraryInitializer,
  toNumber
} from './library/db';
import { VIDEO_COLUMNS, kindOf, mapVideoRow, pruneOrphans, sourceOf, uidOf } from './library/core';
import { markStaleJobs } from './library/jobs';
import { migrateSchema, schemaVersion } from './migrations';
import type {
  CollectionSummary,
  CollectionSummaryVersion,
  CollectionSummaryVersionMeta,
  LibraryBundle,
  LibraryCollection,
  LibraryDetail,
  LibrarySort,
  LibraryTag,
  LibraryIngestPayload,
  LibraryIngestResult,
  LibraryList,
  LibraryNote,
  NoteVersion,
  NoteVersionMeta,
  LibraryStats,
  PageInfo,
  StoredSummary,
  SummaryRef,
  SummaryVersion,
  SummaryVersionMeta,
  TrashItem
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

CREATE TABLE IF NOT EXISTS notes (
  video_id INTEGER PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  content_md TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS note_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  content_md TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_note_versions_video
  ON note_versions(video_id, created_at DESC);

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

CREATE TABLE IF NOT EXISTS collection_summaries (
  collection_id INTEGER PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,
  content_md TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  item_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_summary_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  content_md TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  item_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collection_summary_versions
  ON collection_summary_versions(collection_id, created_at DESC);

CREATE TABLE IF NOT EXISTS exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exports_created ON exports(created_at DESC);

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

let staleChecked = false;
let schemaState = { from: 0, to: 0 };

const TRASH_KEEP_DAYS = 30;
const TRASH_LIMIT = 200;

export function initLibrary(): void {
  if (hasLibraryDatabase()) return;
  const file = path.join(app.getPath('userData'), 'library.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  bindLibraryDatabase(database, file);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec(SCHEMA);

  try {
    const result = migrateSchema(database);
    schemaState = { from: result.from, to: result.to };
    if (result.applied.length) {
      console.log(
        '[library] schema migrated',
        result.from,
        '→',
        result.to,
        result.applied.join(',')
      );
    }
  } catch (error) {
    console.warn('[library] schema 迁移失败:', (error as Error).message);
    throw error;
  }

  // 回收站只保留 30 天 / 最近 200 条，避免删掉的大文件一直占盘。
  try {
    purgeExpiredTrash();
    trimTrash();
  } catch (error) {
    console.warn('[library] 回收站清理失败:', (error as Error).message);
  }

  // 老库只有最新一份总结：升级时补一条版本记录，之后每次生成都会追加。
  try {
    database.exec(
      `INSERT INTO summary_versions (video_id, uid, content_md, model, created_at)
       SELECT s.video_id, s.uid, s.content_md, s.model, s.updated_at
       FROM summaries s
       WHERE NOT EXISTS (SELECT 1 FROM summary_versions v WHERE v.uid = s.uid)`
    );
  } catch (error) {
    console.warn('[library] 总结版本迁移失败:', (error as Error).message);
  }

  // 老库的合集对比也只有最新一份，同样补一条版本记录。
  try {
    database.exec(
      `INSERT INTO collection_summary_versions
         (collection_id, content_md, model, item_count, created_at)
       SELECT cs.collection_id, cs.content_md, cs.model, cs.item_count, cs.updated_at
       FROM collection_summaries cs
       WHERE NOT EXISTS (
         SELECT 1 FROM collection_summary_versions v WHERE v.collection_id = cs.collection_id)`
    );
  } catch (error) {
    console.warn('[library] 合集对比版本迁移失败:', (error as Error).message);
  }

  try {
    database.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(text, tokenize='trigram');"
    );
  } catch (error) {
    setFtsEnabled(false);
    console.warn('[library] FTS5 不可用，退化为 LIKE 搜索:', (error as Error).message);
  }
  if (!staleChecked) {
    staleChecked = true;
    const interrupted = markStaleJobs();
    if (interrupted) console.warn('[library] 标记中断任务', interrupted);
  }
  console.log('[library] ready', file, `fts=${isFtsEnabled()}`);
}

setLibraryInitializer(initLibrary);

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
    if (hasLibraryDatabase()) requireDb().close();
  } catch {
    // ignore
  }
  releaseLibraryDatabase();
}

export function libraryPath(): string {
  return libraryFilePath();
}

export function librarySchemaVersion(): number {
  return hasLibraryDatabase() ? schemaVersion(requireDb()) : schemaState.to;
}

/** 压缩数据库：删除大条目后回收磁盘空间，并刷新查询计划统计。 */
export function vacuumLibrary(): { before: number; after: number } {
  const database = requireDb();
  const file = libraryFilePath();
  const before = fs.existsSync(file) ? fs.statSync(file).size : 0;
  try {
    database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    database.exec('PRAGMA optimize;');
    database.exec('VACUUM;');
  } catch (error) {
    throw new Error(`压缩数据库失败：${(error as Error).message}`, { cause: error });
  }
  const after = fs.existsSync(file) ? fs.statSync(file).size : 0;
  return { before, after };
}

function ensureVideo(
  database: DatabaseSync,
  info: PageInfo,
  now: number
): { videoId: number; created: boolean } {
  const uid = uidOf(info);
  const existing = database.prepare('SELECT id FROM videos WHERE uid = ?').get(uid) as
    { id: number } | undefined;

  database
    .prepare(
      `INSERT INTO videos (uid, bvid, cid, ep_id, title, owner, duration, cover, pubdate, url, signature, kind, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         kind = excluded.kind,
         source = excluded.source,
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
      kindOf(info),
      sourceOf(info),
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

    if (isFtsEnabled()) {
      database
        .prepare(
          'DELETE FROM segments_fts WHERE rowid IN (SELECT id FROM segments WHERE track_id = ?)'
        )
        .run(trackId);
    }
    database.prepare('DELETE FROM segments WHERE track_id = ?').run(trackId);

    const insert = database.prepare(
      'INSERT INTO segments (track_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?)'
    );
    const insertFts = isFtsEnabled()
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

const LIBRARY_ORDER: Record<LibrarySort, string> = {
  updated: 'v.updated_at DESC',
  created: 'v.created_at DESC',
  title: 'v.title COLLATE NOCASE ASC, v.updated_at DESC',
  duration: 'v.duration DESC, v.updated_at DESC'
};

export function listLibrary(sort: LibrarySort = 'updated'): LibraryList {
  const database = requireDb();
  const order = LIBRARY_ORDER[sort] || LIBRARY_ORDER.updated;
  const rows = database.prepare(`${VIDEO_COLUMNS} ORDER BY ${order} LIMIT 500`).all() as Array<
    Record<string, unknown>
  >;

  const statsRow = database
    .prepare(
      `SELECT (SELECT COUNT(*) FROM videos) AS videos,
              (SELECT COUNT(*) FROM tracks) AS tracks,
              (SELECT COUNT(*) FROM segments) AS segments`
    )
    .get() as Record<string, unknown>;

  let bytes = 0;
  const dbFile = libraryFilePath();
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
    const name = String(raw || '')
      .trim()
      .slice(0, 24);
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
  const to = String(newName || '')
    .trim()
    .slice(0, 24);
  if (!to) throw new Error('标签名称不能为空');
  if (!from || from === to) return;

  const source = database.prepare('SELECT id FROM tags WHERE name = ?').get(from) as
    { id: number } | undefined;
  if (!source) throw new Error('标签不存在');
  const sourceId = Number(source.id);
  const target = database.prepare('SELECT id FROM tags WHERE name = ?').get(to) as
    { id: number } | undefined;

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
    if (/UNIQUE/i.test((error as Error).message)) throw new Error('已有同名标签', { cause: error });
    throw error;
  }
}

export function deleteTag(name: string): boolean {
  const database = requireDb();
  const clean = String(name || '').trim();
  const row = database.prepare('SELECT id FROM tags WHERE name = ?').get(clean) as
    { id: number } | undefined;
  if (!row) return false;
  const id = Number(row.id);
  database.prepare('DELETE FROM video_tags WHERE tag_id = ?').run(id);
  const result = database.prepare('DELETE FROM tags WHERE id = ?').run(id);
  return toNumber(result.changes) > 0;
}

export function addTagToVideos(videoIds: number[], name: string): number {
  const database = requireDb();
  const clean = String(name || '')
    .trim()
    .slice(0, 24);
  if (!clean) throw new Error('标签名称不能为空');
  const ids = [...new Set(videoIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return 0;

  database.exec('BEGIN');
  try {
    database.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(clean);
    const tag = database.prepare('SELECT id FROM tags WHERE name = ?').get(clean) as
      { id: number } | undefined;
    if (!tag) throw new Error('标签创建失败');
    const link = database.prepare(
      'INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)'
    );
    let linked = 0;
    for (const id of ids) {
      const exists = database.prepare('SELECT id FROM videos WHERE id = ?').get(id);
      if (!exists) continue;
      linked += toNumber(link.run(id, Number(tag.id)).changes);
    }
    database.exec('COMMIT');
    return linked;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  }
}

export function createCollection(name: string): LibraryCollection {
  const database = requireDb();
  const clean = String(name || '')
    .trim()
    .slice(0, 40);
  if (!clean) throw new Error('合集名称不能为空');
  database
    .prepare('INSERT OR IGNORE INTO collections (name, created_at) VALUES (?, ?)')
    .run(clean, Date.now());
  const row = database.prepare('SELECT id, name FROM collections WHERE name = ?').get(clean) as
    { id: number; name: string } | undefined;
  if (!row) throw new Error('合集创建失败');
  return { id: Number(row.id), name: String(row.name || clean), count: 0 };
}

export function addCollectionToVideos(videoIds: number[], name: string): number {
  const database = requireDb();
  const clean = String(name || '')
    .trim()
    .slice(0, 40);
  if (!clean) throw new Error('合集名称不能为空');
  const ids = [...new Set(videoIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return 0;

  const now = Date.now();
  database.exec('BEGIN');
  try {
    database
      .prepare('INSERT OR IGNORE INTO collections (name, created_at) VALUES (?, ?)')
      .run(clean, now);
    const collection = database.prepare('SELECT id FROM collections WHERE name = ?').get(clean) as
      { id: number } | undefined;
    if (!collection) throw new Error('合集创建失败');
    const link = database.prepare(
      'INSERT OR IGNORE INTO collection_items (collection_id, video_id, added_at) VALUES (?, ?, ?)'
    );
    let linked = 0;
    for (const id of ids) {
      const exists = database.prepare('SELECT id FROM videos WHERE id = ?').get(id);
      if (!exists) continue;
      linked += toNumber(link.run(Number(collection.id), id, now).changes);
    }
    database.exec('COMMIT');
    return linked;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  }
}

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
  const clean = String(name || '')
    .trim()
    .slice(0, 40);
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
      { id: number } | undefined;
    if (row) {
      database
        .prepare(
          'INSERT OR IGNORE INTO collection_items (collection_id, video_id, added_at) VALUES (?, ?, ?)'
        )
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
    { id: number } | undefined;
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
  const clean = String(name || '')
    .trim()
    .slice(0, 40);
  if (!clean) throw new Error('合集名称不能为空');
  const exists = database.prepare('SELECT id FROM collections WHERE id = ?').get(Number(id));
  if (!exists) throw new Error('合集不存在');
  try {
    database.prepare('UPDATE collections SET name = ? WHERE id = ?').run(clean, Number(id));
  } catch (error) {
    if (/UNIQUE/i.test((error as Error).message)) throw new Error('已有同名合集', { cause: error });
    throw error;
  }
}

export function deleteCollection(id: number): boolean {
  const database = requireDb();
  const result = database.prepare('DELETE FROM collections WHERE id = ?').run(Number(id));
  return toNumber(result.changes) > 0;
}

export interface CollectionMaterialBlock {
  videoId: number;
  title: string;
  owner: string;
  duration: number;
  source: 'summary' | 'transcript';
  text: string;
}

export interface CollectionMaterial {
  id: number;
  name: string;
  itemCount: number;
  blocks: CollectionMaterialBlock[];
}

const TRANSCRIPT_BUDGET = 12000;
const TOTAL_BUDGET = 90000;

export function getCollectionMaterial(collectionId: number): CollectionMaterial {
  const database = requireDb();
  const id = Number(collectionId);
  const collection = database.prepare('SELECT id, name FROM collections WHERE id = ?').get(id) as
    { id: number; name: string } | undefined;
  if (!collection) throw new Error('合集不存在');

  const rows = database
    .prepare(
      `SELECT v.id, v.title, v.owner, v.duration
       FROM collection_items ci JOIN videos v ON v.id = ci.video_id
       WHERE ci.collection_id = ?
       ORDER BY ci.added_at ASC, v.id ASC`
    )
    .all(id) as Array<Record<string, unknown>>;

  const blocks: CollectionMaterialBlock[] = [];
  let remaining = TOTAL_BUDGET;

  for (const row of rows) {
    if (remaining <= 0) break;
    const videoId = toNumber(row.id);
    const summary = database
      .prepare(
        `SELECT content_md FROM summaries WHERE video_id = ?
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(videoId) as { content_md: string } | undefined;

    let source: CollectionMaterialBlock['source'] = 'summary';
    let text = summary ? String(summary.content_md || '').trim() : '';
    if (!text) {
      source = 'transcript';
      const lines = database
        .prepare(
          `SELECT sg.text FROM segments sg
           WHERE sg.track_id = (
             SELECT id FROM tracks WHERE video_id = ? ORDER BY line_count DESC LIMIT 1
           )
           ORDER BY sg.start_ms ASC`
        )
        .all(videoId) as Array<{ text: string }>;
      text = lines
        .map((line) => String(line.text || ''))
        .join('\n')
        .trim();
    }
    if (!text) continue;
    const budget = Math.min(TRANSCRIPT_BUDGET, remaining);
    if (text.length > budget) {
      text = `${text.slice(0, budget - 200)}\n…（内容过长，已截断）`;
    }
    remaining -= text.length;
    blocks.push({
      videoId,
      title: String(row.title || ''),
      owner: String(row.owner || ''),
      duration: toNumber(row.duration),
      source,
      text
    });
  }

  return {
    id,
    name: String(collection.name || ''),
    itemCount: blocks.length,
    blocks
  };
}

export function getCollectionSummary(collectionId: number): CollectionSummary | null {
  const database = requireDb();
  const row = database
    .prepare(
      `SELECT collection_id, content_md, model, item_count, updated_at
       FROM collection_summaries WHERE collection_id = ?`
    )
    .get(Number(collectionId)) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    collectionId: toNumber(row.collection_id),
    content: String(row.content_md || ''),
    model: String(row.model || ''),
    itemCount: toNumber(row.item_count),
    updatedAt: toNumber(row.updated_at)
  };
}

export function saveCollectionSummary(
  collectionId: number,
  content: string,
  model: string,
  itemCount: number
): CollectionSummary {
  const database = requireDb();
  const id = Number(collectionId);
  const now = Date.now();
  const text = String(content || '').trim();
  if (!text) throw new Error('对比总结为空');
  database
    .prepare(
      `INSERT INTO collection_summaries (collection_id, content_md, model, item_count, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(collection_id) DO UPDATE SET
         content_md = excluded.content_md,
         model = excluded.model,
         item_count = excluded.item_count,
         updated_at = excluded.updated_at`
    )
    .run(id, text, String(model || ''), Number(itemCount) || 0, now);

  const latest = database
    .prepare(
      `SELECT content_md FROM collection_summary_versions
       WHERE collection_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`
    )
    .get(id) as { content_md: string } | undefined;
  if (!latest || latest.content_md !== text) {
    database
      .prepare(
        `INSERT INTO collection_summary_versions
           (collection_id, content_md, model, item_count, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, text, String(model || ''), Number(itemCount) || 0, now);
    database
      .prepare(
        `DELETE FROM collection_summary_versions WHERE collection_id = ? AND id NOT IN (
           SELECT id FROM collection_summary_versions WHERE collection_id = ?
           ORDER BY created_at DESC, id DESC LIMIT 20)`
      )
      .run(id, id);
  }

  return {
    collectionId: id,
    content: text,
    model: String(model || ''),
    itemCount: Number(itemCount) || 0,
    updatedAt: now
  };
}

export function listCollectionSummaryVersions(
  collectionId: number,
  limit = 20
): CollectionSummaryVersionMeta[] {
  const database = requireDb();
  const rows = database
    .prepare(
      `SELECT id, model, item_count, created_at, length(content_md) AS chars
       FROM collection_summary_versions WHERE collection_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(Number(collectionId), Math.min(50, Math.max(1, Math.round(limit)))) as Array<
    Record<string, unknown>
  >;
  return rows.map((row) => ({
    id: toNumber(row.id),
    model: String(row.model || ''),
    itemCount: toNumber(row.item_count),
    createdAt: toNumber(row.created_at),
    chars: toNumber(row.chars)
  }));
}

export function getCollectionSummaryVersion(id: number): CollectionSummaryVersion | null {
  const database = requireDb();
  const row = database
    .prepare(
      `SELECT id, collection_id, content_md, model, item_count, created_at
       FROM collection_summary_versions WHERE id = ?`
    )
    .get(Number(id)) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: toNumber(row.id),
    collectionId: toNumber(row.collection_id),
    content: String(row.content_md || ''),
    model: String(row.model || ''),
    itemCount: toNumber(row.item_count),
    createdAt: toNumber(row.created_at),
    chars: String(row.content_md || '').length
  };
}

export function restoreCollectionSummaryVersion(id: number): CollectionSummary {
  const database = requireDb();
  const row = database
    .prepare(
      `SELECT collection_id, content_md, model, item_count
       FROM collection_summary_versions WHERE id = ?`
    )
    .get(Number(id)) as
    { collection_id: number; content_md: string; model: string; item_count: number } | undefined;
  if (!row) throw new Error('对比版本不存在');
  return saveCollectionSummary(
    Number(row.collection_id),
    String(row.content_md || ''),
    String(row.model || ''),
    Number(row.item_count) || 0
  );
}

export function removeVideo(id: number): boolean {
  return removeVideos([Number(id)]) > 0;
}

export function saveSummary(
  info: PageInfo,
  content: string,
  model: string
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
    .prepare('SELECT content_md, model, updated_at FROM summaries WHERE uid = ?')
    .get(uid) as { content_md: string; model: string; updated_at: number } | undefined;

  // 页面 cid 可能取不到/变化；按 bvid 兜底，避免重开视频找不到已保存总结。
  if (!row && ref.bvid) {
    row = database
      .prepare(
        'SELECT content_md, model, updated_at FROM summaries WHERE uid LIKE ? ORDER BY updated_at DESC LIMIT 1'
      )
      .get(`v:${ref.bvid}:%`) as
      { content_md: string; model: string; updated_at: number } | undefined;
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

export function libraryVideoBundle(videoId: number): LibraryBundle {
  const database = requireDb();
  const video = database.prepare('SELECT * FROM videos WHERE id = ?').get(videoId) as
    Record<string, unknown> | undefined;
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
    kind: String(video.kind || 'video'),
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
  const row = database.prepare(`${VIDEO_COLUMNS} WHERE v.id = ?`).get(Number(videoId)) as
    Record<string, unknown> | undefined;
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
    .get(Number(videoId)) as { content_md: string; model: string; updated_at: number } | undefined;

  return {
    video: mapVideoRow(row),
    bundle,
    summary: summaryRow
      ? {
          content: String(summaryRow.content_md || ''),
          model: String(summaryRow.model || ''),
          updatedAt: toNumber(summaryRow.updated_at)
        }
      : null,
    note: getNote(Number(videoId))
  };
}

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

// 兼容旧 import：下载/任务/导出记录拆出后仍按原路径导出。
export {
  addDownload,
  clearDownloads,
  deleteDownload,
  listDownloads,
  updateDownload
} from './library/downloads';
export {
  clearFinishedJobs,
  createJob,
  createJobItem,
  finishJob,
  getJob,
  listJobs,
  markStaleJobs,
  setJobsListener,
  updateJob,
  updateJobItem
} from './library/jobs';
export { addExportRecord, clearExports, deleteExport, listExports } from './library/exports';
export type { JobsListener } from './library/jobs';

// 兼容旧 import：检索与历史域拆出后仍按原路径导出。
export {
  globalSearch,
  searchCollectionSummaries,
  searchLibrary,
  searchSummaries
} from './library/search';
export {
  clearBrowseHistory,
  clearHistory,
  deleteHistoryItem,
  isBookmarked,
  listBookmarks,
  listBrowseHistory,
  listHistory,
  listTranscriptions,
  recordHistory,
  removeBookmark,
  toggleBookmark
} from './library/history';
