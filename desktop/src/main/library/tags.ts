import { requireDb, toNumber } from './db';
import type { LibraryTag } from '../../shared/types';

/** 标签：列表、改名、删除、批量打标。 */
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
