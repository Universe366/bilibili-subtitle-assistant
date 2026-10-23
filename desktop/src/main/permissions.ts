import { app, dialog, session } from 'electron';
import type { WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 站点权限闸门。
 *
 * 之前没有 setPermissionRequestHandler，等于任何网页都能直接申请摄像头/麦克风/通知。
 * 现在：应用自己的界面放行；普通网站首次请求时弹窗，用户可以选择「记住」；
 * 没记住的一律拒绝，选择写入 `userData/permissions.json`。
 */
type Decision = 'allow' | 'deny';

interface PermissionStore {
  version: 1;
  sites: Record<string, Record<string, Decision>>;
}

const SAFE_BY_DEFAULT = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write']);

const LABELS: Record<string, string> = {
  media: '摄像头 / 麦克风',
  notifications: '系统通知',
  'clipboard-read': '读取剪贴板',
  geolocation: '位置信息',
  midi: 'MIDI 设备',
  midiSysex: 'MIDI 设备',
  openExternal: '打开外部应用',
  'display-capture': '屏幕共享',
  'speaker-selection': '选择扬声器',
  'window-management': '窗口管理',
  unknown: '未知权限'
};

function storeFile(): string {
  return path.join(app.getPath('userData'), 'permissions.json');
}

function readStore(): PermissionStore {
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    if (raw && typeof raw === 'object' && raw.sites && typeof raw.sites === 'object') {
      return { version: 1, sites: raw.sites };
    }
  } catch {
    // 文件不存在或损坏都回到空表
  }
  return { version: 1, sites: {} };
}

function writeStore(store: PermissionStore): void {
  try {
    const file = storeFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(temp, file);
  } catch (error) {
    console.warn('[permissions] 保存失败:', (error as Error).message);
  }
}

function originOf(url: string): string {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

function lookup(origin: string, permission: string): Decision | undefined {
  return readStore().sites[origin]?.[permission];
}

function remember(origin: string, permission: string, decision: Decision): void {
  const store = readStore();
  store.sites[origin] = { ...(store.sites[origin] || {}), [permission]: decision };
  writeStore(store);
}

function labelOf(permission: string): string {
  return LABELS[permission] || permission;
}

export function permissionSummary(): Array<{
  origin: string;
  permission: string;
  decision: Decision;
}> {
  const store = readStore();
  return Object.entries(store.sites).flatMap(([origin, permissions]) =>
    Object.entries(permissions).map(([permission, decision]) => ({ origin, permission, decision }))
  );
}

export function clearSitePermissions(): number {
  const store = readStore();
  const count = Object.values(store.sites).reduce(
    (total, permissions) => total + Object.keys(permissions).length,
    0
  );
  writeStore({ version: 1, sites: {} });
  return count;
}

export function revokeSitePermission(origin: string, permission: string): boolean {
  const store = readStore();
  const site = store.sites[String(origin || '')];
  if (!site || !(permission in site)) return false;
  delete site[permission];
  if (!Object.keys(site).length) delete store.sites[String(origin || '')];
  writeStore(store);
  return true;
}

export function installPermissionGate(appRendererId: () => number | null): void {
  const ses = session.defaultSession;

  const isAppUi = (contents: WebContents): boolean => {
    try {
      return contents.id === appRendererId();
    } catch {
      return false;
    }
  };

  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    try {
      if (!contents || contents.isDestroyed()) return callback(false);
      if (isAppUi(contents)) return callback(true);
      if (SAFE_BY_DEFAULT.has(permission)) return callback(true);

      const origin = originOf(details?.requestingUrl || contents.getURL());
      if (!origin) return callback(false);

      const known = lookup(origin, permission);
      if (known) return callback(known === 'allow');

      void dialog
        .showMessageBox({
          type: 'question',
          title: '站点权限请求',
          message: `${origin} 请求使用「${labelOf(permission)}」`,
          detail: '只在你信任这个网站时允许。选择「阻止」不会影响其它功能。',
          buttons: ['允许', '阻止'],
          defaultId: 1,
          cancelId: 1,
          checkboxLabel: '记住此站点的选择',
          checkboxChecked: true,
          noLink: true
        })
        .then((result) => {
          const decision: Decision = result.response === 0 ? 'allow' : 'deny';
          if (result.checkboxChecked) remember(origin, permission, decision);
          callback(decision === 'allow');
        })
        .catch((error: Error) => {
          console.warn('[permissions] 弹窗失败:', error.message);
          callback(false);
        });
      return undefined;
    } catch (error) {
      console.warn('[permissions] 处理请求失败:', (error as Error).message);
      return callback(false);
    }
  });

  ses.setPermissionCheckHandler((contents, permission, requestingOrigin) => {
    try {
      if (!contents || contents.isDestroyed()) return false;
      if (isAppUi(contents)) return true;
      if (SAFE_BY_DEFAULT.has(permission)) return true;
      const origin = originOf(requestingOrigin || contents.getURL());
      if (!origin) return false;
      return lookup(origin, permission) === 'allow';
    } catch {
      return false;
    }
  });

  // HID / 串口等设备类权限默认拒绝，需要时再单独开口子。
  ses.setDevicePermissionHandler(() => false);
}
