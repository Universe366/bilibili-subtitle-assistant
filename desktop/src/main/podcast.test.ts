import { describe, expect, it } from 'vitest';
import { parsePodcastFeed } from './podcast';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title><![CDATA[测试播客]]></title>
    <description>一个用于测试的播客</description>
    <item>
      <title>第一集 &amp; 开场</title>
      <link>https://example.com/ep1</link>
      <guid>ep-1</guid>
      <pubDate>Mon, 20 Oct 2025 10:00:00 GMT</pubDate>
      <itunes:duration>01:02:03</itunes:duration>
      <enclosure url="https://cdn.example.com/ep1.mp3" type="audio/mpeg" length="123" />
    </item>
    <item>
      <title>第二集</title>
      <itunes:duration>754</itunes:duration>
      <enclosure url="https://cdn.example.com/ep2.m4a" type="audio/mp4" />
    </item>
    <item>
      <title>没有音频</title>
    </item>
  </channel>
</rss>`;

describe('parsePodcastFeed', () => {
  it('解析标题、单集、时长和链接', () => {
    const feed = parsePodcastFeed(FEED, 'https://example.com/feed.xml');
    expect(feed.title).toBe('测试播客');
    expect(feed.description).toContain('测试');
    expect(feed.episodes).toHaveLength(2);
    expect(feed.episodes[0]).toMatchObject({
      id: 'ep-1',
      title: '第一集 & 开场',
      audioUrl: 'https://cdn.example.com/ep1.mp3',
      pageUrl: 'https://example.com/ep1',
      duration: 3723
    });
    expect(feed.episodes[1].duration).toBe(754);
    expect(feed.episodes[1].pageUrl).toBe('https://example.com/feed.xml');
  });

  it('不是 RSS 时给出明确错误', () => {
    expect(() => parsePodcastFeed('<html></html>', 'https://example.com/')).toThrow(/RSS/);
  });

  it('没有音频单集时报错', () => {
    expect(() =>
      parsePodcastFeed('<rss><channel><item><title>无音频</title></item></channel></rss>', 'https://x.test/feed')
    ).toThrow(/音频/);
  });
});
