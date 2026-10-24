import type { DatabaseSync } from 'node:sqlite';
import type { PageInfo, LibraryVideo } from '../../shared/types';
import { toNumber } from './db';

/** 视频身份 / 来源 / 行映射等跨模块共用的小工具。 */
export function uidOf(info: PageInfo): string {
  if (info.bvid) return `v:${info.bvid}:${info.cid ?? 0}`;
  if (info.epId) return `e:${info.epId}:${info.cid ?? 0}`;
  return `u:${canonicalUrl(info.url) || info.title || Date.now()}`;
}

export function canonicalUrl(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return raw;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be' || host === 'youtube.com' || host === 'm.youtube.com') {
      const id =
        host === 'youtu.be'
          ? url.pathname.split('/').filter(Boolean)[0]
          : url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).pop();
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|spm_id_from|vd_source|share_source|share_medium|from_source)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = '';
    return url.toString();
  } catch {
    return raw;
  }
}

export function kindOf(info: PageInfo): string {
  if (info.kind === 'youtube' || info.bvid || info.epId)
    return info.kind === 'youtube' ? 'youtube' : 'video';
  if (info.kind === 'local' || /^file:\/\//i.test(info.url || '')) return 'local';
  if (info.kind === 'podcast') return 'podcast';
  if (info.kind === 'page') return 'page';
  return info.kind || 'page';
}

export function sourceOf(info: PageInfo): string {
  if (info.bvid || info.epId) return 'bilibili';
  if (info.kind === 'youtube') return 'youtube';
  if (info.kind === 'local' || /^file:\/\//i.test(info.url || '')) return 'local';
  if (info.kind === 'podcast') return 'podcast';
  try {
    return new URL(info.url).hostname.replace(/^www\./, '') || 'web';
  } catch {
    return 'web';
  }
}

export function mapVideoRow(row: Record<string, unknown>): LibraryVideo {
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
    kind: String(row.kind || ''),
    source: String(row.source || ''),
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

export function pruneOrphans(database: DatabaseSync): void {
  database
    .prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM video_tags)')
    .run();
  database
    .prepare(
      'DELETE FROM collections WHERE id NOT IN (SELECT DISTINCT collection_id FROM collection_items)'
    )
    .run();
}

export const VIDEO_COLUMNS = `
  SELECT v.id, v.bvid, v.cid, v.title, v.owner, v.duration, v.cover, v.url,
         v.kind, v.source, v.created_at, v.updated_at,
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
