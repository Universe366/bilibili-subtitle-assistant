// 框选截图的坐标计算（纯函数，不依赖 electron，便于测试）。
//
// 三层坐标：
// 1. 覆盖窗口里的 CSS 像素（用户拖拽点和选框都在这层）；
// 2. 显示器 DIP 尺寸（窗口 bounds，等于 CSS 尺寸）；
// 3. 截图位图的实际像素（= DIP × scaleFactor，高分屏会更大）。
// 裁剪必须换算到第 3 层，否则 HiDPI 下框错位置。

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** 拖拽方向不限：左上/右下都归一成正矩形，并夹在画面内。 */
export function normalizeSelection(
  start: Point,
  end: Point,
  bounds: { width: number; height: number },
  minSize = 4
): Rect | null {
  const left = Math.max(0, Math.min(start.x, end.x));
  const top = Math.max(0, Math.min(start.y, end.y));
  const right = Math.min(bounds.width, Math.max(start.x, end.x));
  const bottom = Math.min(bounds.height, Math.max(start.y, end.y));
  const width = Math.round(right - left);
  const height = Math.round(bottom - top);
  if (width < minSize || height < minSize) return null;
  return { x: Math.round(left), y: Math.round(top), width, height };
}

/** CSS 选框 → 位图裁剪框（整数、夹在位图范围内）。 */
export function toImageRect(
  selection: Rect,
  cssSize: { width: number; height: number },
  imageSize: { width: number; height: number }
): Rect {
  const sx = cssSize.width > 0 ? imageSize.width / cssSize.width : 1;
  const sy = cssSize.height > 0 ? imageSize.height / cssSize.height : 1;
  const x = Math.max(0, Math.min(imageSize.width - 1, Math.round(selection.x * sx)));
  const y = Math.max(0, Math.min(imageSize.height - 1, Math.round(selection.y * sy)));
  const width = Math.max(1, Math.min(imageSize.width - x, Math.round(selection.width * sx)));
  const height = Math.max(1, Math.min(imageSize.height - y, Math.round(selection.height * sy)));
  return { x, y, width, height };
}

/** 选择框旁的按钮条位置：优先放框下方，放不下就翻到上方，并夹在窗口内。 */
export function toolbarPosition(
  selection: Rect,
  view: { width: number; height: number },
  size: { width: number; height: number },
  gap = 10
): { x: number; y: number } {
  const preferredY = selection.y + selection.height + gap;
  const y =
    preferredY + size.height <= view.height
      ? preferredY
      : Math.max(0, selection.y - size.height - gap);
  const centeredX = selection.x + Math.round((selection.width - size.width) / 2);
  const x = Math.max(0, Math.min(view.width - size.width, centeredX));
  return { x, y };
}
