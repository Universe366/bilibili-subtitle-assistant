// 插件 ↔ 桌面桥：把当前视频的字幕与总结推送到本机桌面端。
//
// 桌面端协议见 desktop/docs/BRIDGE.md：
//   POST http://127.0.0.1:<port>/v1/ingest
//   Authorization: Bearer <token>
//
// 这里只负责构造 payload 和发请求，不碰 UI；按钮在 panel-actions 的「⋯」菜单里。

import { CONTENT_VERSION } from '../../shared/constants.js';
import { store } from './store.js';

function detectBrowser() {
  try {
    const ua = navigator.userAgent || '';
    if (/Edg\//.test(ua)) return 'edge';
    if (/Firefox\//.test(ua)) return 'firefox';
    return 'chrome';
  } catch (err) {
    return 'chrome';
  }
}

function clientId() {
  try {
    return chrome.runtime.id || 'extension';
  } catch (err) {
    return 'extension';
  }
}

function lineTimes(line) {
  const start = Number(line && (line.from != null ? line.from : line.start));
  const end = Number(line && (line.to != null ? line.to : line.end));
  return {
    start: Number.isFinite(start) ? Math.max(0, start) : 0,
    end: Number.isFinite(end) ? Math.max(0, end) : 0
  };
}

const LANG_LABELS = {
  'ai-zh': '中文（AI）',
  'zh-CN': '中文',
  'zh-Hans': '中文',
  'zh-Hant': '繁體中文',
  'en-US': 'English',
  'ja': '日本語'
};

export function buildDesktopPayload(state) {
  const video = state && state.video;
  if (!video) throw new Error('还没有读取视频');
  const lines = Array.isArray(state.subtitles) ? state.subtitles : [];
  if (!lines.length) throw new Error('还没有字幕可推送');

  const meta = video.subtitleMeta || {};
  const lan = String(meta.lang || 'zh-CN');
  const isAi = /^ai-/.test(lan) || meta.isAi === true;
  const url =
    video.url || (video.bvid ? `https://www.bilibili.com/video/${video.bvid}` : '');

  return {
    protocolVersion: 1,
    clientId: clientId(),
    browserKind: detectBrowser(),
    extensionVersion: CONTENT_VERSION,
    video: {
      bvid: video.bvid || null,
      cid: video.cid == null ? null : Number(video.cid),
      epId: video.epId == null ? null : Number(video.epId),
      title: String(video.title || ''),
      owner: String(video.owner || ''),
      duration: Number(video.duration) || 0,
      url,
      cover: String(video.cover || '')
    },
    track: {
      lan,
      lanDoc: String(meta.langDoc || meta.language || LANG_LABELS[lan] || lan || '中文'),
      source: 'extension',
      isAi,
      url: `extension://${video.signature || video.bvid || 'current'}`
    },
    lines: lines
      .map((line) => {
        const text = String((line && line.text) || '').trim();
        if (!text) return null;
        const times = lineTimes(line);
        return { start: times.start, end: times.end, text };
      })
      .filter(Boolean),
    summary: typeof state.summary === 'string' ? state.summary : ''
  };
}

export async function sendToDesktop(state = store.get()) {
  const settings = (state && state.settings) || {};
  const cfg = settings.desktop || {};
  if (cfg.enabled === false) throw new Error('桌面端推送已在设置里关闭');

  const port = Number(cfg.port) || 47821;
  const token = String(cfg.token || '').trim();
  if (!token) throw new Error('先在 设置 → 桌面端 填写 Token');

  const payload = buildDesktopPayload(state);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `桌面端返回 HTTP ${response.status}`);
    }
    return data;
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('连接桌面端超时（15 秒）');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
