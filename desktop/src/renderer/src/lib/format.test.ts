import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration } from './format';

describe('format', () => {
  it('时长按小时/分钟格式化', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatDuration(-5)).toBe('0:00');
  });

  it('字节按 KB/MB 格式化', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
