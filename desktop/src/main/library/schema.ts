import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateSchema, schemaVersion } from '../migrations';
import {
  bindLibraryDatabase,
  hasLibraryDatabase,
  isFtsEnabled,
  libraryFilePath,
  releaseLibraryDatabase,
  requireDb,
  setFtsEnabled,
  setLibraryInitializer
} from './db';
import { markStaleJobs } from './jobs';
import { purgeExpiredTrash, trimTrash } from './trash';

/** 库 schema、初始化与生命周期（打开 / 关闭 / 压缩 / 版本）。 */
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
