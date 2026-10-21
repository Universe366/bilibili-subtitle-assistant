import type { PageInfo, SubtitleLine } from '../../../shared/types';

interface AsrResult {
  key: string;
  info: PageInfo;
  lines: SubtitleLine[];
}

let current: AsrResult | null = null;

export function setAsrResult(key: string, info: PageInfo, lines: SubtitleLine[]): void {
  current = { key, info, lines };
}

export function getAsrResult(key: string): AsrResult | null {
  return current && current.key === key ? current : null;
}

export function clearAsrResult(): void {
  current = null;
}
