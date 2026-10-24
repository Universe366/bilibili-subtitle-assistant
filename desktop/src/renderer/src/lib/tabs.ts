import type { TabInfo } from '../../../shared/types';

/** 按顺序循环找下一个/上一个标签；只有一个标签时返回它自己。 */
export function nextTabId(
  tabs: TabInfo[],
  activeId: string | null | undefined,
  delta: 1 | -1
): string | null {
  if (!tabs.length) return null;
  const index = tabs.findIndex((tab) => tab.id === activeId);
  if (index < 0) return tabs[0].id;
  const next = (index + delta + tabs.length) % tabs.length;
  return tabs[next].id;
}

/** Ctrl+1..9：第 n 个标签（1 起）；Ctrl+9 习惯上跳到最后一个。 */
export function tabIdByNumber(tabs: TabInfo[], position: number): string | null {
  if (!tabs.length || position < 1) return null;
  if (position === 9) return tabs[tabs.length - 1].id;
  return tabs[position - 1]?.id ?? null;
}

/** 拖拽落点 → 目标下标（放在目标标签之前/之后由调用方决定）。 */
export function moveIndexFor(tabs: TabInfo[], draggedId: string, targetId: string): number {
  const target = tabs.findIndex((tab) => tab.id === targetId);
  if (target < 0) return tabs.length - 1;
  const from = tabs.findIndex((tab) => tab.id === draggedId);
  if (from < 0 || from === target) return target;
  return from < target ? target : target;
}
