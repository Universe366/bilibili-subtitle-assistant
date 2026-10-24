// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppSettings, AsrPlatform } from '../../../../shared/types';
import { AsrSection } from './AsrSection';

const platform = {
  id: 'asr1',
  name: 'Whisper',
  kind: 'openai',
  baseUrl: 'https://api.example.com',
  model: 'whisper-1',
  apiKey: 'key',
  models: ['whisper-1'],
  protocol: 'openai'
} as unknown as AsrPlatform;

const draft = {
  asr: {
    activeId: 'asr1',
    platforms: [platform],
    language: 'zh',
    chunkSeconds: 300,
    audioFormat: 'm4a',
    concurrency: 2,
    timeoutMs: 60000
  }
} as unknown as AppSettings;

function props(overrides: Record<string, unknown> = {}) {
  return {
    draft,
    activeAsr: platform,
    updateAsr: vi.fn(),
    updateAsrPlatform: vi.fn(),
    addAsrPlatform: vi.fn(),
    removeAsrPlatform: vi.fn(),
    testConnection: vi.fn(),
    probeModels: vi.fn(),
    platformBusy: '',
    modelCache: {},
    showKey: {},
    setShowKey: vi.fn(),
    setEditingAsrId: vi.fn(),
    platformStatus: () => <span>未测试</span>,
    ...overrides
  };
}

const button = (text: string) =>
  screen.getAllByRole('button').find((item) => item.textContent?.includes(text)) as HTMLButtonElement;

describe('AsrSection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('渲染平台名称与连接状态', () => {
    render(<AsrSection {...props()} />);
    expect(screen.getByDisplayValue('Whisper')).toBeTruthy();
    expect(screen.getByText('未测试')).toBeTruthy();
  });

  it('测试连接与探测模型回调', () => {
    const p = props();
    render(<AsrSection {...p} />);
    fireEvent.click(button('测试连接'));
    fireEvent.click(button('探测模型'));
    expect(p.testConnection).toHaveBeenCalledWith('asr');
    expect(p.probeModels).toHaveBeenCalledWith('asr');
  });

  it('切换语言与切片参数', () => {
    const p = props();
    render(<AsrSection {...p} />);
    fireEvent.change(screen.getByDisplayValue('中文'), { target: { value: 'en' } });
    expect(p.updateAsr).toHaveBeenCalledWith({ language: 'en' });
  });

  it('新增平台与删除平台回调', () => {
    const two = { ...draft, asr: { ...draft.asr, platforms: [platform, { ...platform, id: 'asr2' }] } } as unknown as AppSettings;
    const p = props({ draft: two });
    render(<AsrSection {...p} />);
    fireEvent.click(screen.getByTitle('新增平台'));
    fireEvent.click(screen.getByTitle('删除当前平台'));
    expect(p.addAsrPlatform).toHaveBeenCalled();
    expect(p.removeAsrPlatform).toHaveBeenCalled();
  });
});
