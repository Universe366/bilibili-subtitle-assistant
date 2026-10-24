import { describe, expect, it } from 'vitest';
import { normalizeSelection, toolbarPosition, toImageRect } from './shotGeometry';

describe('normalizeSelection', () => {
  it('右下方向拖拽', () => {
    expect(
      normalizeSelection({ x: 100, y: 80 }, { x: 300, y: 200 }, { width: 1920, height: 1080 })
    ).toEqual({ x: 100, y: 80, width: 200, height: 120 });
  });

  it('左上方向拖拽也归一', () => {
    expect(
      normalizeSelection({ x: 300, y: 200 }, { x: 100, y: 80 }, { width: 1920, height: 1080 })
    ).toEqual({ x: 100, y: 80, width: 200, height: 120 });
  });

  it('拖出画面时夹在边界内', () => {
    expect(
      normalizeSelection({ x: 1800, y: 1000 }, { x: 2500, y: 1500 }, { width: 1920, height: 1080 })
    ).toEqual({ x: 1800, y: 1000, width: 120, height: 80 });
    expect(
      normalizeSelection({ x: -50, y: -20 }, { x: 100, y: 60 }, { width: 1920, height: 1080 })
    ).toEqual({ x: 0, y: 0, width: 100, height: 60 });
  });

  it('太小的拖拽视为没选中', () => {
    expect(normalizeSelection({ x: 10, y: 10 }, { x: 12, y: 11 }, { width: 800, height: 600 })).toBeNull();
  });
});

describe('toImageRect', () => {
  it('1x 屏直接对应', () => {
    expect(
      toImageRect({ x: 100, y: 50, width: 200, height: 120 }, { width: 1920, height: 1080 }, { width: 1920, height: 1080 })
    ).toEqual({ x: 100, y: 50, width: 200, height: 120 });
  });

  it('2x 屏按比例放大（HiDPI 不框错位置）', () => {
    expect(
      toImageRect({ x: 100, y: 50, width: 200, height: 120 }, { width: 1440, height: 900 }, { width: 2880, height: 1800 })
    ).toEqual({ x: 200, y: 100, width: 400, height: 240 });
  });

  it('裁剪框不会越界', () => {
    const rect = toImageRect(
      { x: 1400, y: 880, width: 200, height: 200 },
      { width: 1440, height: 900 },
      { width: 1440, height: 900 }
    );
    expect(rect.x + rect.width).toBeLessThanOrEqual(1440);
    expect(rect.y + rect.height).toBeLessThanOrEqual(900);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
});

describe('toolbarPosition', () => {
  const view = { width: 1000, height: 700 };
  const size = { width: 240, height: 40 };

  it('优先放在选框下方并水平居中', () => {
    expect(toolbarPosition({ x: 300, y: 100, width: 200, height: 100 }, view, size)).toEqual({
      x: 280,
      y: 210
    });
  });

  it('下方放不下时翻到上方', () => {
    const pos = toolbarPosition({ x: 300, y: 600, width: 200, height: 80 }, view, size);
    expect(pos.y).toBeLessThan(600);
    expect(pos.y).toBeGreaterThanOrEqual(0);
  });

  it('靠边时不会超出窗口', () => {
    const right = toolbarPosition({ x: 950, y: 100, width: 50, height: 50 }, view, size);
    expect(right.x + size.width).toBeLessThanOrEqual(view.width);
    const left = toolbarPosition({ x: 0, y: 100, width: 50, height: 50 }, view, size);
    expect(left.x).toBeGreaterThanOrEqual(0);
  });
});
