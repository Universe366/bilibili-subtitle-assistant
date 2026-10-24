export type UpdateSource = 'github' | 'mirror' | 'custom';

export interface ProbeResult {
  ok: boolean;
  ms: number;
}

export interface FeedChoice {
  source: UpdateSource;
  url: string | null;
}

/** GitHub Releases 的 latest.yml 固定地址（用于测速）。 */
export function githubFeedUrl(repo: string): string {
  return `https://github.com/${repo}/releases/latest/download`;
}

/** 去掉末尾斜杠，避免拼出 `//latest.yml`。 */
export function normalizeFeedBase(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '');
}

/**
 * 选择更新源：镜像可用且明显更快时走镜像，否则默认 GitHub。
 * 阈值 300ms 是为了避免两边接近时来回切换。
 */
export function chooseSource(github: ProbeResult, mirror: ProbeResult | null): UpdateSource {
  if (!mirror || !mirror.ok) return 'github';
  if (!github.ok) return 'mirror';
  return mirror.ms + 300 < github.ms ? 'mirror' : 'github';
}

/** 结合用户显式配置，给出这次检查应使用的源。 */
export function resolveFeed(options: {
  envUrl?: string;
  customUrl?: string;
  mirrorUrl?: string;
  autoFallback: boolean;
  github: ProbeResult;
  mirror: ProbeResult | null;
}): FeedChoice {
  const custom = normalizeFeedBase(options.envUrl || options.customUrl || '');
  if (custom) return { source: 'custom', url: custom };

  const mirror = normalizeFeedBase(options.mirrorUrl || '');
  if (mirror && options.autoFallback) {
    const source = chooseSource(options.github, options.mirror);
    return { source, url: source === 'mirror' ? mirror : null };
  }
  if (mirror) return { source: 'mirror', url: mirror };
  return { source: 'github', url: null };
}
