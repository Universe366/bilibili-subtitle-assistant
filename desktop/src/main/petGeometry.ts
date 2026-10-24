// 桌宠的位置与窗口尺寸计算（纯函数，不依赖 electron，便于测试）。
//
// 目标：
// - 桌宠永远留在某个显示器的可见工作区内（拔掉副屏、改分辨率后也不丢）；
// - 窗口按内容收缩/展开，避免透明窗口在桌面上「挡住看不见的区域」；
// - 拖拽松手时吸附到屏幕边缘，手感更稳。

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PetLayoutMode = 'compact' | 'bubble' | 'widget' | 'menu';

export const PET_MIN_SIZE = 64;
export const PET_MAX_SIZE = 180;
export const PET_DEFAULT_SIZE = 96;
export const PET_EDGE_SNAP = 28;

export function normalizePetSize(value: number | undefined): number {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return PET_DEFAULT_SIZE;
  return Math.min(PET_MAX_SIZE, Math.max(PET_MIN_SIZE, Math.round(size)));
}

/** 每种状态下的窗口尺寸：桌宠本体 + 需要展示的气泡/挂件高度。 */
export function petLayoutSize(mode: PetLayoutMode, petSize: number): { width: number; height: number } {
  const size = normalizePetSize(petSize);
  switch (mode) {
    case 'bubble':
      return { width: 264, height: size + 330 };
    case 'widget':
      return { width: 232, height: size + 252 };
    case 'menu':
      return { width: 236, height: size + 330 };
    case 'compact':
    default:
      return { width: size + 12, height: size + 34 };
  }
}

/** 有气泡时右击菜单也能放下，所以优先 bubble。 */
export function petLayoutForState(input: {
  open: boolean;
  widgetOpen: boolean;
  menuOpen: boolean;
}): PetLayoutMode {
  if (input.open) return 'bubble';
  if (input.menuOpen) return 'menu';
  if (input.widgetOpen) return 'widget';
  return 'compact';
}

export function clampRectToArea(rect: Rect, area: Rect): Rect {
  const maxX = area.x + area.width - rect.width;
  const maxY = area.y + area.height - rect.height;
  return {
    ...rect,
    x: Math.min(Math.max(rect.x, area.x), Math.max(area.x, maxX)),
    y: Math.min(Math.max(rect.y, area.y), Math.max(area.y, maxY))
  };
}

/** 松手时贴边：左右上下各留 PET_EDGE_SNAP 的吸附范围。 */
export function snapRectToEdges(rect: Rect, area: Rect, threshold = PET_EDGE_SNAP): Rect {
  const snapped = { ...rect };
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  if (Math.abs(rect.x - area.x) <= threshold) snapped.x = area.x;
  else if (Math.abs(rect.x + rect.width - right) <= threshold) snapped.x = right - rect.width;
  if (Math.abs(rect.y - area.y) <= threshold) snapped.y = area.y;
  else if (Math.abs(rect.y + rect.height - bottom) <= threshold) snapped.y = bottom - rect.height;
  return clampRectToArea(snapped, area);
}

/** 默认位置：右下角，留 24px 边距（与旧版视觉位置接近）。 */
export function defaultPetRect(petSize: number, area: Rect, mode: PetLayoutMode = 'compact'): Rect {
  const size = petLayoutSize(mode, petSize);
  return clampRectToArea(
    { x: area.x + area.width - size.width - 24, y: area.y + area.height - size.height - 24, ...size },
    area
  );
}

function distanceToArea(point: { x: number; y: number }, area: Rect): number {
  const dx = Math.max(area.x - point.x, 0, point.x - (area.x + area.width));
  const dy = Math.max(area.y - point.y, 0, point.y - (area.y + area.height));
  return dx * dx + dy * dy;
}

/** 选最近的显示器：点在某个工作区内优先，否则取中心距离最近的。 */
export function nearestWorkArea(
  point: { x: number; y: number } | null,
  areas: Rect[]
): Rect | null {
  if (!areas.length) return null;
  if (!point) return areas[0];
  const inside = areas.find(
    (area) =>
      point.x >= area.x &&
      point.x <= area.x + area.width &&
      point.y >= area.y &&
      point.y <= area.y + area.height
  );
  if (inside) return inside;
  return areas.reduce((best, area) =>
    distanceToArea(point, area) < distanceToArea(point, best) ? area : best
  );
}
