// 存储层：chrome.storage.local 存配置（本机、不同步），IndexedDB 存字幕缓存 / 音轨分块 / 历史。
import * as CFG from './settings.js';

const SETTINGS_KEY = 'bsub.settings.v1';
const DB_NAME = 'bsub-db';
const DB_VERSION = 1;
const STORE_CACHE = 'subtitleCache';
const STORE_AUDIO = 'audioChunks';
const STORE_HISTORY = 'history';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        const s = db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
        s.createIndex('savedAt', 'savedAt');
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        const s = db.createObjectStore(STORE_HISTORY, { keyPath: 'key' });
        s.createIndex('savedAt', 'savedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try {
      result = fn(s);
    } catch (err) {
      reject(err);
      return;
    }
    t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('IndexedDB 事务被中止'));
  });
}

function reqPromise(request) {
  return { __req: request };
}

export const db = {
  async put(store, value) {
    await tx(store, 'readwrite', (s) => s.put(value));
    return value;
  },
  async get(store, key) {
    return tx(store, 'readonly', (s) => reqPromise(s.get(key)));
  },
  async del(store, key) {
    await tx(store, 'readwrite', (s) => s.delete(key));
  },
  async all(store) {
    return tx(store, 'readonly', (s) => reqPromise(s.getAll()));
  },
  async clear(store) {
    await tx(store, 'readwrite', (s) => s.clear());
  },
  async count(store) {
    return tx(store, 'readonly', (s) => reqPromise(s.count()));
  }
};

export const STORES = { STORE_CACHE, STORE_AUDIO, STORE_HISTORY };

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

let settingsCache = null;

export async function loadSettings() {
  if (settingsCache) return settingsCache;
  let raw = null;
  try {
    const got = await chrome.storage.local.get(SETTINGS_KEY);
    raw = got ? got[SETTINGS_KEY] : null;
  } catch (err) {
    raw = null;
  }
  settingsCache = CFG.migrateSettings(raw);
  return settingsCache;
}

export async function saveSettings(next) {
  settingsCache = CFG.migrateSettings(next);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settingsCache });
  return settingsCache;
}

// 局部更新（点路径，如 ['general','theme']），避免整对象覆盖丢字段。
export async function patchSettings(path, value) {
  const cur = await loadSettings();
  const clone = JSON.parse(JSON.stringify(cur));
  let node = clone;
  for (let i = 0; i < path.length - 1; i += 1) {
    if (!CFG.isPlainObject(node[path[i]])) node[path[i]] = {};
    node = node[path[i]];
  }
  node[path[path.length - 1]] = value;
  return saveSettings(clone);
}

export async function updateSettings(patch) {
  const cur = await loadSettings();
  return saveSettings(CFG.deepMerge(cur, patch));
}

export function invalidateSettingsCache() {
  settingsCache = null;
}

// ---------------------------------------------------------------------------
// 字幕缓存：key 去掉查询串（签名短时效，带查询串会导致永不命中）
// ---------------------------------------------------------------------------

export function subtitleCacheKey(parts) {
  const { bvid, cid, page, lang, url } = parts;
  const clean = stripQuery(url || '');
  // 只保留 path（去掉 host 上的易变子域）
  let pathKey = clean;
  try {
    const u = new URL(clean, 'https://x.invalid');
    pathKey = u.pathname;
  } catch (err) {
    /* 保留原样 */
  }
  return ['sub', bvid || '-', cid || '-', page == null ? '-' : String(page), lang || '-', pathKey].join('|');
}

export function stripQuery(url) {
  return String(url || '').split('#')[0].split('?')[0];
}

export async function cacheGetSubtitle(key) {
  const row = await db.get(STORE_CACHE, key);
  if (!row) return null;
  return row;
}

export async function cachePutSubtitle(key, payload, meta = {}) {
  const row = {
    key,
    savedAt: Date.now(),
    payload,
    meta
  };
  await db.put(STORE_CACHE, row);
  return row;
}

export async function cacheClearOld(days) {
  if (!days || days <= 0) return 0;
  const cutoff = Date.now() - days * 86400000;
  const rows = await db.all(STORE_CACHE);
  let removed = 0;
  for (const r of rows) {
    if (!r.savedAt || r.savedAt < cutoff) {
      await db.del(STORE_CACHE, r.key);
      removed += 1;
    }
  }
  return removed;
}

export async function cacheStats() {
  const rows = await db.all(STORE_CACHE);
  const audio = await db.count(STORE_AUDIO);
  const history = await db.count(STORE_HISTORY);
  let bytes = 0;
  for (const r of rows) {
    try {
      bytes += JSON.stringify(r.payload || {}).length;
    } catch (err) {
      /* ignore */
    }
  }
  return { subtitleCount: rows.length, audioCount: audio, historyCount: history, approxBytes: bytes };
}

// ---------------------------------------------------------------------------
// 音轨分块（历史遗留：音频缓存功能未启用，只保留清理入口供「清空缓存」使用）
// ---------------------------------------------------------------------------

export async function clearAudioChunks() {
  await db.clear(STORE_AUDIO);
}

// ---------------------------------------------------------------------------
// 历史记录
// ---------------------------------------------------------------------------

export function historyKey(video) {
  return [video.bvid || '-', video.cid || '-', video.page == null ? '-' : String(video.page)].join('|');
}

export async function historyPut(video, entry) {
  const key = historyKey(video);
  const prev = (await db.get(STORE_HISTORY, key)) || {};
  const row = {
    key,
    savedAt: Date.now(),
    video: {
      bvid: video.bvid,
      aid: video.aid,
      cid: video.cid,
      page: video.page,
      title: video.title,
      partTitle: video.partTitle,
      owner: video.owner,
      duration: video.duration
    },
    ...prev,
    ...entry
  };
  // 空字符串/空数组不该覆盖已有内容。
  //
  // 这里是「合并写」（{...prev, ...entry}），而调用方经常在 summary
  // 已被清空的时候保存字幕 —— 若 entry.summary === ''，已经存好的总结
  // 就会被抹掉，表现为「字幕有、总结没了」。
  // 调用方已尽量不写空值，这里再加一道兜底，防止将来别的调用方踩同一个坑。
  if (entry && entry.summary === '' && prev.summary) row.summary = prev.summary;
  if (entry && Array.isArray(entry.lines) && entry.lines.length === 0 && Array.isArray(prev.lines) && prev.lines.length) {
    row.lines = prev.lines;
  }
  await db.put(STORE_HISTORY, row);
  return row;
}

export async function historyList(limit = 100) {
  const rows = await db.all(STORE_HISTORY);
  rows.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return rows.slice(0, limit);
}

export async function historyGet(key) {
  return db.get(STORE_HISTORY, key);
}

export async function historyRemove(key) {
  await db.del(STORE_HISTORY, key);
}

export async function historyClear() {
  await db.clear(STORE_HISTORY);
}
