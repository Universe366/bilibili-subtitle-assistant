import { describe, expect, it } from 'vitest';
import { isLocalEndpoint, needsApiKey } from './platformKey';

describe('本地模型端点', () => {
  it('localhost / 127.0.0.1 / ::1 不需要 Key', () => {
    expect(isLocalEndpoint('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isLocalEndpoint('http://localhost:1234/v1')).toBe(true);
    expect(isLocalEndpoint('http://[::1]:8080/v1')).toBe(true);
    expect(needsApiKey({ baseUrl: 'http://127.0.0.1:11434/v1' })).toBe(false);
  });

  it('远程地址仍然需要 Key', () => {
    expect(isLocalEndpoint('https://api.deepseek.com/v1')).toBe(false);
    expect(needsApiKey({ baseUrl: 'https://api.deepseek.com/v1' })).toBe(true);
    expect(needsApiKey(null)).toBe(true);
  });

  it('非法地址按远程处理', () => {
    expect(isLocalEndpoint('')).toBe(false);
    expect(isLocalEndpoint('not a url')).toBe(false);
  });
});
