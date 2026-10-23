import { app, session } from 'electron';

/**
 * 给应用自己的渲染进程加 CSP。
 *
 * 只按 webContentsId 过滤，内嵌网页（标签页）完全不受影响；
 * 开发模式跳过，避免挡住 Vite 的 HMR 和 React Refresh。
 */
const POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "connect-src 'self' https: http://127.0.0.1:* ws://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'none'"
].join('; ');

export function installCsp(appContentsId: () => number | null): void {
  if (!app.isPackaged) return;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const id = appContentsId();
    if (!id || details.webContentsId !== id) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const headers = { ...(details.responseHeaders || {}) };
    headers['Content-Security-Policy'] = [POLICY];
    callback({ responseHeaders: headers });
  });
}
