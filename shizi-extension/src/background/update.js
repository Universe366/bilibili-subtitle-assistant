// 版本更新检查。
//
// 说明：这是「未上架 / 手动加载」版本的更新提示。
// 通过 Edge 商店安装的版本由浏览器自动更新，不依赖这里。
//
// 数据源：GitHub Releases API。仓库必须是 public，否则匿名请求会 404。
// 检查结果会缓存 24 小时，手动检查会绕过缓存。

import { CONTENT_VERSION } from '../shared/constants.js';
import { compareVersions } from '../shared/version.js';
import { loadSettings, patchSettings } from '../shared/storage.js';

const REPO = 'Universe366/shizi-extension';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const CACHE_KEY = 'bsub.update.v1';
const TTL_MS = 24 * 60 * 60 * 1000;

function safeString(v, max = 20000) {
  return String(v == null ? '' : v).slice(0, max);
}

export function normalizeRelease(json) {
  const tag = safeString(json && json.tag_name, 80).trim();
  const version = tag.replace(/^v/i, '').trim();
  if (!version) return null;
  const assets = Array.isArray(json.assets)
    ? json.assets
        .filter((a) => a && a.browser_download_url)
        .map((a) => ({
          name: safeString(a.name, 160),
          url: safeString(a.browser_download_url, 500),
          size: Number(a.size) || 0
        }))
    : [];
  return {
    version,
    tag,
    name: safeString((json && json.name) || tag, 200),
    notes: safeString(json && json.body, 20000),
    publishedAt: safeString(json && json.published_at, 40),
    htmlUrl: safeString((json && json.html_url) || RELEASES_URL, 500),
    assets
  };
}

async function readCache() {
  try {
    const got = await chrome.storage.local.get(CACHE_KEY);
    return (got && got[CACHE_KEY]) || null;
  } catch (err) {
    return null;
  }
}

async function writeCache(data) {
  try {
    await chrome.storage.local.set({ [CACHE_KEY]: data });
  } catch (err) {
    /* 缓存失败不影响本次结果 */
  }
}

export async function getUpdateState() {
  const cached = await readCache();
  return cached || { checkedAt: 0, current: CONTENT_VERSION, releaseUrl: RELEASES_URL };
}

function errorState(reason, message, extra = {}) {
  return {
    ok: false,
    reason,
    message: safeString(message, 300),
    current: CONTENT_VERSION,
    latest: '',
    hasUpdate: false,
    checkedAt: Date.now(),
    releaseUrl: RELEASES_URL,
    ...extra
  };
}

// manual=true：忽略缓存、忽略 autoCheck 开关。
export async function checkForUpdate({ manual = false, fetchImpl = fetch } = {}) {
  const cached = await readCache();
  let settings = null;
  try {
    settings = await loadSettings();
  } catch (err) {
    /* 读不到设置就按默认处理 */
  }
  const skipVersion = String((settings && settings.update && settings.update.skipVersion) || '')
    .trim()
    .replace(/^v/i, '');

  const withSkip = (data) => {
    if (!data || !data.ok) return data;
    const skipped = !!(skipVersion && data.latest === skipVersion);
    return { ...data, skipped, hasUpdate: !!data.hasUpdate && !skipped };
  };

  if (!manual && cached && cached.checkedAt && Date.now() - cached.checkedAt < TTL_MS) {
    return { ...withSkip(cached), cached: true };
  }

  if (!manual && settings && settings.update && settings.update.autoCheck === false) {
    return {
      ...(cached || {}),
      ok: cached ? !!cached.ok : false,
      reason: (cached && cached.reason) || 'disabled',
      disabled: true,
      current: CONTENT_VERSION,
      checkedAt: (cached && cached.checkedAt) || 0,
      releaseUrl: (cached && cached.releaseUrl) || RELEASES_URL
    };
  }

  let data;
  try {
    const res = await fetchImpl(API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store'
    });
    if (res.status === 404) {
      data = errorState('not-found', '仓库未公开或还没有 Release');
    } else if (res.status === 403 || res.status === 429) {
      data = errorState('rate-limit', 'GitHub API 限流，请稍后再试');
    } else if (!res.ok) {
      data = errorState('http', `GitHub 返回 HTTP ${res.status}`);
    } else {
      const json = await res.json();
      const release = normalizeRelease(json);
      if (!release) {
        data = errorState('bad-release', 'Release 数据缺少版本号');
      } else {
        data = {
          ok: true,
          current: CONTENT_VERSION,
          latest: release.version,
          hasUpdate: compareVersions(release.version, CONTENT_VERSION) > 0,
          release,
          releaseUrl: release.htmlUrl,
          checkedAt: Date.now()
        };
      }
    }
  } catch (err) {
    data = errorState('network', (err && err.message) || '网络请求失败');
  }

  data = withSkip(data);
  await writeCache(data);
  return data;
}

// 记录「跳过此版本」。传空字符串表示取消跳过。
export async function setSkippedVersion(version) {
  const v = safeString(version, 40).trim().replace(/^v/i, '');
  await patchSettings(['update', 'skipVersion'], v);
  try {
    await chrome.storage.local.remove(CACHE_KEY);
  } catch (err) {
    /* 缓存清不掉不影响下次手动检查 */
  }
  return { skipVersion: v };
}

// 在 service worker 里注册：每天检查一次；启动时也检查一次（有缓存则直接复用）。
export function initUpdateChecker() {
  try {
    if (chrome.alarms && chrome.alarms.create) {
      chrome.alarms.create('bsub-update-check', { periodInMinutes: 24 * 60, delayInMinutes: 3 });
    }
    if (chrome.alarms && chrome.alarms.onAlarm) {
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm && alarm.name === 'bsub-update-check') checkForUpdate().catch(() => {});
      });
    }
  } catch (err) {
    /* 旧环境没有 alarms，面板打开时仍会检查 */
  }
  checkForUpdate().catch(() => {});
}
