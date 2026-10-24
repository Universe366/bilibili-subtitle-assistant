import type { DatabaseSync } from 'node:sqlite';
import { isFtsEnabled, requireDb, toNumber } from './db';
import { VIDEO_COLUMNS, mapVideoRow } from './core';
import type {
  CollectionSearchHit,
  GlobalSearchResult,
  LibrarySearchMatch,
  LibrarySearchResult,
  LibraryVideo,
  SummarySearchHit
} from '../../shared/types';

/** 库内全文检索：字幕段落、总结、合集对比。 */
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

/** 标题 / UP / 标签 / 合集 / 笔记命中：和字幕命中分开返回，避免搜标题时得到「没有匹配的字幕」。 */
function searchVideoRows(database: DatabaseSync, terms: string[]): LibraryVideo[] {
  if (!terms.length) return [];
  const where = terms
    .map(
      () =>
        `(v.title LIKE ? OR v.owner LIKE ?
          OR v.id IN (SELECT vt.video_id FROM video_tags vt
                      JOIN tags tg ON tg.id = vt.tag_id WHERE tg.name LIKE ?)
          OR v.id IN (SELECT ci.video_id FROM collection_items ci
                      JOIN collections cl ON cl.id = ci.collection_id WHERE cl.name LIKE ?)
          OR v.id IN (SELECT nt.video_id FROM notes nt WHERE nt.content_md LIKE ?))`
    )
    .join(' AND ');
  const params = terms.flatMap((term) => {
    const pattern = `%${term}%`;
    return [pattern, pattern, pattern, pattern, pattern];
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
  const useFts = isFtsEnabled() && terms.every((term) => term.length >= 3);
  const likeParams = terms.map((term) => `%${term}%`);
  const where = useFts ? 'segments_fts MATCH ?' : terms.map(() => 's.text LIKE ?').join(' AND ');
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
  const text = String(content || '')
    .replace(/\s+/g, ' ')
    .trim();
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
    .all(...params, Math.min(50, Math.max(1, Math.round(limit)))) as Array<Record<string, unknown>>;

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
  const collections = searchCollectionSummaries(input, 8);
  const items = library.videos.slice(0, 8);
  const lines = library.matches.slice(0, 30);
  return {
    query: library.query,
    items,
    lines,
    summaries,
    collections,
    total: library.total + library.videos.length + summaries.length + collections.length
  };
}

export function searchCollectionSummaries(input: string, limit = 8): CollectionSearchHit[] {
  const database = requireDb();
  const terms = searchTerms(input);
  if (!terms.length) return [];
  const where = terms.map(() => 'cs.content_md LIKE ?').join(' AND ');
  const params = terms.map((term) => `%${term}%`);
  const rows = database
    .prepare(
      `SELECT cs.collection_id, cs.content_md, cs.updated_at, cl.name
       FROM collection_summaries cs JOIN collections cl ON cl.id = cs.collection_id
       WHERE ${where}
       ORDER BY cs.updated_at DESC
       LIMIT ?`
    )
    .all(...params, Math.min(30, Math.max(1, Math.round(limit)))) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    collectionId: toNumber(row.collection_id),
    name: String(row.name || ''),
    snippet: snippetAround(String(row.content_md || ''), terms[0]),
    updatedAt: toNumber(row.updated_at)
  }));
}
