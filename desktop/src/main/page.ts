import type { WebContents } from 'electron';
import type { PageInfo, SubtitleBundle, SubtitleLine, SubtitleTrack, TrackBody } from '../shared/types';

const CHROME = process.versions.chrome;
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36 Edg/${CHROME}`;
const REFERER = 'https://www.bilibili.com/';

const ALLOWED_SUBTITLE_HOSTS = [
  /(^|\.)hdslb\.com$/i,
  /(^|\.)bilibili\.com$/i,
  /(^|\.)bilivideo\.com$/i,
  /(^|\.)bilivideo\.cn$/i
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

function normalizeImage(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  return url;
}

const viewCache = new Map<string, any>();

async function fetchView(bvid: string): Promise<any | null> {
  if (viewCache.has(bvid)) return viewCache.get(bvid);
  try {
    const res = await fetch(
      `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
      {
        headers: { 'user-agent': UA, referer: REFERER },
        signal: AbortSignal.timeout(12000)
      }
    );
    const json: any = await res.json();
    const data = json && json.code === 0 ? json.data : null;
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

export async function getSubtitles(wc: WebContents): Promise<SubtitleBundle> {
  const raw = await callPage<any>(wc, 'getSubtitleBundle', {}, 35000);
  const tracks: SubtitleTrack[] = (raw && Array.isArray(raw.tracks) ? raw.tracks : [])
    .filter((track: any) => track && track.url)
    .map((track: any) => ({
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
    sources: Array.isArray(raw && raw.sources) ? raw.sources : [],
    errors: Array.isArray(raw && raw.errors) ? raw.errors : [],
    identity: raw && raw.identity && raw.identity.signature ? String(raw.identity.signature) : undefined
  };
}

export async function getTrackBody(url: string): Promise<TrackBody> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('不支持的字幕地址协议');
  }
  if (!ALLOWED_SUBTITLE_HOSTS.some((pattern) => pattern.test(parsed.hostname))) {
    throw new Error(`字幕地址不在允许的域名内：${parsed.hostname}`);
  }

  const res = await fetch(url, {
    headers: { 'user-agent': UA, referer: REFERER },
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error(`字幕下载失败（HTTP ${res.status}）`);

  const text = await res.text();
  if (text.length > 20 * 1024 * 1024) throw new Error('字幕文件过大');

  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('字幕正文不是合法 JSON');
  }

  const body = Array.isArray(json && json.body) ? json.body : [];
  const lines: SubtitleLine[] = body.slice(0, 20000).map((line: any) => ({
    start: Number(line && line.from) || 0,
    end: Number(line && line.to) || 0,
    text: String((line && line.content) || '')
  }));

  return { lines };
}

export async function getTime(wc: WebContents): Promise<{ currentTime: number; duration: number }> {
  const data = await callPage<{ currentTime: number; duration: number }>(wc, 'getTime', {}, 8000);
  return {
    currentTime: Number(data && data.currentTime) || 0,
    duration: Number(data && data.duration) || 0
  };
}

export async function seek(wc: WebContents, time: number): Promise<void> {
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
  const raw = await callPage<any>(
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
    .filter((item: any) => item && item.url)
    .map((item: any) => ({
      url: String(item.url),
      bandwidth: Number(item.bandwidth) || undefined,
      mimeType: item.mimeType ? String(item.mimeType) : undefined,
      source: item.source ? String(item.source) : undefined,
      backupUrl: Array.isArray(item.backupUrl)
        ? item.backupUrl.filter((url: any) => typeof url === 'string' && url)
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
  const raw = await callPage<any>(wc, 'fetchAudioRange', { url, start, end }, 120000);
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
