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

  const langLabel = payload.translationLanguage ? ` · ${payload.translationLanguage}` : '';
  blocks.push(
    `## 字幕${track ? `（${track.lanDoc || track.lan}${langLabel}）` : langLabel ? `（${payload.translationLanguage}）` : ''}`,
    ''
  );
  if (lines.length) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const prefix = payload.includeTimestamps !== false ? `\`[${clock(line.start)}]\` ` : '';
      const translated = payload.translatedLines?.[index]?.text;
      blocks.push(`- ${prefix}${line.text}${translated ? `
  ${translated}` : ''}`);
    }
  } else {
    blocks.push('_（没有字幕内容）_');
  }
  return `${blocks.join('\n')}\n`;
}

function toSrt(lines: SubtitleLine[], translated?: SubtitleLine[]): string {
  return lines
    .map((line, index) => {
      const start = Math.max(0, line.start);
      const end = Math.max(start + 0.2, line.end);
      return `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${
        translated?.[index]?.text || line.text
      }\n`;
    })
    .join('\n');
}

function toTxt(
  lines: SubtitleLine[],
  includeTimestamps: boolean,
  translated?: SubtitleLine[]
): string {
  return `${lines
    .map((line, index) => {
      const prefix = includeTimestamps ? `[${clock(line.start)}] ` : '';
      const tr = translated?.[index]?.text;
      return `${prefix}${line.text}${tr ? `\n  ${tr}` : ''}`;
    })
    .join('\n')}\n`;
}

function filenameFor(payload: ExportPayload): string {
  const date = new Date().toISOString().slice(0, 10);
  const raw = (payload.filenamePattern || '{title}')
    .replace(/\{title\}/g, payload.info.title || '视频')
    .replace(/\{bvid\}/g, payload.info.bvid || '')
    .replace(/\{lang\}/g, payload.translationLanguage || '')
    .replace(/\{date\}/g, date);
  return safeFilename(raw);
}

export function buildExport(payload: ExportPayload): {
  content: string;
  ext: string;
  mime: string;
  filename: string;
} {
  const filename = filenameFor(payload);
  const includeTimestamps = payload.includeTimestamps !== false;

  switch (payload.format) {
    case 'srt':
      return {
        content: toSrt(payload.lines, payload.translatedLines),
        ext: 'srt',
        mime: 'application/x-subrip',
        filename
      };
    case 'txt':
      return {
        content: toTxt(payload.lines, includeTimestamps, payload.translatedLines),
        ext: 'txt',
        mime: 'text/plain',
        filename
      };
    case 'json':
      return {
        content: JSON.stringify(
          {
            video: payload.info,
            track: payload.track,
            summary: payload.summary || '',
            lines: payload.lines,
            translation: payload.translatedLines
              ? {
                  language: payload.translationLanguage || '',
                  lines: payload.translatedLines
                }
              : undefined,
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
