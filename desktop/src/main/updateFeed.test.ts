import { describe, expect, it } from 'vitest';
import { chooseSource, githubFeedUrl, normalizeFeedBase, resolveFeed } from './updateFeed';

describe('updateFeed', () => {
  it('githubFeedUrl 固定指向 latest/download', () => {
    expect(githubFeedUrl('Universe366/shizi')).toBe(
      'https://github.com/Universe366/shizi/releases/latest/download'
    );
  });

  it('normalizeFeedBase 去掉末尾斜杠', () => {
    expect(normalizeFeedBase('https://a.example/feed/')).toBe('https://a.example/feed');
    expect(normalizeFeedBase('  ')).toBe('');
  });

  it('镜像不可用时永远选 GitHub', () => {
    expect(chooseSource({ ok: true, ms: 50 }, { ok: false, ms: 1 })).toBe('github');
    expect(chooseSource({ ok: false, ms: 0 }, null)).toBe('github');
  });

  it('GitHub 不可用且镜像可用时切镜像', () => {
    expect(chooseSource({ ok: false, ms: 0 }, { ok: true, ms: 900 })).toBe('mirror');
  });

  it('镜像明显更快才切，接近时保持 GitHub', () => {
    expect(chooseSource({ ok: true, ms: 1200 }, { ok: true, ms: 300 })).toBe('mirror');
    expect(chooseSource({ ok: true, ms: 1200 }, { ok: true, ms: 1100 })).toBe('github');
  });

  it('显式自定义源优先级最高', () => {
    expect(
      resolveFeed({
        envUrl: 'https://env.example/feed/',
        customUrl: 'https://custom.example/feed',
        mirrorUrl: 'https://gitee.example/feed',
        autoFallback: true,
        github: { ok: false, ms: 0 },
        mirror: { ok: true, ms: 10 }
      })
    ).toEqual({ source: 'custom', url: 'https://env.example/feed' });
  });

  it('只有镜像没有自定义源时直接走镜像', () => {
    expect(
      resolveFeed({
        mirrorUrl: 'https://gitee.example/feed',
        autoFallback: false,
        github: { ok: true, ms: 10 },
        mirror: { ok: true, ms: 900 }
      })
    ).toEqual({ source: 'mirror', url: 'https://gitee.example/feed' });
  });

  it('自动切换：镜像更快时给镜像 URL，否则 null 表示内置 GitHub', () => {
    expect(
      resolveFeed({
        mirrorUrl: 'https://gitee.example/feed',
        autoFallback: true,
        github: { ok: true, ms: 2000 },
        mirror: { ok: true, ms: 200 }
      })
    ).toEqual({ source: 'mirror', url: 'https://gitee.example/feed' });

    expect(
      resolveFeed({
        mirrorUrl: 'https://gitee.example/feed',
        autoFallback: true,
        github: { ok: true, ms: 300 },
        mirror: { ok: true, ms: 200 }
      })
    ).toEqual({ source: 'github', url: null });
  });
});
