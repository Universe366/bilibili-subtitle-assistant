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

  it('可切换必应与 Google', () => {
    expect(normalizeUrl('hello world', { engine: 'bing' })).toBe(
      'https://www.bing.com/search?q=hello%20world'
    );
    expect(normalizeUrl('hello', { engine: 'google' })).toBe(
      'https://www.google.com/search?q=hello'
    );
  });

  it('自定义模板替换 {q}，缺 {q} 时退回 B 站', () => {
    expect(
      normalizeUrl('拾字', { engine: 'custom', customUrl: 'https://s.example/?q={q}&lang=zh' })
    ).toBe('https://s.example/?q=%E6%8B%BE%E5%AD%97&lang=zh');
    expect(normalizeUrl('abc', { engine: 'custom', customUrl: 'https://s.example/' })).toBe(
      'https://search.bilibili.com/all?keyword=abc'
    );
  });
});
