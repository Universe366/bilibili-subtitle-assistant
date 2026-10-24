// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DataBackupSection } from './DataBackupSection';

function props(overrides: Record<string, unknown> = {}) {
  return {
    dataDir: 'C:\\data',
    migrating: false,
    onChangeLocation: vi.fn(),
    onExportSettings: vi.fn(),
    onImportSettings: vi.fn(),
    onBackup: vi.fn(),
    onRestore: vi.fn(),
    onCompact: vi.fn(),
    onClearBrowsingData: vi.fn(),
    ...overrides
  };
}

const button = (text: string) =>
  screen.getAllByRole('button').find((item) => item.textContent?.includes(text)) as HTMLButtonElement;

describe('DataBackupSection', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'bsub', {
      configurable: true,
      value: { openDataDir: vi.fn(async () => undefined) }
    });
  });
  afterEach(cleanup);

  it('展示数据目录与数据库路径', () => {
    render(<DataBackupSection {...props()} />);
    expect(screen.getAllByText('C:\\data').length).toBeGreaterThan(0);
    expect(screen.getByText('C:\\data\\library.db')).toBeTruthy();
  });

  it('迁移中时按钮禁用且文案变化', () => {
    render(<DataBackupSection {...props({ migrating: true })} />);
    const button = screen.getByText(/迁移中…/).closest('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('备份 / 恢复 / 压缩 / 清浏览数据回调', () => {
    const p = props();
    render(<DataBackupSection {...p} />);
    fireEvent.click(button('备份数据'));
    fireEvent.click(button('恢复备份'));
    fireEvent.click(button('压缩数据库'));
    fireEvent.click(button('清除浏览数据'));
    expect(p.onBackup).toHaveBeenCalled();
    expect(p.onRestore).toHaveBeenCalled();
    expect(p.onCompact).toHaveBeenCalled();
    expect(p.onClearBrowsingData).toHaveBeenCalled();
  });

  it('导出/导入设置与更改位置回调', () => {
    const p = props();
    render(<DataBackupSection {...p} />);
    fireEvent.click(button('导出设置'));
    fireEvent.click(button('导入设置'));
    fireEvent.click(button('更改位置'));
    expect(p.onExportSettings).toHaveBeenCalled();
    expect(p.onImportSettings).toHaveBeenCalled();
    expect(p.onChangeLocation).toHaveBeenCalled();
  });
});
