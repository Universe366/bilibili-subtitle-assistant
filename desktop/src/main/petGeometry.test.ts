import { describe, expect, it } from 'vitest';
import {
  PET_EDGE_SNAP,
  clampRectToArea,
  defaultPetRect,
  nearestWorkArea,
  normalizePetSize,
  petLayoutForState,
  petLayoutSize,
  snapRectToEdges
} from './petGeometry';

const HD = { x: 0, y: 0, width: 1920, height: 1040 };
const LEFT = { x: -1280, y: 0, width: 1280, height: 1024 };

describe('normalizePetSize', () => {
  it('限制在 64–180，非法值回默认', () => {
    expect(normalizePetSize(undefined)).toBe(96);
    expect(normalizePetSize(0)).toBe(96);
    expect(normalizePetSize(-20)).toBe(96);
    expect(normalizePetSize(10)).toBe(64);
    expect(normalizePetSize(64)).toBe(64);
    expect(normalizePetSize(300)).toBe(180);
    expect(normalizePetSize(120)).toBe(120);
  });
});

describe('petLayoutSize', () => {
  it('compact 只包住桌宠本体', () => {
    expect(petLayoutSize('compact', 96)).toEqual({ width: 108, height: 130 });
  });

  it('气泡/挂件/菜单都比 compact 大', () => {
    const compact = petLayoutSize('compact', 96);
    for (const mode of ['bubble', 'widget', 'menu'] as const) {
      const size = petLayoutSize(mode, 96);
      expect(size.width).toBeGreaterThan(compact.width);
      expect(size.height).toBeGreaterThan(compact.height);
    }
    expect(petLayoutSize('bubble', 96).width).toBe(264);
  });

  it('尺寸随桌宠大小线性变化', () => {
    expect(petLayoutSize('compact', 180).height - petLayoutSize('compact', 96).height).toBe(84);
  });
});

describe('petLayoutForState', () => {
  it('优先级：气泡 > 菜单 > 挂件 > 紧凑', () => {
    expect(petLayoutForState({ open: true, widgetOpen: true, menuOpen: true })).toBe('bubble');
    expect(petLayoutForState({ open: false, widgetOpen: true, menuOpen: true })).toBe('menu');
    expect(petLayoutForState({ open: false, widgetOpen: true, menuOpen: false })).toBe('widget');
    expect(petLayoutForState({ open: false, widgetOpen: false, menuOpen: false })).toBe('compact');
  });
});

describe('clampRectToArea', () => {
  it('把越界窗口拉回工作区', () => {
    const rect = { x: 1800, y: 1000, width: 200, height: 200 };
    expect(clampRectToArea(rect, HD)).toEqual({ x: 1720, y: 840, width: 200, height: 200 });
  });

  it('负坐标（左侧副屏）也留在本屏', () => {
    const rect = { x: -2000, y: -80, width: 200, height: 200 };
    expect(clampRectToArea(rect, LEFT)).toEqual({ x: -1280, y: 0, width: 200, height: 200 });
  });

  it('区域比窗口还小时不产生负坐标', () => {
    const tiny = { x: 10, y: 10, width: 100, height: 100 };
    const rect = { x: 0, y: 0, width: 300, height: 300 };
    expect(clampRectToArea(rect, tiny)).toMatchObject({ x: 10, y: 10 });
  });
});

describe('snapRectToEdges', () => {
  it('靠近边缘时吸附', () => {
    const nearLeft = { x: HD.x + PET_EDGE_SNAP - 1, y: 400, width: 120, height: 140 };
    expect(snapRectToEdges(nearLeft, HD).x).toBe(0);

    const nearBottom = { x: 400, y: HD.height - 140 - 10, width: 120, height: 140 };
    expect(snapRectToEdges(nearBottom, HD).y).toBe(HD.height - 140);
  });

  it('离边缘远时不动', () => {
    const rect = { x: 300, y: 300, width: 120, height: 140 };
    expect(snapRectToEdges(rect, HD)).toEqual(rect);
  });

  it('吸附后仍然在屏幕内', () => {
    const rect = { x: 1915, y: 1030, width: 200, height: 200 };
    const snapped = snapRectToEdges(rect, HD);
    expect(snapped.x).toBe(1720);
    expect(snapped.y).toBe(840);
  });
});

describe('defaultPetRect', () => {
  it('右下角留 24px 边距', () => {
    const rect = defaultPetRect(96, HD);
    expect(rect.x + rect.width).toBe(HD.width - 24);
    expect(rect.y + rect.height).toBe(HD.height - 24);
  });

  it('小屏上也放得下', () => {
    const tiny = { x: 0, y: 0, width: 300, height: 300 };
    const rect = defaultPetRect(180, tiny, 'bubble');
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
  });
});

describe('nearestWorkArea', () => {
  it('点在哪个屏就用哪个屏', () => {
    expect(nearestWorkArea({ x: 100, y: 100 }, [HD, LEFT])).toBe(HD);
    expect(nearestWorkArea({ x: -600, y: 300 }, [HD, LEFT])).toBe(LEFT);
  });

  it('点不在任何屏里时取最近的一块', () => {
    expect(nearestWorkArea({ x: -1500, y: -400 }, [HD, LEFT])).toBe(LEFT);
    expect(nearestWorkArea({ x: 5000, y: 5000 }, [HD, LEFT])).toBe(HD);
  });

  it('没有显示器时返回 null，没有坐标时取第一块', () => {
    expect(nearestWorkArea({ x: 0, y: 0 }, [])).toBeNull();
    expect(nearestWorkArea(null, [HD, LEFT])).toBe(HD);
  });
});
