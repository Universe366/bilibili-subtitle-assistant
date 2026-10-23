import type { AiToolDef } from './aiClient';
import { getLibraryDetail, listLibrary, searchLibrary } from './library';

/**
 * 提供给对话模型的本地只读工具。
 *
 * 只做查询：不写入、不删除、不发网络请求。写操作必须由用户确认后再做，
 * 所以这里故意不提供 save_note / delete 之类的工具。
 */
export const APP_TOOL_PREFIX = 'app__';

export const APP_TOOL_DEFS: AiToolDef[] = [
  {
    name: `${APP_TOOL_PREFIX}search_library`,
    description: '在当前本地字幕库里搜索视频、字幕、总结和笔记。需要引用用户自己的资料时使用。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索词，支持空格分隔多个关键词' },
        limit: { type: 'number', description: '返回条数，默认 8，最多 20' }
      },
      required: ['query']
    }
  },
  {
    name: `${APP_TOOL_PREFIX}read_library_item`,
    description: '读取本地库里某个条目的详情：标题、UP、已保存总结、笔记、标签和字幕片段。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: '库条目 id（可由 search_library 获得）' }
      },
      required: ['id']
    }
  },
  {
    name: `${APP_TOOL_PREFIX}list_recent`,
    description: '列出最近入库的条目，用于了解用户库里有什么。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回条数，默认 10，最多 30' }
      }
    }
  }
];

function clip(text: string, max: number): string {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max)}\n…（已截断）` : value;
}

function json(payload: unknown): string {
  return clip(JSON.stringify(payload, null, 2), 9000);
}

export async function callAppTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === `${APP_TOOL_PREFIX}search_library`) {
    const query = String(args.query || '').trim();
    if (!query) return json({ error: 'query 不能为空' });
    const result = searchLibrary(query, Math.min(20, Math.max(1, Number(args.limit) || 8)));
    return json({
      query: result.query,
      videos: result.videos.slice(0, 20).map((video) => ({
        id: video.id,
        title: video.title,
        owner: video.owner,
        tags: video.tags,
        collections: video.collections
      })),
      subtitleMatches: result.matches.slice(0, 12).map((match) => ({
        videoId: match.videoId,
        title: match.title,
        start: match.start,
        text: clip(match.text, 240)
      })),
      total: result.total
    });
  }

  if (name === `${APP_TOOL_PREFIX}read_library_item`) {
    const id = Number(args.id);
    if (!Number.isFinite(id) || id <= 0) return json({ error: 'id 无效' });
    const detail = getLibraryDetail(id);
    return json({
      id: detail.video.id,
      title: detail.video.title,
      owner: detail.video.owner,
      url: detail.video.url,
      tags: detail.video.tags,
      collections: detail.video.collections,
      summary: detail.summary ? clip(detail.summary.content, 6000) : null,
      note: detail.note ? clip(detail.note.content, 4000) : null,
      subtitlePreview: detail.bundle
        ? detail.bundle.lines.slice(0, 40).map((line) => `[${Math.floor(line.start)}s] ${line.text}`)
        : []
    });
  }

  if (name === `${APP_TOOL_PREFIX}list_recent`) {
    const limit = Math.min(30, Math.max(1, Number(args.limit) || 10));
    const videos = listLibrary('updated').videos.slice(0, limit);
    return json(
      videos.map((video) => ({
        id: video.id,
        title: video.title,
        owner: video.owner,
        tags: video.tags,
        hasSummary: Boolean(video.summaryUpdatedAt)
      }))
    );
  }

  return json({ error: `未知工具：${name}` });
}
