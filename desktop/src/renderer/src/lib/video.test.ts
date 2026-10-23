import { describe, expect, it } from 'vitest';
import type { PageInfo, SubtitleTrack } from '../../../shared/types';
import { pickTrack, videoKeyOf } from './video';

function track(partial: Partial<SubtitleTrack> & { url: string }): SubtitleTrack {
  return {
    lan: 'zh-CN',
    lanDoc: '中文',
    isAi: false,
    aiStatus: null,
    source: '',
    ...partial
  };
}

const info = {
  cid: 123,
  aid: 456
} as PageInfo;

describe('pickTrack', () => {
  it('没有轨时返回 null', () => {
    expect(pickTrack([], info)).toBeNull();
  });

  it('优先选择 URL 里带当前 cid 的轨，避开预取串片', () => {
    const stale = track({ url: 'https://example.com/999/sub.json', lan: 'zh-CN' });
    const current = track({ url: 'https://example.com/123/sub.json', lan: 'en-US' });
    expect(pickTrack([stale, current], info)?.url).toContain('/123/');
  });

  it('中文优先于英文，AI 中文再靠后', () => {
    const en = track({ url: 'https://example.com/123/en.json', lan: 'en-US' });
    const aiZh = track({ url: 'https://example.com/123/ai.json', lan: 'ai-zh', isAi: true });
    const zh = track({ url: 'https://example.com/123/zh.json', lan: 'zh-CN' });
    expect(pickTrack([en, aiZh, zh], info)?.lan).toBe('zh-CN');
  });

  it('没有页面信息时也能按语言挑一条', () => {
    const en = track({ url: 'https://example.com/en.json', lan: 'en-US' });
    const zh = track({ url: 'https://example.com/zh.json', lan: 'zh-CN' });
    expect(pickTrack([en, zh], null)?.lan).toBe('zh-CN');
  });
});

describe('videoKeyOf', () => {
  it('同一视频不同时间参数视为同一个 key', () => {
    expect(videoKeyOf('https://www.bilibili.com/video/BV1xx411c7mD?t=10')).toBe(
      'v:BV1xx411c7mD:p1'
    );
  });

  it('分 P 生成不同 key', () => {
    expect(videoKeyOf('https://www.bilibili.com/video/BV1xx411c7mD?p=2')).toBe(
      'v:BV1xx411c7mD:p2'
    );
  });

  it('非 B 站地址按完整 URL 区分', () => {
    expect(videoKeyOf('https://example.com/a')).toBe('u:https://example.com/a');
  });

  it('YouTube 按 videoId 生成 key，忽略 t 参数', () => {
    expect(videoKeyOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30')).toBe('y:dQw4w9WgXcQ');
    expect(videoKeyOf('https://youtu.be/dQw4w9WgXcQ')).toBe('y:dQw4w9WgXcQ');
  });

  it('空地址返回空字符串', () => {
    expect(videoKeyOf('')).toBe('');
    expect(videoKeyOf('about:blank')).toBe('');
  });
});
