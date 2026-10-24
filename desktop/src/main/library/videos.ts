import fs from 'node:fs';
import { isFtsEnabled, libraryFilePath, requireDb, toNumber } from './db';
import { VIDEO_COLUMNS, ensureVideo, mapVideoRow } from './core';
import { getNote } from './notes';
import { removeVideos } from './trash';
import type {
  LibraryBundle,
  LibraryDetail,
  LibraryIngestPayload,
  LibraryIngestResult,
  LibraryList,
  LibrarySort,
  LibraryStats,
  PageInfo
} from '../../shared/types';

/** 入库、列表、详情（把字幕/总结/笔记组装成渲染进程要的视图）。 */
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
