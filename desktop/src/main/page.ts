import type { WebContents } from 'electron';
import type {
  PageInfo,
  SubtitleBundle,
  SubtitleLine,
  SubtitleTrack,
  TrackBody
} from '../shared/types';
import { loadSettings } from './settings';
import { isYouTubeUrl, parseJson3, parseTimedTextXml, readYouTubeData } from './youtube';

const CHROME = process.versions.chrome;
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36 Edg/${CHROME}`;
const REFERER = 'https://www.bilibili.com/';

const ALLOWED_SUBTITLE_HOSTS = [
  /(^|\.)hdslb\.com$/i,
  /(^|\.)bilibili\.com$/i,
  /(^|\.)bilivideo\.com$/i,
  /(^|\.)bilivideo\.cn$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)google\.com$/i
];

const HELPER_DEF = String.raw`
if (!window.__bsubDesktopCall) {
  window.__bsubDesktopCall = function (method, params, deadlineMs) {
    return new Promise(function (resolve, reject) {
      var id = 'desk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      var t0 = Date.now();
      var written = false;
      function write() {
        var el = document.getElementById('__bsub_content_channel__');
        if (!el) return false;
        el.textContent = JSON.stringify({ id: id, method: method, params: params });
        el.setAttribute('data-seq', String((parseInt(el.getAttribute('data-seq') || '0', 10) || 0) + 1));
        written = true;
        return true;
      }
      var tick = setInterval(function () {
        if (!written) write();
        var out = document.getElementById('__bsub_page_channel__');
        if (out) {
          try {
            var msg = JSON.parse(out.textContent || 'null');
            if (msg && msg.id === id) {
              clearInterval(tick);
              if (msg.ok) resolve(msg.data);
              else reject(Object.assign(new Error((msg.error && msg.error.title) || '页面桥调用失败'), { payload: msg.error }));
              return;
            }
          } catch (e) { /* ignore */ }
        }
        if (Date.now() - t0 > deadlineMs) {
          clearInterval(tick);
          reject(new Error('页面桥超时：' + method));
        }
      }, 120);
    });
  };
}
`;

function bridgeScript(method: string, params: unknown, helperTimeoutMs: number): string {
  return `(() => { ${HELPER_DEF}; return window.__bsubDesktopCall(${JSON.stringify(
    method
  )}, ${JSON.stringify(params ?? {})}, ${helperTimeoutMs}); })()`;
}

// 页面桥只有一个 DOM 信箱：并发请求会互相覆盖，必须按 webContents 串行。
const pageQueues = new WeakMap<WebContents, Promise<unknown>>();

const TRACK_CACHE_MAX = 100;
const trackCache = new Map<string, { at: number; lines: SubtitleLine[] }>();

function trackCacheKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

async function rawCall<T>(
  wc: WebContents,
  method: string,
  params: unknown,
  timeoutMs: number
): Promise<T> {
  const script = bridgeScript(method, params, Math.max(3000, timeoutMs - 1500));
  const pending = wc.executeJavaScript(script, true) as Promise<T>;
  return Promise.race([
    pending,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`页面调用超时：${method}`)), timeoutMs)
    )
  ]);
}

export function callPage<T>(
  wc: WebContents,
  method: string,
  params: unknown = {},
  timeoutMs = 30000
): Promise<T> {
  const previous = pageQueues.get(wc) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => rawCall<T>(wc, method, params, timeoutMs));
  pageQueues.set(
    wc,
    next.then(
      () => undefined,
      () => undefined
    )
  );
  return next;
}

interface BiliViewData {
  pic?: string;
  pubdate?: number;
  stat?: { view?: number; danmaku?: number };
}

interface RawSubtitleTrack {
  lan?: string;
  lanDoc?: string;
  url?: string;
  isAi?: boolean;
  aiStatus?: number | null;
  source?: string;
}

interface RawSubtitleBundle {
  tracks?: RawSubtitleTrack[];
  sources?: string[] | undefined;
  signatureChanged?: boolean;
  identityMismatch?: boolean;
  identityUnstable?: boolean;
  foreignTracksDetail?: unknown[];
  errors?: Array<{ source?: string; code?: string | number; message?: string }>;
  groups?: unknown[];
  sniffed?: unknown[];
  foreignTracks?: unknown[];
  sniffCount?: number;
  staleSniffCount?: number;
  needLogin?: boolean;
  reason?: string;
  identity?: { signature?: string };
}

interface RawTrackBody {
  body?: Array<{ from?: number; to?: number; content?: string }>;
}

interface RawAudioCandidate {
  url?: string;
  bandwidth?: number;
  mimeType?: string;
  source?: string;
  backupUrl?: unknown[];
}

interface RawAudioCandidates {
  ok?: boolean;
  reason?: string;
  candidates?: RawAudioCandidate[];
}

interface RawAudioRange {
  ok?: boolean;
  reason?: string;
  status?: number;
  message?: string;
  base64?: string;
  contentType?: string;
  contentRange?: string;
}

function normalizeImage(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  return url;
}

const viewCache = new Map<string, BiliViewData | null>();

async function fetchView(bvid: string): Promise<BiliViewData | null> {
  if (viewCache.has(bvid)) return viewCache.get(bvid) ?? null;
  try {
    const res = await fetch(
      `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
      {
        headers: { 'user-agent': UA, referer: REFERER },
        signal: AbortSignal.timeout(12000)
      }
    );
    const json = (await res.json()) as { code?: number; data?: BiliViewData };
    const data: BiliViewData | null = json && json.code === 0 ? (json.data ?? null) : null;
    viewCache.set(bvid, data);
    if (viewCache.size > 100) {
      const first = viewCache.keys().next().value;
      if (first) viewCache.delete(first);
    }
    return data;
  } catch {
    return null;
  }
}

