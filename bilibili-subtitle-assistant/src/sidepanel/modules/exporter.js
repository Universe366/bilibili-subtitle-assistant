// 导出：6 种格式（SRT / WebVTT / ASS / TXT / Markdown / JSON）× 4 种模板
// （纯内容 / 带时间戳 / 学习笔记 / 会议纪要），并可配置是否保留时间戳、是否估算时间戳。

import { fmtSrtTime, fmtVttTime, fmtAssTime, fmtTime } from './dom.js';
import { overallStats, lineStats } from './subtitles.js';

const EMPTY_GAP = 0.4; // 无时间戳时估算的默认句长

// 估算时间戳：没有时间信息时按字数顺排
export function estimateTimestamps(lines) {
  let t = 0;
  return lines.map((l) => {
    const text = String(l.text || '');
    const chars = text.replace(/\s/g, '').length || 1;
    const dur = Math.max(1.2, chars * 0.22);
    const row = { ...l, from: t, to: t + dur };
    t += dur + 0.1;
    return row;
  });
}

export function prepareLines(lines, cfg = {}) {
  const has = lines.some((l) => Number.isFinite(l.from) && Number.isFinite(l.to) && l.to > l.from);
  if (has) return lines;
  if (cfg.estimateTimestamps === false) return lines.map((l) => ({ ...l, from: null, to: null }));
  return estimateTimestamps(lines);
}

// ---------------------------------------------------------------------------
// 模板
// ---------------------------------------------------------------------------

function headerFor(video, template) {
  const title = `${video.title || '未命名视频'}${video.partTitle ? ` · ${video.partTitle}` : ''}`;
  const meta = [];
  if (video.owner) meta.push(`UP：${video.owner}`);
  if (video.bvid) meta.push(`BV：${video.bvid}`);
  if (video.page) meta.push(`分P：P${video.page}`);
  if (video.duration) meta.push(`时长：${fmtTime(video.duration)}`);
  if (video.url) meta.push(`链接：${video.url}`);
  const stats = video.stats ? `行数：${video.stats.lines}　字数：${video.stats.chars}　覆盖：${fmtTime(video.stats.coverage)}` : '';
  switch (template) {
    case 'study':
      return `# ${title}\n\n> 学习笔记\n\n${meta.join('\n')}\n\n${stats}\n\n---\n`;
    case 'meeting':
      return `# ${title}\n\n## 会议纪要\n\n${meta.join('\n')}\n\n---\n`;
    case 'plain':
    case 'timed':
    default:
      return '';
  }
}

function wrapTemplate(body, video, template, cfg) {
  if (template === 'plain' || template === 'timed') return headerFor(video, template) + body;
  if (template === 'study') {
    const chapters = video.chapters || [];
    if (chapters.length) {
      const toc = chapters
        .map((c, i) => `${i + 1}. [${fmtTime(c.start)}] ${c.title}`)
        .join('\n');
      return `${headerFor(video, 'study')}\n## 章节\n\n${toc}\n\n---\n\n## 正文\n\n${body}`;
    }
    return `${headerFor(video, 'study')}\n## 正文\n\n${body}`;
  }
  if (template === 'meeting') {
    const head = headerFor(video, 'meeting');
    return `${head}\n### 议题与讨论\n\n${body}\n`;
  }
  return body;
}

// ---------------------------------------------------------------------------
// 格式
// ---------------------------------------------------------------------------

export function toSrt(lines, video, cfg = {}) {
  const rows = prepareLines(lines, cfg);
  return rows
    .map((l, i) => {
      const from = Number.isFinite(l.from) ? l.from : 0;
      const to = Number.isFinite(l.to) && l.to > from ? l.to : from + EMPTY_GAP;
      return `${i + 1}\n${fmtSrtTime(from)} --> ${fmtSrtTime(to)}\n${l.text}`;
    })
    .join('\n\n')
    .concat('\n');
}

export function toVtt(lines, video, cfg = {}) {
  const rows = prepareLines(lines, cfg);
  const head = `WEBVTT\n\n${video.title ? `NOTE ${video.title}\n\n` : ''}`;
  return (
    head +
    rows
      .map((l, i) => {
        const from = Number.isFinite(l.from) ? l.from : 0;
        const to = Number.isFinite(l.to) && l.to > from ? l.to : from + EMPTY_GAP;
        return `${i + 1}\n${fmtVttTime(from)} --> ${fmtVttTime(to)}\n${l.text}`;
      })
      .join('\n\n')
      .concat('\n')
  );
}

export function toAss(lines, video, cfg = {}) {
  const rows = prepareLines(lines, cfg);
  const fontSize = Number(cfg.assFontSize) || 42;
  const header = [
    '[Script Info]',
    `Title: ${(video.title || '字幕').replace(/[\r\n]/g, ' ')}`,
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Microsoft YaHei,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,40,40,45,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ].join('\n');
  const body = rows
    .map((l) => {
      const from = Number.isFinite(l.from) ? l.from : 0;
      const to = Number.isFinite(l.to) && l.to > from ? l.to : from + EMPTY_GAP;
      const text = String(l.text || '').replace(/\r?\n/g, '\\N').replace(/[{}]/g, '');
      return `Dialogue: 0,${fmtAssTime(from)},${fmtAssTime(to)},Default,,0,0,0,,${text}`;
    })
    .join('\n');
  return `${header}\n${body}\n`;
}

