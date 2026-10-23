import type { WebContents } from 'electron';
import type { PageInfo, SubtitleLine, SubtitleTrack } from '../shared/types';

/**
 * YouTube 适配层。
 *
 * 不调用需要签名的 InnerTube 接口，而是从页面自己的 `ytInitialPlayerResponse`
 * 里读标题/频道/时长和 captionTracks，再用主进程 fetch 拉 timedtext。
 * 页面结构变化时返回 null，由上层显示「没有找到字幕轨」。
 */
export interface YouTubeData {
  info: PageInfo;
  tracks: SubtitleTrack[];
}

const cache = new WeakMap<WebContents, { at: number; data: YouTubeData | null }>();
const CACHE_MS = 5000;

export function youtubeVideoId(input: string): string | null {
  try {
    const url = new URL(String(input || ''));
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[\w-]{6,}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') {
        const id = url.searchParams.get('v') || '';
        return /^[\w-]{6,}$/.test(id) ? id : null;
      }
      const match = /\/(?:shorts|embed|live)\/([\w-]{6,})/.exec(url.pathname);
      return match ? match[1] : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function isYouTubeUrl(input: string): boolean {
  return Boolean(youtubeVideoId(input));
}

const READ_SCRIPT = `(() => {
  try {
    const responses = [];
    if (window.ytInitialPlayerResponse) responses.push(window.ytInitialPlayerResponse);
    const player = window.ytplayer && window.ytplayer.config && window.ytplayer.config.args
      ? window.ytplayer.config.args.player_response
      : null;
    if (player) {
      try { responses.push(JSON.parse(player)); } catch (error) {}
    }
    const response = responses.find((item) => item && item.videoDetails);
    if (!response) return null;
    const details = response.videoDetails || {};
    const renderer = response.captions && response.captions.playerCaptionsTracklistRenderer;
    const rows = renderer && Array.isArray(renderer.captionTracks) ? renderer.captionTracks : [];
    return {
      videoId: String(details.videoId || ''),
      title: String(details.title || document.title || ''),
      author: String(details.author || ''),
      duration: Number(details.lengthSeconds) || 0,
      desc: String(details.shortDescription || '').slice(0, 4000),
      tracks: rows.map((track) => ({
        lan: String(track.languageCode || ''),
        lanDoc: String(
          (track.name && (track.name.simpleText || (track.name.runs && track.name.runs[0] && track.name.runs[0].text))) ||
            track.languageCode ||
            ''
        ),
        url: String(track.baseUrl || ''),
        isAi: String(track.kind || '') === 'asr'
      }))
    };
  } catch (error) {
    return null;
  }
})()`;

interface RawYouTube {
  videoId: string;
  title: string;
  author: string;
  duration: number;
  desc: string;
  tracks: Array<{ lan: string; lanDoc: string; url: string; isAi: boolean }>;
}

export async function readYouTubeData(
  wc: WebContents | null | undefined
): Promise<YouTubeData | null> {
  if (!wc || wc.isDestroyed()) return null;
  const url = wc.getURL();
  const videoId = youtubeVideoId(url);
  if (!videoId) return null;
  const cached = cache.get(wc);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;

  let raw: RawYouTube | null = null;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      raw = (await wc.executeJavaScript(READ_SCRIPT, true)) as RawYouTube | null;
      if (raw?.videoId) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error) {
    console.warn('[youtube] 读取页面数据失败:', (error as Error).message);
  }

  const tracks: SubtitleTrack[] = (raw?.tracks || [])
    .filter((track) => track && track.url)
    .map((track) => ({
      lan: String(track.lan || ''),
      lanDoc: String(track.lanDoc || track.lan || ''),
      url: withJson3(String(track.url)),
      isAi: Boolean(track.isAi),
      aiStatus: null,
      source: 'youtube'
    }));

  const info: PageInfo = {
    kind: 'youtube',
    bvid: null,
    aid: null,
    cid: null,
    epId: null,
    seasonId: null,
    page: 1,
    partTitle: '',
    parts: [],
    title: String(raw?.title || wc.getTitle() || videoId),
    owner: String(raw?.author || ''),
    desc: String(raw?.desc || ''),
    duration: Number(raw?.duration) || 0,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    signature: `y:${videoId}`
  };

  const data: YouTubeData = { info, tracks };
  cache.set(wc, { at: Date.now(), data });
  return data;
}

function withJson3(url: string): string {
  if (/[?&]fmt=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}fmt=json3`;
}

/** 解析 timedtext json3；没有 events 时返回空数组（调用方再尝试 XML）。 */
export function parseJson3(text: string): SubtitleLine[] {
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const events = Array.isArray(json?.events) ? json.events : [];
  const lines: SubtitleLine[] = [];
  for (const event of events) {
    const segments = Array.isArray(event?.segs) ? event.segs : [];
    const content = segments
      .map((segment: any) => String(segment?.utf8 || ''))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!content) continue;
    const start = Math.max(0, Number(event.tStartMs) || 0) / 1000;
    const duration = Math.max(0, Number(event.dDurationMs) || 0) / 1000;
    lines.push({ start, end: start + (duration || 1), text: content });
  }
  return lines;
}

/** 解析 timedtext XML（部分语言/客户端忽略 fmt=json3 时）。 */
export function parseTimedTextXml(text: string): SubtitleLine[] {
  const lines: SubtitleLine[] = [];
  const pattern = /<text[^>]*\bstart="([\d.]+)"[^>]*>(.*?)<\/text>/gis;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const start = Number(match[1]) || 0;
    const raw = match[2]
      .replace(/<!\[CDATA\[/g, '')
      .replace(/\]\]>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (!raw) continue;
    lines.push({ start, end: start + 1, text: raw });
  }
  return lines;
}