export async function getPageInfo(wc: WebContents): Promise<PageInfo> {
  if (isYouTubeUrl(wc.getURL())) {
    const youtube = await readYouTubeData(wc);
    if (youtube) return youtube.info;
    throw new Error('没有读取到 YouTube 视频信息');
  }

  let raw: PageInfo & { ok?: boolean };
  try {
    raw = await callPage<PageInfo & { ok?: boolean }>(wc, 'getInfo', {}, 12000);
  } catch {
    // 页面刚跳转时桥可能还没就绪，重试一次
    await new Promise((resolve) => setTimeout(resolve, 700));
    raw = await callPage<PageInfo & { ok?: boolean }>(wc, 'getInfo', {}, 12000);
  }
  if (!raw || raw.ok === false) throw new Error('页面信息不可用');

  const info: PageInfo = { ...raw };
  if (info.bvid) {
    const view = await fetchView(info.bvid);
    if (view) {
      info.cover = normalizeImage(view.pic);
      info.stat = {
        view: Number(view.stat && view.stat.view) || 0,
        danmaku: Number(view.stat && view.stat.danmaku) || 0
      };
      info.pubdate = Number(view.pubdate) || undefined;
    }
  }
  return info;
}

export async function getSubtitles(
  wc: WebContents,
  expectSignature?: string
): Promise<SubtitleBundle> {
  if (isYouTubeUrl(wc.getURL())) {
    const youtube = await readYouTubeData(wc);
    const tracks = youtube?.tracks || [];
    return {
      needLogin: false,
      tracks,
      sources: ['youtube'],
      errors: tracks.length ? [] : [{ source: 'youtube', message: '这个视频没有可用的字幕轨' }],
      identity: youtube?.info.signature,
      diagnostics: {
        groups: [],
        sniffed: [],
        foreignTracks: [],
        sniffCount: 0,
        staleSniffCount: 0,
        signatureChanged: Boolean(
          expectSignature && youtube && expectSignature !== youtube.info.signature
        ),
        identityMismatch: Boolean(
          expectSignature && youtube && expectSignature !== youtube.info.signature
        ),
        identityUnstable: false,
        reason: tracks.length ? '' : 'youtube-no-captions'
      }
    };
  }

  const raw = await callPage<RawSubtitleBundle>(
    wc,
    'getSubtitleBundle',
    expectSignature ? { expectSignature } : {},
    35000
  );
  const tracks: SubtitleTrack[] = (raw && Array.isArray(raw.tracks) ? raw.tracks : [])
    .filter((track) => track && track.url)
    .map((track) => ({
      lan: String(track.lan || ''),
      lanDoc: String(track.lanDoc || track.lan || ''),
      url: String(track.url),
      isAi: Boolean(track.isAi),
      aiStatus: track.aiStatus == null ? null : track.aiStatus,
      source: String(track.source || '')
    }));

  return {
    needLogin: Boolean(raw && raw.needLogin),
    tracks,
    sources: Array.isArray(raw?.sources) ? raw.sources : [],
    errors: Array.isArray(raw?.errors) ? raw.errors : [],
    identity:
      raw && raw.identity && raw.identity.signature ? String(raw.identity.signature) : undefined,
    diagnostics: {
      groups: Array.isArray(raw?.groups) ? raw.groups.map(String) : [],
      sniffed: Array.isArray(raw?.sniffed) ? raw.sniffed : [],
      foreignTracks: Array.isArray(raw?.foreignTracks)
        ? (raw.foreignTracks as Array<{
            from?: string;
            cid?: string;
            lan?: string;
            source?: string;
            url?: string;
          }>)
        : [],
      sniffCount: Number(raw?.sniffCount) || 0,
      staleSniffCount: Number(raw?.staleSniffCount) || 0,
      signatureChanged: Boolean(raw?.signatureChanged),
      identityMismatch: Boolean(raw?.identityMismatch),
      identityUnstable: Boolean(raw?.identityUnstable),
      reason: raw?.reason ? String(raw.reason) : ''
    }
  };
}

