import type { CollectionResolveItem, CollectionResolveResult } from '../shared/types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function bvidOf(input: string): string | null {
  const match = String(input || '').match(/BV[0-9A-Za-z]{10}/);
  return match ? match[0] : null;
}

export async function resolveBilibiliCollection(input: string): Promise<CollectionResolveResult> {
  const bvid = bvidOf(input);
  if (!bvid) throw new Error('不是 B 站视频链接或 BV 号');

  const response = await fetch(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    {
      headers: {
        'user-agent': UA,
        referer: 'https://www.bilibili.com/'
      },
      signal: AbortSignal.timeout(15000)
    }
  );
  if (!response.ok) throw new Error(`B 站接口返回 HTTP ${response.status}`);
  interface BiliEpisode {
    bvid?: string;
    title?: string;
    cid?: number | null;
    arc?: { title?: string };
  }
  interface BiliSeason {
    title?: string;
    sections?: Array<{ episodes?: BiliEpisode[] }>;
  }
  interface BiliPage {
    page?: number;
    part?: string;
    cid?: number | null;
  }
  interface BiliViewResponse {
    code?: number;
    message?: string;
    data?: { title?: string; cid?: number | null; ugc_season?: BiliSeason; pages?: BiliPage[] };
  }
  const json = (await response.json().catch(() => null)) as BiliViewResponse | null;
  if (!json || json.code !== 0 || !json.data) {
    throw new Error(json?.message || '读取视频信息失败（可能需要登录或视频不存在）');
  }
  const data = json.data;
  const sourceUrl = `https://www.bilibili.com/video/${bvid}`;

  const season = data.ugc_season;
  const sections = Array.isArray(season?.sections) ? season.sections : [];
  const episodes = sections.flatMap((section) =>
    Array.isArray(section?.episodes) ? section.episodes : []
  );
  if (episodes.length > 1) {
    const items: CollectionResolveItem[] = episodes
      .map((episode): CollectionResolveItem | null => {
        const episodeBvid = String(episode?.bvid || '');
        if (!episodeBvid) return null;
        return {
          url: `https://www.bilibili.com/video/${episodeBvid}`,
          title: String(episode?.title || episode?.arc?.title || episodeBvid),
          bvid: episodeBvid,
          cid: episode?.cid == null ? null : Number(episode.cid),
          page: null
        } satisfies CollectionResolveItem;
      })
      .filter((item): item is CollectionResolveItem => Boolean(item));
    if (items.length > 1) {
      return {
        kind: 'season',
        title: String(season?.title || data.title || 'B 站合集'),
        total: items.length,
        items,
        sourceUrl
      };
    }
  }

  const pages = Array.isArray(data.pages) ? data.pages : [];
  if (pages.length > 1) {
    const items: CollectionResolveItem[] = pages.map((page, index: number) => {
      const pageNumber = Number(page?.page) || index + 1;
      return {
        url: `https://www.bilibili.com/video/${bvid}?p=${pageNumber}`,
        title: String(page?.part || `P${pageNumber}`),
        bvid,
        cid: page?.cid == null ? null : Number(page.cid),
        page: pageNumber
      };
    });
    return {
      kind: 'pages',
      title: String(data.title || '多 P 视频'),
      total: items.length,
      items,
      sourceUrl
    };
  }

  return {
    kind: 'single',
    title: String(data.title || bvid),
    total: 1,
    items: [
      {
        url: sourceUrl,
        title: String(data.title || bvid),
        bvid,
        cid: data.cid == null ? null : Number(data.cid),
        page: null
      }
    ],
    sourceUrl
  };
}
