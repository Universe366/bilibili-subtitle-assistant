import { requireDb, toNumber } from './db';
import type {
  Bookmark,
  HistoryEntry,
  LibraryHistoryItem,
  LibraryTranscriptionItem
} from '../../shared/types';

/** 历史记录、转录记录、浏览历史与书签。 */
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
    { video_id: number } | undefined;
  if (row) {
    // 删除总结时把版本一起清掉，否则「历史版本」还能把已删内容恢复回来。
    database.prepare('DELETE FROM summary_versions WHERE video_id = ?').run(Number(row.video_id));
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

const HISTORY_LIMIT = 5000;

/** 记录一次网页访问；60 秒内同一 URL 只更新标题/时间，避免 SPA 刷出几十条。 */
export function recordHistory(input: {
  url: string;
  title?: string;
  favicon?: string | null;
}): void {
  const url = String(input?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return;
  const database = requireDb();
  const now = Date.now();
  const title = String(input.title || '').slice(0, 300);
  const favicon = input.favicon ? String(input.favicon) : null;
  const recent = database
    .prepare(
      'SELECT id, title, visited_at FROM history WHERE url = ? ORDER BY visited_at DESC LIMIT 1'
    )
    .get(url) as { id: number; title: string; visited_at: number } | undefined;

  if (recent && now - Number(recent.visited_at) < 60_000) {
    database
      .prepare(
        'UPDATE history SET visited_at = ?, title = ?, favicon = COALESCE(?, favicon) WHERE id = ?'
      )
      .run(now, title || recent.title || '', favicon, recent.id);
  } else {
    database
      .prepare('INSERT INTO history (url, title, favicon, visited_at) VALUES (?, ?, ?, ?)')
      .run(url, title, favicon, now);
    database
      .prepare(
        'DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY visited_at DESC LIMIT ?)'
      )
      .run(HISTORY_LIMIT);
  }
}

export function listBrowseHistory(query = '', limit = 100): HistoryEntry[] {
  const database = requireDb();
  const text = String(query || '').trim();
  const capped = Math.min(500, Math.max(1, Math.round(limit)));
  const rows = (
    text
      ? database
          .prepare(
            `SELECT id, url, title, favicon, visited_at FROM history
             WHERE url LIKE ? OR title LIKE ?
             ORDER BY visited_at DESC LIMIT ?`
          )
          .all(`%${text}%`, `%${text}%`, capped)
      : database
          .prepare(
            'SELECT id, url, title, favicon, visited_at FROM history ORDER BY visited_at DESC LIMIT ?'
          )
          .all(capped)
  ) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: toNumber(row.id),
    url: String(row.url || ''),
    title: String(row.title || ''),
    favicon: row.favicon == null ? null : String(row.favicon),
    visitedAt: toNumber(row.visited_at)
  }));
}

export function clearBrowseHistory(): number {
  const database = requireDb();
  return toNumber(database.prepare('DELETE FROM history').run().changes);
}

export function listBookmarks(): Bookmark[] {
  const database = requireDb();
  const rows = database
    .prepare('SELECT id, url, title, favicon, created_at FROM bookmarks ORDER BY created_at DESC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: toNumber(row.id),
    url: String(row.url || ''),
    title: String(row.title || ''),
    favicon: row.favicon == null ? null : String(row.favicon),
    createdAt: toNumber(row.created_at)
  }));
}

export function isBookmarked(url: string): boolean {
  const database = requireDb();
  return Boolean(database.prepare('SELECT id FROM bookmarks WHERE url = ?').get(String(url || '')));
}

export function toggleBookmark(input: { url: string; title?: string; favicon?: string | null }): {
  bookmarked: boolean;
} {
  const database = requireDb();
  const url = String(input?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('只能收藏网页地址');
  const existing = database.prepare('SELECT id FROM bookmarks WHERE url = ?').get(url) as
    { id: number } | undefined;
  if (existing) {
    database.prepare('DELETE FROM bookmarks WHERE id = ?').run(existing.id);
    return { bookmarked: false };
  }
  database
    .prepare('INSERT INTO bookmarks (url, title, favicon, created_at) VALUES (?, ?, ?, ?)')
    .run(url, String(input.title || url).slice(0, 300), input.favicon || null, Date.now());
  return { bookmarked: true };
}

export function removeBookmark(url: string): boolean {
  const database = requireDb();
  return (
    toNumber(database.prepare('DELETE FROM bookmarks WHERE url = ?').run(String(url)).changes) > 0
  );
}
