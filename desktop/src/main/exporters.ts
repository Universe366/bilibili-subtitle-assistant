import type { ExportFormat, ExportPayload, PageInfo, SubtitleLine } from '../shared/types';

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function srtTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round((seconds || 0) * 1000));
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(
    2,
    '0'
  )},${String(ms).padStart(3, '0')}`;
}

function safeFilename(input: string): string {
  return (
    String(input || '视频')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || '视频'
  );
}

function metaLine(info: PageInfo): string {
  const parts = [`UP：${info.owner || '未知'}`, `时长：${clock(info.duration)}`];
  if (info.bvid) parts.push(info.bvid);
  if (info.url) parts.push(`[原视频](${info.url})`);
  return parts.join(' · ');
}

function toMarkdown(payload: ExportPayload): string {
  const { info, track, lines, summary } = payload;
  const blocks: string[] = [`# ${info.title || '未命名视频'}`, '', `> ${metaLine(info)}`, ''];

  if (summary && summary.trim()) {
    blocks.push('## AI 总结', '', summary.trim(), '');
  }

  blocks.push(`## 字幕${track ? `（${track.lanDoc || track.lan}）` : ''}`, '');
  if (lines.length) {
    for (const line of lines) blocks.push(`- \`[${clock(line.start)}]\` ${line.text}`);
  } else {
    blocks.push('_（没有字幕内容）_');
  }
  return `${blocks.join('\n')}\n`;
}

function toSrt(lines: SubtitleLine[]): string {
  return lines
    .map((line, index) => {
      const start = Math.max(0, line.start);
      const end = Math.max(start + 0.2, line.end);
      return `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${line.text}\n`;
    })
    .join('\n');
}

function toTxt(lines: SubtitleLine[]): string {
  return `${lines.map((line) => `[${clock(line.start)}] ${line.text}`).join('\n')}\n`;
}

export function buildExport(payload: ExportPayload): {
  content: string;
  ext: string;
  mime: string;
  filename: string;
} {
  const filename = `${safeFilename(payload.info.title)}${payload.info.bvid ? `-${payload.info.bvid}` : ''}`;

  switch (payload.format) {
    case 'srt':
      return { content: toSrt(payload.lines), ext: 'srt', mime: 'application/x-subrip', filename };
    case 'txt':
      return { content: toTxt(payload.lines), ext: 'txt', mime: 'text/plain', filename };
    case 'json':
      return {
        content: JSON.stringify(
          {
            video: payload.info,
            track: payload.track,
            summary: payload.summary || '',
            lines: payload.lines,
            exportedAt: new Date().toISOString()
          },
          null,
          2
        ),
        ext: 'json',
        mime: 'application/json',
        filename
      };
    case 'md':
    default:
      return { content: toMarkdown(payload), ext: 'md', mime: 'text/markdown', filename };
  }
}

export function exportFilters(format: ExportFormat): Array<{ name: string; extensions: string[] }> {
  switch (format) {
    case 'srt':
      return [{ name: 'SubRip 字幕', extensions: ['srt'] }];
    case 'txt':
      return [{ name: '纯文本', extensions: ['txt'] }];
    case 'json':
      return [{ name: 'JSON', extensions: ['json'] }];
    default:
      return [{ name: 'Markdown', extensions: ['md'] }];
  }
}
