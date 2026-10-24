// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppSettings, McpServer, McpTool } from '../../../../shared/types';
import { McpSection } from './McpSection';

const server = {
  id: 's1',
  name: '本地服务',
  url: 'https://example.com/mcp',
  token: '',
  headers: {},
  enabled: true,
  transport: 'http'
} as McpServer;

const tool = { name: 'search', description: '搜索', inputSchema: {} } as McpTool;

function props(overrides: Record<string, unknown> = {}) {
  return {
    value: { enabled: true, servers: [server], callTimeoutMs: 60000, maxToolRounds: 6 } as AppSettings['mcp'],
    testing: '',
    tools: {},
    args: '{}',
    result: '',
    onChange: vi.fn(),
    onArgs: vi.fn(),
    onAddServer: vi.fn(),
    onUpdateServer: vi.fn(),
    onRemoveServer: vi.fn(),
    onTest: vi.fn(),
    onCall: vi.fn(),
    ...overrides
  };
}

describe('McpSection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('渲染服务卡片与名称', () => {
    render(<McpSection {...props()} />);
    expect(screen.getByDisplayValue('本地服务')).toBeTruthy();
    expect(screen.getByDisplayValue('https://example.com/mcp')).toBeTruthy();
  });

  it('编辑名称与 URL、切换传输方式都带服务 id', () => {
    const p = props();
    render(<McpSection {...p} />);
    fireEvent.change(screen.getByDisplayValue('本地服务'), { target: { value: '改名' } });
    expect(p.onUpdateServer).toHaveBeenCalledWith('s1', { name: '改名' });
    fireEvent.change(screen.getByDisplayValue('HTTP JSON-RPC'), { target: { value: 'sse' } });
    expect(p.onUpdateServer).toHaveBeenCalledWith('s1', { transport: 'sse' });
  });

  it('连接测试与工具调用', () => {
    const p = props({ tools: { s1: [tool] } });
    render(<McpSection {...p} />);
    fireEvent.click(screen.getByText(/连接 \/ 列出工具/));
    expect(p.onTest).toHaveBeenCalledWith(server);
    fireEvent.click(screen.getByTitle('搜索'));
    expect(p.onCall).toHaveBeenCalledWith(server, tool);
  });

  it('超时与轮数按秒/轮换算', () => {
    const p = props();
    render(<McpSection {...p} />);
    const timeout = screen.getByDisplayValue('60') as HTMLInputElement;
    fireEvent.change(timeout, { target: { value: '30' } });
    expect(p.onChange).toHaveBeenCalledWith(expect.objectContaining({ callTimeoutMs: 30000 }));
  });
});
