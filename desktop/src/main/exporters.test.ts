import { describe, expect, it } from 'vitest';
import type { ExportPayload, PageInfo, SubtitleLine, SubtitleTrack } from '../shared/types';
import { buildExport } from './exporters';

const info: PageInfo = {
  kind: 'video',
  bvid: 'BV1xx411c7mD',
  aid: 1,
  cid: 2,
  epId: null,
  seasonId: null,
  page: 1,
  partTitle: '',
  parts: [],
  title: '测试视频',
  owner: '测试 UP',
  desc: '',
  duration: 62,
  url: 'https://www.bilibili.com/video/BV1xx411c7mD',
  signature: 'v:BV1xx411c7mD:2'
};

const track: SubtitleTrack = {
  lan: 'zh-CN',
  lanDoc: '中文',
  url: 'https://example.com/sub.json',
  isAi: false,
  aiStatus: null,
  source: ''
};

const lines: SubtitleLine[] = [
  { start: 1.5, end: 3, text: '第一句' },
  { start: 61, end: 62, text: '第二句' }
];

function payload(overrides: Partial<ExportPayload> = {}): ExportPayload {
  return {
    format: 'srt',
    info,
    track,
    lines,
    estimateTimestamps: false,
    includeTimestamps: true,
    ...overrides
  };
}

describe('buildExport', () => {
  it('SRT 序号与毫秒时间轴正确', () => {
    const result = buildExport(payload({ format: 'srt' }));
    expect(result.ext).toBe('srt');
    expect(result.content).toContain('1\n00:00:01,500 --> 00:00:03,000\n第一句');
    expect(result.content).toContain('2\n00:01:01,000 --> 00:01:02,000');
    expect(result.content).not.toContain('WEBVTT');
  });

  it('VTT 使用点号毫秒并带 WEBVTT 头', () => {
    const result = buildExport(payload({ format: 'vtt' }));
    expect(result.ext).toBe('vtt');
    expect(result.content.startsWith('WEBVTT')).toBe(true);
    expect(result.content).toContain('00:00:01.500 --> 00:00:03.000');
  });

  it('ASS 带 Dialogue 行和样式', () => {
    const result = buildExport(payload({ format: 'ass', assFontSize: 42 }));
    expect(result.ext).toBe('ass');
    expect(result.content).toContain('Dialogue:');
    expect(result.content).toContain('第一句');
    expect(result.content).toContain('42');
  });

  it('Markdown 带标题、元信息和时间戳', () => {
    const result = buildExport(payload({ format: 'md' }));
    expect(result.ext).toBe('md');
    expect(result.content).toContain('# 测试视频');
    expect(result.content).toContain('UP：测试 UP');
    expect(result.content).toContain('`[0:01]` 第一句');
  });

  it('纯文本模板可以去掉时间戳', () => {
    const result = buildExport(payload({ format: 'txt', template: 'plain' }));
    expect(result.ext).toBe('txt');
    expect(result.content).not.toContain('[0:01]');
    expect(result.content).toContain('第一句');
  });

  it('JSON 保留视频、字幕轨与行', () => {
    const result = buildExport(payload({ format: 'json' }));
    const data = JSON.parse(result.content);
    expect(data.video.bvid).toBe('BV1xx411c7mD');
    expect(data.track.lan).toBe('zh-CN');
    expect(data.lines).toHaveLength(2);
    expect(typeof data.exportedAt).toBe('string');
  });

  it('译文优先于原文导出', () => {
    const result = buildExport(
      payload({
        format: 'srt',
        translatedLines: [
          { start: 1.5, end: 3, text: 'First' },
          { start: 61, end: 62, text: 'Second' }
        ]
      })
    );
    expect(result.content).toContain('First');
    expect(result.content).not.toContain('第一句');
  });
});
