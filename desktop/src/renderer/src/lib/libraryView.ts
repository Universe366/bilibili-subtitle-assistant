import type { LibrarySort, LibraryVideo } from '../../../shared/types';
import { formatDuration } from './format';

export const SORTS: Array<{ id: LibrarySort; label: string }> = [
  { id: 'updated', label: '最近更新' },
  { id: 'created', label: '最近入库' },
  { id: 'title', label: '按标题' },
  { id: 'duration', label: '按时长' }
];

export const LINE_PAGE = 400;

const KIND_LABELS: Record<string, string> = {
  video: '视频',
  youtube: 'YouTube',
  page: '网页',
  podcast: '播客',
  local: '本地'
};

export function kindLabel(video: LibraryVideo): string {
  return KIND_LABELS[String(video.kind || '')] || '';
}

/** 列表行里的「类型 · UP · 时长 · 行数」。 */
export function metaLine(video: LibraryVideo): string {
  return [
    kindLabel(video),
    video.owner || (video.kind === 'page' ? '网页' : '未知 UP'),
    video.duration ? formatDuration(video.duration) : '',
    video.lineCount ? `${video.lineCount.toLocaleString('zh-CN')} 行` : ''
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 把标题变成安全文件名（导出笔记时用）。 */
export function safeFilename(title: string): string {
  return (
    String(title || '笔记')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || '笔记'
  );
}
