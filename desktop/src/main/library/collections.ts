import { requireDb, toNumber } from './db';
import type {
  CollectionSummary,
  CollectionSummaryVersion,
  CollectionSummaryVersionMeta,
  LibraryCollection
} from '../../shared/types';

/** 合集：创建、增删、改名、合集对比材料与版本。 */
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
