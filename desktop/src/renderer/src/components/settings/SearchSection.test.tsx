// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppSettings, SearchPlatform } from '../../../../shared/types';
import { SearchSection } from './SearchSection';

const platform = {
  id: 'p1',
  name: '默认检索',
  kind: 'exa',
  baseUrl: 'https://example.com',
  apiKey: 'key-123',
  protocol: 'exa',
  homepage: '',
  keyUrl: ''
} as unknown as SearchPlatform;

const draft = {
  search: {
    enabled: true,
    activeId: 'p1',
    platforms: [platform],
    maxResults: 8,
    timeRange: 'any',
    includeContent: true,
    verify: true,
    verifySummary: true,
    aiQueryGeneration: true,
    verifyItemCount: 12,
    extraVerifyQueries: '',
    keylessFallback: true,
    keylessOrder: ['exa'],
    autoSearchOnChat: false,
    alwaysSearchOnChat: false
  },
  ai: { platforms: [] }
} as unknown as AppSettings;

function props(overrides: Record<string, unknown> = {}) {
  return {
    draft,
    activeSearch: platform,
    updateSearch: vi.fn(),
    updateSearchPlatform: vi.fn(),
    addSearchPlatform: vi.fn(),
    removeSearchPlatform: vi.fn(),
    testConnection: vi.fn(),
    platformBusy: '',
    setEditingSearchId: vi.fn(),
    platformStatus: () => <span>连接正常</span>,
    showKey: {},
    setShowKey: vi.fn(),
    searchQuery: 'B站 视频 总结',
    setSearchQuery: vi.fn(),
    searchTesting: false,
    searchResults: null,
    onTestSearch: vi.fn(),
    ...overrides
  };
}

describe('SearchSection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('渲染平台名与连接状态', () => {
    render(<SearchSection {...props()} />);
    expect(screen.getByDisplayValue('默认检索')).toBeTruthy();
    expect(screen.getByText('连接正常')).toBeTruthy();
  });

  it('切换时间范围与结果数', () => {
    const p = props();
    render(<SearchSection {...p} />);
    fireEvent.change(screen.getByDisplayValue('不限'), { target: { value: 'week' } });
    expect(p.updateSearch).toHaveBeenCalledWith({ timeRange: 'week' });
  });

  it('测试连接与测试检索回调', () => {
    const p = props();
    render(<SearchSection {...p} />);
    fireEvent.click(screen.getByText(/测试连接/));
    fireEvent.click(screen.getByText(/测试检索/));
    expect(p.testConnection).toHaveBeenCalledWith('search');
    expect(p.onTestSearch).toHaveBeenCalled();
  });

  it('测试结果展示命中数量', () => {
    render(
      <SearchSection
        {...props({
          searchResults: [{ title: 'A', url: 'u', snippet: 's' }]
        })}
      />
    );
    expect(screen.getByText(/找到 1 条/)).toBeTruthy();
  });
});
