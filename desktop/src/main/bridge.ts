import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import type { BridgeStatus, PageInfo, SubtitleLine, SubtitleTrack } from '../shared/types';
import { ingestVideo, listLibrary, saveSummary } from './library';
import { loadSettings, saveSettings } from './settings';
import { applyCorrectionToLines } from './correction';

const MAX_BODY_BYTES = 20 * 1024 * 1024;

let server: http.Server | null = null;
let runningPort = 0;
let lastError = '';

function json(response: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS'
  });
  response.end(body);
}

function extOrigin(request: http.IncomingMessage): string {
  return String(request.headers.origin || '');
}

function allowedDiscoveryOrigin(origin: string): boolean {
  // 扩展的 fetch 会带 chrome-extension://<id>；网页则带 https://…
  // 只让扩展读取 token，普通网站拿不到（浏览器会因缺少 ACAO 阻止读取）。
  if (!origin) return true; // 本机进程/curl
  return /^(chrome|moz)-extension:\/\//i.test(origin);
}

function jsonWithOrigin(
  response: http.ServerResponse,
  status: number,
  payload: unknown,
  origin: string
): void {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'access-control-allow-origin': origin || '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'origin'
  };
  response.writeHead(status, headers);
  response.end(body);
}

function authorized(request: http.IncomingMessage, token: string): boolean {
  if (!token) return false;
  return String(request.headers.authorization || '') === `Bearer ${token}`;
}

function isLoopback(request: http.IncomingMessage): boolean {
  const address = request.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function toInfo(video: Record<string, unknown>): PageInfo {
  const bvid = video.bvid ? String(video.bvid) : null;
  const cid = video.cid == null ? null : Number(video.cid);
  return {
    ok: true,
    kind: 'video',
    bvid,
    aid: video.aid == null ? null : Number(video.aid),
    cid,
    epId: video.epId == null ? null : Number(video.epId),
    seasonId: null,
    page: Number(video.page) || 1,
    partTitle: String(video.partTitle || ''),
    parts: [],
    title: String(video.title || ''),
    owner: String(video.owner || ''),
    desc: String(video.desc || ''),
    duration: Number(video.duration) || 0,
    url: String(video.url || (bvid ? `https://www.bilibili.com/video/${bvid}` : '')),
    signature: String(video.signature || ''),
    cover: video.cover ? String(video.cover) : undefined
  };
}

function toTrack(track: Record<string, unknown>, info: PageInfo): SubtitleTrack {
  return {
    lan: String(track.lan || ''),
    lanDoc: String(track.lanDoc || track.lan || ''),
    url: String(track.url || `extension://${info.bvid || info.cid || 'unknown'}`),
    isAi: Boolean(track.isAi),
    aiStatus: track.aiStatus == null ? null : Number(track.aiStatus),
    source: String(track.source || 'extension')
  };
}

function toLines(raw: unknown): SubtitleLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((line) => ({
      ...(line as Record<string, unknown>),
      start: Math.max(0, Number(line?.start) || 0),
      end: Math.max(0, Number(line?.end) || 0),
      text: String(line?.text || '').trim()
    }))
    .filter((line) => line.text.length > 0);
}

