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
import { VIDEO_COLUMNS, kindOf, mapVideoRow, sourceOf, uidOf } from './library/core';
import { purgeExpiredTrash, removeVideos, trimTrash } from './library/trash';
import { markStaleJobs } from './library/jobs';
import { migrateSchema, schemaVersion } from './migrations';
import type {
  LibraryBundle,
  LibraryDetail,
  LibrarySort,
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

export {
  clearTrash,
  deleteTrash,
  listTrash,
  purgeExpiredTrash,
  removeVideos,
  restoreTrash,
  trimTrash
} from './library/trash';
export { addTagToVideos, deleteTag, listTags, renameTag, setVideoTags } from './library/tags';

export {
  addCollectionToVideos,
  addVideoToCollection,
  createCollection,
  deleteCollection,
  getCollectionMaterial,
  getCollectionSummary,
  getCollectionSummaryVersion,
  getVideoCollections,
  listCollectionSummaryVersions,
  listCollections,
  removeVideoFromCollection,
  renameCollection,
  restoreCollectionSummaryVersion,
  saveCollectionSummary
} from './library/collections';
export type { CollectionMaterial, CollectionMaterialBlock } from './library/collections';
