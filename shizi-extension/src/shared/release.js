// 发布渠道与 Release 解析（纯函数，不碰 chrome.*，可在 Node 测试里直接 import）。
//
// 0.35 起桌面端与插件走**合并发布**：同一个仓库 Universe366/shizi，
// 一次 Release 同时带桌面安装包和插件 zip，tag 用的是**桌面版本号**（v0.38.9）。
// 因此插件版本不能直接取 tag，必须从资产名 `shizi-extension-v<版本>.zip` 里解析。
// 更早的独立插件仓库用过 `v<插件版本>` 的 tag（如 v2.18.6），保留兼容。

export const REPO = 'Universe366/shizi';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;

/** 插件资产名：shizi-extension-v2.18.6.zip / shizi-extension-2.18.6.zip */
export const PLUGIN_ASSET_RE = /^shizi-extension-v?(\d+\.\d+\.\d+)\.zip$/i;

/** 旧插件仓库的 tag 形如 v2.18.6；桌面端是 0.x，不会命中。 */
export const LEGACY_PLUGIN_TAG_RE = /^v?((?:2|[3-9]|\d{2,})\.\d+\.\d+)$/;

function safeString(v, max = 20000) {
  return String(v == null ? '' : v).slice(0, max);
}

/** 从资产列表里挑出插件 zip：返回 { version, asset } 或 null。 */
export function findPluginAsset(assets) {
  for (const raw of Array.isArray(assets) ? assets : []) {
    const name = safeString(raw && raw.name, 160).trim();
    const match = PLUGIN_ASSET_RE.exec(name);
    if (!match) continue;
    if (!raw || !raw.browser_download_url) continue;
    return { version: match[1], asset: raw };
  }
  return null;
}

/**
 * 把 GitHub Releases API 的一条 Release 归一成更新检查要用的结构。
 * - 合并发布：版本取自插件 zip 的资产名；
 * - 旧仓库：版本取自 tag（v2.x）；
 * - 都不是（纯桌面 Release / 空资产）返回 null，调用方应提示「没有插件包」。
 */
export function normalizeRelease(json) {
  if (!json || typeof json !== 'object') return null;
  const tag = safeString(json.tag_name, 80).trim();
  const assets = Array.isArray(json.assets)
    ? json.assets
        .filter((a) => a && a.browser_download_url)
        .map((a) => ({
          name: safeString(a.name, 160),
          url: safeString(a.browser_download_url, 500),
          size: Number(a.size) || 0
        }))
    : [];

  const plugin = findPluginAsset(json.assets);
  const legacyTag = plugin ? null : LEGACY_PLUGIN_TAG_RE.exec(tag);
  const version = plugin ? plugin.version : legacyTag ? legacyTag[1] : '';
  if (!version) return null;

  const downloadUrl = plugin
    ? safeString(plugin.asset.browser_download_url, 500)
    : safeString((assets.find((a) => /\.zip$/i.test(a.name)) || {}).url, 500);

  return {
    version,
    tag,
    legacy: !plugin,
    name: safeString((json && json.name) || tag, 200),
    notes: safeString(json && json.body, 20000),
    publishedAt: safeString(json && json.published_at, 40),
    htmlUrl: safeString((json && json.html_url) || RELEASES_URL, 500),
    downloadUrl,
    assets
  };
}
