import { describe, expect, it } from 'vitest';
import { normalizeUrl } from './url';

describe('normalizeUrl', () => {
  it('空输入回到 B 站首页', () => {
    expect(normalizeUrl('')).toBe('https://www.bilibili.com/');
    expect(normalizeUrl('   ')).toBe('https://www.bilibili.com/');
  });

  it('保留完整 URL', () => {
    expect(normalizeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
  });

  it('裸 BV 号转成视频地址', () => {
    expect(normalizeUrl('BV1xx411c7mD')).toBe('https://www.bilibili.com/video/BV1xx411c7mD');
  });

  it('不带协议的域名补 https', () => {
    expect(normalizeUrl('www.example.com/x')).toBe('https://www.example.com/x');
    expect(normalizeUrl('example.com')).toBe('https://example.com');
  });

  it('普通关键词走搜索', () => {
    expect(normalizeUrl('深度 学习')).toBe(
      'https://search.bilibili.com/all?keyword=%E6%B7%B1%E5%BA%A6%20%E5%AD%A6%E4%B9%A0'
    );
  });
});
