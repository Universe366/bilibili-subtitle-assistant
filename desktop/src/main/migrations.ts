import type { DatabaseSync } from 'node:sqlite';

/**
 * 数据库结构版本。
 *
 * 之前只有 `CREATE TABLE IF NOT EXISTS`，老库不会补列，也没有版本号。
 * 现在用 `PRAGMA user_version` 记录版本，迁移只能顺序向前，每一步都必须幂等，
 * 这样「给 videos 加 kind/source」这类改动才有地方落。
 */
export const LATEST_SCHEMA_VERSION = 3;

interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'baseline',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          applied_at INTEGER NOT NULL
        );
      `);
      db.prepare(
        'INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
      ).run(1, 'baseline', Date.now());
    }
  },
  {
    version: 2,
    name: 'trash',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS trash (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          video_id INTEGER NOT NULL,
          uid TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          owner TEXT NOT NULL DEFAULT '',
          track_count INTEGER NOT NULL DEFAULT 0,
          line_count INTEGER NOT NULL DEFAULT 0,
          has_summary INTEGER NOT NULL DEFAULT 0,
          has_note INTEGER NOT NULL DEFAULT 0,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_trash_created ON trash(created_at DESC);
      `);
    }
  },
  {
    version: 3,
    name: 'browser',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          favicon TEXT,
          visited_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_history_visited ON history(visited_at DESC);
        CREATE INDEX IF NOT EXISTS idx_history_url ON history(url);

        CREATE TABLE IF NOT EXISTS bookmarks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL DEFAULT '',
          favicon TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS downloads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT NOT NULL,
          filename TEXT NOT NULL DEFAULT '',
          path TEXT NOT NULL DEFAULT '',
          state TEXT NOT NULL DEFAULT 'progressing',
          total INTEGER NOT NULL DEFAULT 0,
          received INTEGER NOT NULL DEFAULT 0,
          started_at INTEGER NOT NULL,
          finished_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_downloads_started ON downloads(started_at DESC);
      `);
    }
  }
];

export function schemaVersion(db: DatabaseSync): number {
  try {
    const row = db.prepare('PRAGMA user_version').get() as Record<string, unknown> | undefined;
    const value = Number(row?.user_version);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function migrateSchema(db: DatabaseSync): { from: number; to: number; applied: string[] } {
  const from = schemaVersion(db);
  const applied: string[] = [];
  if (from >= LATEST_SCHEMA_VERSION) return { from, to: from, applied };

  db.exec('BEGIN');
  try {
    for (const migration of MIGRATIONS) {
      if (migration.version <= from) continue;
      migration.up(db);
      applied.push(`${migration.version}:${migration.name}`);
    }
    // 版本号只能到这里由代码写入，不能从外部拼进来。
    db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION};`);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  }
  return { from, to: LATEST_SCHEMA_VERSION, applied };
}