function createHandler(win: BrowserWindow, token: string) {
  return async (request: http.IncomingMessage, response: http.ServerResponse) => {
    try {
      if (!isLoopback(request)) {
        json(response, 403, { ok: false, error: '只接受本机连接' });
        return;
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, POST, OPTIONS'
        });
        response.end();
        return;
      }

      const url = new URL(request.url || '/', 'http://127.0.0.1');

      // 扩展自动发现：不需要用户填端口/Token。
      // 只允许扩展来源读取；网页 Origin 会因缺少 ACAO 被浏览器拦截。
      if (url.pathname === '/v1/hello' && request.method === 'GET') {
        const origin = extOrigin(request);
        if (!allowedDiscoveryOrigin(origin)) {
          json(response, 403, { ok: false, error: '只允许浏览器扩展访问' });
          return;
        }
        jsonWithOrigin(
          response,
          200,
          {
            ok: true,
            app: 'shizi',
            name: '拾字',
            version: app.getVersion(),
            port: runningPort || loadSettings().bridge.port,
            token
          },
          origin
        );
        return;
      }

      if (url.pathname === '/v1/health') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const library = listLibrary();
        json(response, 200, {
          ok: true,
          version: app.getVersion(),
          library: { videos: library.stats.videos, segments: library.stats.segments }
        });
        return;
      }

      if (url.pathname === '/v1/ingest' && request.method === 'POST') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }

        const body = await readBody(request);
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(body);
        } catch {
          json(response, 400, { ok: false, error: '请求体不是合法 JSON' });
          return;
        }

        if (!payload || typeof payload !== 'object' || !payload.video) {
          json(response, 400, { ok: false, error: '缺少 video 字段' });
          return;
        }

        const info = toInfo(payload.video as Record<string, unknown>);
        const track = toTrack((payload.track || {}) as Record<string, unknown>, info);
        const lines = toLines(payload.lines);
        if (!lines.length) {
          json(response, 400, { ok: false, error: 'lines 为空' });
          return;
        }

        const correctedLines = applyCorrectionToLines(lines, loadSettings());
        const result = ingestVideo({ info, track, lines: correctedLines });
        let summarySaved = false;
        if (typeof payload.summary === 'string' && payload.summary.trim()) {
          saveSummary(info, payload.summary, String(payload.model || 'extension'));
          summarySaved = true;
        }
        if (win && !win.isDestroyed()) win.webContents.send('library:changed', null);

        console.log(
          '[bridge] ingest',
          info.bvid || info.cid,
          `lines=${result.lineCount}`,
          `summary=${summarySaved}`
        );
        json(response, 200, { ok: true, ...result, summarySaved });
        return;
      }

      json(response, 404, { ok: false, error: 'not found' });
    } catch (error) {
      lastError = (error as Error)?.message || String(error);
      console.warn('[bridge] error:', lastError);
      json(response, 500, { ok: false, error: lastError });
    }
  };
}

function listenOnce(win: BrowserWindow, token: string, port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const candidate = http.createServer(createHandler(win, token));
    const onError = (error: NodeJS.ErrnoException) => {
      candidate.removeListener('listening', onListening);
      candidate.close();
      reject(error);
    };
    const onListening = () => {
      candidate.removeListener('error', onError);
      resolve(candidate);
    };
    candidate.once('error', onError);
    candidate.once('listening', onListening);
    candidate.listen(port, '127.0.0.1');
  });
}

export async function startBridge(win: BrowserWindow): Promise<BridgeStatus> {
  stopBridge();
  lastError = '';

  const settings = loadSettings();
  if (!settings.bridge.enabled) {
    return bridgeStatus();
  }

  let token = settings.bridge.token;
  if (!token) {
    token = randomBytes(24).toString('hex');
    saveSettings({ ...settings, bridge: { ...settings.bridge, token } });
    console.log('[bridge] generated token');
  }

  const basePort = settings.bridge.port || 47821;
  for (let offset = 0; offset < 10; offset += 1) {
    try {
      server = await listenOnce(win, token, basePort + offset);
      runningPort = (server.address() as AddressInfo).port;
      console.log('[bridge] listening', `http://127.0.0.1:${runningPort}/v1/ingest`);
      return bridgeStatus();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE') {
        lastError = (error as Error).message;
        console.warn('[bridge] start failed:', lastError);
        break;
      }
    }
  }

  return bridgeStatus();
}

export function stopBridge(): void {
  if (server) {
    try {
      server.close();
      server.closeAllConnections?.();
    } catch {
      // ignore
    }
    server = null;
    runningPort = 0;
  }
}

export async function restartBridge(win: BrowserWindow): Promise<BridgeStatus> {
  stopBridge();
  return startBridge(win);
}

export function bridgeStatus(): BridgeStatus {
  const settings = loadSettings();
  return {
    enabled: settings.bridge.enabled,
    running: Boolean(server),
    port: runningPort || settings.bridge.port,
    token: settings.bridge.token,
    error: lastError || undefined
  };
}
