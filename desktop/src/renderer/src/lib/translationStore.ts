import type { SubtitleLine } from '../../../shared/types';

interface TranslationResult {
  key: string;
  lines: SubtitleLine[];
  language: string;
  at: number;
}

const MAX_ENTRIES = 24;
const cache = new Map<string, TranslationResult>();

function trackKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return String(url || '');
  }
}

function keyOf(videoKey: string, trackUrl: string): string {
  return `${videoKey}|${trackKey(trackUrl)}`;
}

export function setTranslationResult(
  videoKey: string,
  trackUrl: string,
  lines: SubtitleLine[],
  language: string
): void {
  if (!videoKey || !trackUrl || !lines.length) return;
  const key = keyOf(videoKey, trackUrl);
  cache.delete(key);
  cache.set(key, {
    key,
    lines: lines.map((line) => ({ ...line })),
    language,
    at: Date.now()
  });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export function getTranslationResult(
  videoKey: string,
  trackUrl: string
): { lines: SubtitleLine[]; language: string } | null {
  if (!videoKey || !trackUrl) return null;
  const found = cache.get(keyOf(videoKey, trackUrl));
  if (!found) return null;
  return {
    lines: found.lines.map((line) => ({ ...line })),
    language: found.language
  };
}

export function clearTranslationResult(videoKey: string, trackUrl: string): void {
  if (!videoKey || !trackUrl) return;
  cache.delete(keyOf(videoKey, trackUrl));
}
