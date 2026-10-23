import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 标签页会话：退出/崩溃后下次启动能恢复。
 *
 * 只存 URL / 标题 / 当前激活地址，不存页面状态；恢复时按顺序重建 WebContentsView。
 * 文件放 userData/session.json，跟数据目录一起迁移。
 */
export interface SessionTab {
  url: string;
  title: string;
}

export interface SessionState {
  version: 1;
  activeUrl: string;
  tabs: SessionTab[];
}

const VERSION = 1;
const MAX_TABS = 40;

function sessionFile(): string {
  return path.join(app.getPath('userData'), 'session.json');
}

export function loadSession(): SessionState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionFile(), 'utf8'));
    if (!raw || raw.version !== VERSION || !Array.isArray(raw.tabs)) return null;
    const tabs = raw.tabs
      .filter((tab: unknown): tab is SessionTab => {
        const value = tab as SessionTab;
        return Boolean(value && typeof value.url === 'string' && /^https?:\/\//i.test(value.url));
      })
      .slice(0, MAX_TABS)
      .map((tab: SessionTab) => ({ url: tab.url, title: String(tab.title || '') }));
    if (!tabs.length) return null;
    const activeUrl = tabs.some((tab: SessionTab) => tab.url === raw.activeUrl)
      ? String(raw.activeUrl)
      : tabs[tabs.length - 1].url;
    return { version: VERSION, activeUrl, tabs };
  } catch {
    return null;
  }
}

export function saveSession(tabs: SessionTab[], activeUrl: string): void {
  try {
    const clean = tabs
      .filter((tab) => /^https?:\/\//i.test(tab.url))
      .slice(0, MAX_TABS)
      .map((tab) => ({ url: tab.url, title: String(tab.title || '') }));
    if (!clean.length) return;
    const file = sessionFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    const state: SessionState = { version: VERSION, activeUrl, tabs: clean };
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(temp, file);
  } catch (error) {
    console.warn('[session] 保存失败:', (error as Error).message);
  }
}

export function clearSession(): void {
  try {
    fs.rmSync(sessionFile(), { force: true });
  } catch {
    // ignore
  }
}