export function toTxt(lines, video, cfg = {}) {
  const rows = prepareLines(lines, cfg);
  const keep = cfg.includeTimestamps !== false;
  const body = rows
    .map((l) => (keep && Number.isFinite(l.from) ? `[${fmtTime(l.from)}] ${l.text}` : l.text))
    .join('\n');
  return wrapTemplate(body, video, cfg.template || 'plain', cfg);
}

export function toMarkdown(lines, video, cfg = {}) {
  const rows = prepareLines(lines, cfg);
  const keep = cfg.includeTimestamps !== false;
  const template = cfg.template || 'timed';
  const stats = video.stats || overallStats(lines);
  const statsLine = `> 共 ${stats.lines} 行 · ${stats.chars} 字 · 覆盖 ${fmtTime(stats.coverage)} · 预计朗读 ${fmtTime(
    stats.speakSeconds
  )}`;

  if (template === 'plain') {
    return wrapTemplate(rows.map((l) => l.text).join('\n\n'), { ...video, stats }, 'plain', cfg);
  }
  if (template === 'timed') {
    const body = rows.map((l) => `- \`${fmtTime(l.from)}\` ${l.text}`).join('\n');
    return `${wrapTemplate(statsLine, { ...video, stats }, 'plain', cfg)}\n${body}\n`;
  }
  if (template === 'study') {
    const chapters = (video.chapters || []).filter(Boolean);
    let body = '';
    if (chapters.length) {
      let idx = 0;
      for (const c of chapters) {
        body += `\n## ${fmtTime(c.start)}　${c.title}\n\n`;
        const seg = rows.filter((l) => l.from >= c.start && l.from < (c.end || Infinity));
        body += seg.map((l) => `- ${l.text}`).join('\n') + '\n';
        idx += 1;
      }
      if (idx === 0) body = rows.map((l) => `- ${l.text}`).join('\n');
    } else {
      body = rows.map((l) => `- ${l.text}`).join('\n');
    }
    return `${wrapTemplate(statsLine, { ...video, stats }, 'study', cfg)}\n${body}\n`;
  }
  if (template === 'meeting') {
    const body = rows.map((l) => `- ${keep ? `\`${fmtTime(l.from)}\` ` : ''}${l.text}`).join('\n');
    return `${wrapTemplate(statsLine, { ...video, stats }, 'meeting', cfg)}\n${body}\n`;
  }
  return rows.map((l) => l.text).join('\n');
}

export function toJson(lines, video, cfg = {}) {
  const rows = prepareLines(lines, cfg);
  const stats = video.stats || overallStats(lines);
  return JSON.stringify(
    {
      video: {
        bvid: video.bvid || null,
        aid: video.aid || null,
        cid: video.cid || null,
        epId: video.epId || null,
        page: video.page || 1,
        title: video.title || '',
        partTitle: video.partTitle || '',
        owner: video.owner || '',
        duration: video.duration || 0,
        url: video.url || ''
      },
      meta: {
        generator: 'B站字幕助手',
        exportedAt: new Date().toISOString(),
        format: 'json',
        template: cfg.template || 'timed',
        includeTimestamps: cfg.includeTimestamps !== false,
        language: (video.subtitleMeta && video.subtitleMeta.lang) || null,
        source: video.source || 'unknown',
        lineCount: rows.length
      },
      stats,
      chapters: video.chapters || [],
      subtitles: rows.map((l, i) => ({
        index: i + 1,
        from: Number.isFinite(l.from) ? Number(l.from.toFixed(3)) : null,
        to: Number.isFinite(l.to) ? Number(l.to.toFixed(3)) : null,
        text: l.text,
        chars: lineStats(l).chars
      })),
      summary: video.summary || ''
    },
    null,
    2
  );
}

export const FORMATTERS = {
  srt: toSrt,
  vtt: toVtt,
  ass: toAss,
  txt: toTxt,
  md: toMarkdown,
  json: toJson
};

export function buildExport(lines, video, cfg = {}) {
  const fmt = FORMATTERS[cfg.format] || toSrt;
  return fmt(lines, video, cfg);
}

export function safeFilename(video, cfg = {}) {
  const pattern = cfg.filenamePattern || '{title}-{part}';
  const raw = pattern
    .replace('{title}', video.title || '字幕')
    .replace('{part}', video.partTitle || `P${video.page || 1}`)
    .replace('{bvid}', video.bvid || '')
    .replace('{date}', new Date().toISOString().slice(0, 10));
  const cleaned = raw.replace(/[\\/:*?"<>|\r\n]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${cleaned || '字幕'}.${cfg.format || 'srt'}`;
}
