import { describe, expect, it } from 'vitest';
import type { TabInfo } from '../../../shared/types';
import { moveIndexFor, nextTabId, tabIdByNumber } from './tabs';

const tab = (id: string): TabInfo => ({
  id,
  title: id,
  url: `https://example.com/${id}`,
  loading: false,
  active: false,
  canGoBack: false,
  canGoForward: false,
  suspended: false,
  zoom: 1
});

const tabs = [tab('a'), tab('b'), tab('c')];

describe('tabs helpers', () => {
  it('nextTabId 循环切换', () => {
    expect(nextTabId(tabs, 'a', 1)).toBe('b');
    expect(nextTabId(tabs, 'c', 1)).toBe('a');
    expect(nextTabId(tabs, 'a', -1)).toBe('c');
  });

  it('没有活动标签时返回第一个', () => {
    expect(nextTabId(tabs, null, 1)).toBe('a');
    expect(nextTabId([], 'a', 1)).toBeNull();
  });

  it('Ctrl+1..9 取第 n 个，9 取最后一个', () => {
    expect(tabIdByNumber(tabs, 1)).toBe('a');
    expect(tabIdByNumber(tabs, 3)).toBe('c');
    expect(tabIdByNumber(tabs, 9)).toBe('c');
    expect(tabIdByNumber(tabs, 0)).toBeNull();
    expect(tabIdByNumber([], 1)).toBeNull();
  });

  it('moveIndexFor 返回目标下标', () => {
    expect(moveIndexFor(tabs, 'a', 'c')).toBe(2);
    expect(moveIndexFor(tabs, 'c', 'a')).toBe(0);
    expect(moveIndexFor(tabs, 'a', 'missing')).toBe(2);
  });
});
