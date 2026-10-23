import { describe, expect, it } from 'vitest';
import type { WebContents } from 'electron';
import { isYouTubeUrl, parseJson3, parseTimedTextXml, readYouTubeData, youtubeVideoId } from './youtube';

describe('YouTube 适配', () => {
  it('识别常见视频地址', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toBe(
      'dQw4w9WgXcQ'
    );
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/shorts/abc123XYZ')).toBe('abc123XYZ');
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isYouTubeUrl('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(false);
  });

  it('解析 json3 事件', () => {
    const text = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: 'Hello' }, { utf8: ' world' }] },
        { tStartMs: 1500, dDurationMs: 2000, segs: [{ utf8: '\n' }] },
        { tStartMs: 3500, dDurationMs: 1000, segs: [{ utf8: 'Second line' }] }
      ]
    });
    expect(parseJson3(text)).toEqual([
      { start: 0, end: 1.5, text: 'Hello world' },
      { start: 3.5, end: 4.5, text: 'Second line' }
    ]);
  });

  it('解析 timedtext XML', () => {
    const xml =
      '<transcript><text start="1.2" dur="2">Hello &amp; hi</text><text start="3"><![CDATA[第二句]]></text></transcript>';
    expect(parseTimedTextXml(xml)).toEqual([
      { start: 1.2, end: 2.2, text: 'Hello & hi' },
      { start: 3, end: 4, text: '第二句' }
    ]);
  });

  it('坏数据返回空数组', () => {
    expect(parseJson3('not json')).toEqual([]);
    expect(parseJson3('{}')).toEqual([]);
    expect(parseTimedTextXml('<html></html>')).toEqual([]);
  });

  it('把页面 playerResponse 映射成 PageInfo 与字幕轨', async () => {
    const raw = {
      videoId: 'dQw4w9WgXcQ',
      title: '示例视频',
      author: '示例频道',
      duration: 123,
      desc: '简介',
      tracks: [
        {
          lan: 'zh-Hans',
          lanDoc: '中文（自动）',
          url: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=zh-Hans',
          isAi: true
        },
        {
          lan: 'en',
          lanDoc: 'English',
          url: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en&fmt=srv3',
          isAi: false
        }
      ]
    };
    const wc = {
      isDestroyed: () => false,
      getURL: () => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      getTitle: () => '页面标题',
      executeJavaScript: async () => raw
    } as unknown as WebContents;

    const data = await readYouTubeData(wc);
    expect(data?.info.title).toBe('示例视频');
    expect(data?.info.owner).toBe('示例频道');
    expect(data?.info.duration).toBe(123);
    expect(data?.info.signature).toBe('y:dQw4w9WgXcQ');
    expect(data?.tracks).toHaveLength(2);
    expect(data?.tracks[0].url).toContain('fmt=json3');
    expect(data?.tracks[0].source).toBe('youtube');
    expect(data?.tracks[1].url).toContain('fmt=srv3');
  });
});