export async function triggerSubtitleMenu(wc: WebContents): Promise<void> {
  if (isYouTubeUrl(wc.getURL())) return;
  await callPage(wc, 'triggerSubtitleMenu', {}, 12000);
}

export async function getTrackBody(url: string): Promise<TrackBody> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('不支持的字幕地址协议');
  }
  if (!ALLOWED_SUBTITLE_HOSTS.some((pattern) => pattern.test(parsed.hostname))) {
    throw new Error(`字幕地址不在允许的域名内：${parsed.hostname}`);
  }

  const settings = loadSettings();
  const cacheEnabled = settings.general.cacheSubtitles !== false;
  const cacheDays = Math.max(0, Number(settings.general.subtitleCacheDays) || 0);
  const ttlMs = cacheDays > 0 ? cacheDays * 24 * 60 * 60 * 1000 : 0;
  const cacheKey = trackCacheKey(url);
  const cached = cacheEnabled && ttlMs > 0 ? trackCache.get(cacheKey) : undefined;
  if (cached && Date.now() - cached.at < ttlMs) {
    return { lines: cached.lines.map((line) => ({ ...line })) };
  }

  const isYouTubeHost =
    /(^|\.)youtube\.com$/i.test(parsed.hostname) || /(^|\.)google\.com$/i.test(parsed.hostname);
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      referer: isYouTubeHost ? 'https://www.youtube.com/' : REFERER
    },
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error(`字幕下载失败（HTTP ${res.status}）`);

  const text = await res.text();
  if (text.length > 20 * 1024 * 1024) throw new Error('字幕文件过大');

  if (isYouTubeHost) {
    let lines = parseJson3(text);
    if (!lines.length) lines = parseTimedTextXml(text);
    if (!lines.length) throw new Error('YouTube 字幕为空或格式无法解析');
    if (cacheEnabled && ttlMs > 0) {
      trackCache.set(cacheKey, { at: Date.now(), lines });
      if (trackCache.size > TRACK_CACHE_MAX) {
        const oldest = trackCache.keys().next().value;
        if (oldest) trackCache.delete(oldest);
      }
    }
    return { lines };
  }

  let json: RawTrackBody | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('字幕正文不是合法 JSON');
  }

  const body = Array.isArray(json?.body) ? json.body : [];
  const lines: SubtitleLine[] = body.slice(0, 20000).map((line) => ({
    start: Number(line && line.from) || 0,
    end: Number(line && line.to) || 0,
    text: String((line && line.content) || '')
  }));

  const result = { lines };
  if (cacheEnabled && ttlMs > 0) {
    trackCache.set(cacheKey, { at: Date.now(), lines });
    if (trackCache.size > TRACK_CACHE_MAX) {
      const oldest = trackCache.keys().next().value;
      if (oldest) trackCache.delete(oldest);
    }
  }
  return result;
}

