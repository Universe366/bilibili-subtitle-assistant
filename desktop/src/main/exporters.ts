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

function vttTime(seconds: number): string {
  return srtTime(seconds).replace(',', '.');
}

function assTime(seconds: number): string {
  const totalCs = Math.max(0, Math.round((seconds || 0) * 100));
  const h = Math.floor(totalCs / 360000);
  const m = Math.floor((totalCs % 360000) / 6000);
  const s = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(
    2,
    '0'
  )}`;
}

function assEscape(input: string): string {
  return String(input || '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
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

function transcriptBlocks(
  payload: ExportPayload,
  timestamps: boolean,
  heading: string
): string {
  const {
    lines,
    track,
    summary,
    translatedLines,
    translationLanguage
  } = payload;
  const blocks: string[] = [];
  if (summary && summary.trim()) {
    blocks.push('## AI 总结', '', summary.trim(), '');
  }

  const langLabel = translationLanguage ? ` · ${translationLanguage}` : '';
  const trackLabel = track ? `${track.lanDoc || track.lan}${langLabel}` : langLabel;
  blocks.push(`${heading}${trackLabel ? `（${trackLabel}）` : ''}`, '');

  if (!lines.length) {
    blocks.push('_（没有字幕内容）_');
    return blocks.join('\n');
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const prefix = timestamps ? `\`[${clock(line.start)}]\` ` : '';
    const translated = translatedLines?.[index]?.text;
    blocks.push(`- ${prefix}${line.text}${translated ? `\n  ${translated}` : ''}`);
  }
  return blocks.join('\n');
}

function toMarkdown(payload: ExportPayload): string {
  const template = payload.template || 'timestamped';
  const timestamps = payload.includeTimestamps !== false && template !== 'plain';
  const heading =
    template === 'notes'
      ? '## 时间轴笔记'
      : template === 'meeting'
        ? '## 记录'
        : '## 字幕';
  return [
    `# ${payload.info.title || '未命名视频'}`,
    '',
    `> ${metaLine(payload.info)}`,
    '',
    transcriptBlocks(payload, timestamps, heading),
    ''
  ].join('\n');
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

function toVtt(lines: SubtitleLine[], translated?: SubtitleLine[]): string {
  const cues = lines
    .map((line, index) => {
      const start = Math.max(0, line.start);
      const end = Math.max(start + 0.2, line.end);
      return `${index + 1}\n${vttTime(start)} --> ${vttTime(end)}\n${
        translated?.[index]?.text || line.text
      }\n`;
    })
    .join('\n');
  return `WEBVTT\n\n${cues}`;
}

function toAss(payload: ExportPayload): string {
  const fontSize = Math.min(96, Math.max(12, Math.round(payload.assFontSize || 28)));
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Microsoft YaHei,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const dialogues = payload.lines
    .map((line, index) => {
      const start = Math.max(0, line.start);
      const end = Math.max(start + 0.2, line.end);
      const text = payload.translatedLines?.[index]?.text || line.text;
      return `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${assEscape(text)}`;
    })
    .join('\n');
  return `${header}${dialogues}\n`;
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
  const template = payload.template || 'timestamped';
  const includeTimestamps = payload.includeTimestamps !== false && template !== 'plain';

  switch (payload.format) {
    case 'srt':
      return {
        content: toSrt(payload.lines, payload.translatedLines),
        ext: 'srt',
        mime: 'application/x-subrip',
        filename
      };
    case 'vtt':
      return {
        content: toVtt(payload.lines, payload.translatedLines),
        ext: 'vtt',
        mime: 'text/vtt',
        filename
      };
    case 'ass':
      return {
        content: toAss(payload),
        ext: 'ass',
        mime: 'text/x-ssa',
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
    case 'vtt':
      return [{ name: 'WebVTT 字幕', extensions: ['vtt'] }];
    case 'ass':
      return [{ name: 'ASS 字幕', extensions: ['ass'] }];
    case 'txt':
      return [{ name: '纯文本', extensions: ['txt'] }];
    case 'json':
      return [{ name: 'JSON', extensions: ['json'] }];
    default:
      return [{ name: 'Markdown', extensions: ['md'] }];
  }
}
