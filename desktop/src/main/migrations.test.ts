import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { LATEST_SCHEMA_VERSION, migrateSchema, schemaVersion } from './migrations';

function open(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY, title TEXT);');
  return db;
}

function hasTable(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { name?: string } | undefined;
  return Boolean(row?.name);
}

describe('migrateSchema', () => {
  it('空库从 0 升到最新版本', () => {
    const db = open();
    const result = migrateSchema(db);
    expect(result.from).toBe(0);
    expect(result.to).toBe(LATEST_SCHEMA_VERSION);
    expect(result.applied).toHaveLength(LATEST_SCHEMA_VERSION);
    expect(schemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(hasTable(db, 'schema_migrations')).toBe(true);
    expect(hasTable(db, 'trash')).toBe(true);
    db.close();
  });

  it('重复执行是幂等的', () => {
    const db = open();
    migrateSchema(db);
    const again = migrateSchema(db);
    expect(again.from).toBe(LATEST_SCHEMA_VERSION);
    expect(again.applied).toHaveLength(0);
    const rows = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
      count: number;
    };
    expect(Number(rows.count)).toBe(1);
    db.close();
  });

  it('已经是最新版本时不再改动', () => {
    const db = open();
    db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION};`);
    const version = schemaVersion(db);
    expect(version).toBe(LATEST_SCHEMA_VERSION);
    expect(migrateSchema(db).applied).toHaveLength(0);
    db.close();
  });
});