export async function getTime(wc: WebContents): Promise<{ currentTime: number; duration: number }> {
  if (isYouTubeUrl(wc.getURL())) {
    try {
      const data = (await wc.executeJavaScript(
        `(() => { const v = document.querySelector('video'); return v ? { currentTime: v.currentTime || 0, duration: v.duration || 0 } : null; })()`,
        true
      )) as { currentTime?: number; duration?: number } | null;
      return {
        currentTime: Number(data?.currentTime) || 0,
        duration: Number(data?.duration) || 0
      };
    } catch {
      return { currentTime: 0, duration: 0 };
    }
  }
  const data = await callPage<{ currentTime: number; duration: number }>(wc, 'getTime', {}, 8000);
  return {
    currentTime: Number(data && data.currentTime) || 0,
    duration: Number(data && data.duration) || 0
  };
}

export async function seek(wc: WebContents, time: number): Promise<void> {
  if (isYouTubeUrl(wc.getURL())) {
    await wc.executeJavaScript(
      `(() => { const v = document.querySelector('video'); if (v) v.currentTime = ${Number(time) || 0}; })()`,
      true
    );
    return;
  }
  await callPage(wc, 'seek', { time }, 8000);
}

export interface AudioCandidate {
  url: string;
  bandwidth?: number;
  mimeType?: string;
  source?: string;
  backupUrl?: string[];
}

export async function getAudioCandidates(
  wc: WebContents,
  info: PageInfo
): Promise<AudioCandidate[]> {
  const raw = await callPage<RawAudioCandidates>(
    wc,
    'getAudioCandidates',
    {
      aid: info.aid,
      bvid: info.bvid,
      cid: info.cid,
      signature: info.signature
    },
    45000
  );
  if (!raw || raw.ok === false) {
    throw new Error(raw?.reason || '没有可用的音轨');
  }
  const candidates: AudioCandidate[] = (Array.isArray(raw.candidates) ? raw.candidates : [])
    .filter((item) => item && item.url)
    .map((item) => ({
      url: String(item.url),
      bandwidth: Number(item.bandwidth) || undefined,
      mimeType: item.mimeType ? String(item.mimeType) : undefined,
      source: item.source ? String(item.source) : undefined,
      backupUrl: Array.isArray(item.backupUrl)
        ? item.backupUrl.filter((url): url is string => typeof url === 'string' && Boolean(url))
        : undefined
    }));
  if (!candidates.length) throw new Error('没有可用的音轨候选');
  return candidates;
}

export async function fetchAudioRange(
  wc: WebContents,
  url: string,
  start: number,
  end: number
): Promise<{ bytes: Buffer; contentType: string; contentRange: string }> {
  const raw = await callPage<RawAudioRange>(wc, 'fetchAudioRange', { url, start, end }, 120000);
  if (!raw || raw.ok === false) {
    const reason =
      raw?.reason === 'html'
        ? '防盗链拦截（返回了 HTML）'
        : raw?.status
          ? `HTTP ${raw.status}`
          : raw?.message || raw?.reason || '音轨请求失败';
    throw new Error(`音轨下载失败：${reason}`);
  }
  return {
    bytes: Buffer.from(String(raw.base64 || ''), 'base64'),
    contentType: String(raw.contentType || ''),
    contentRange: String(raw.contentRange || '')
  };
}
