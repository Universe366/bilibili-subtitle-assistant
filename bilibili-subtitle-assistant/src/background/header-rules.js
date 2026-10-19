// 去掉「浏览器上下文」请求头，绕过某些网关的 CSRF 校验。
//
// 背景（1.63.1）：基元律动（tokenrhythm.studio）的网关对请求做 CSRF 校验。
// 用 curl 打同一把 Key 完全正常，但从浏览器 / Electron / 扩展里打就返回
// 403 CSRF_INVALID「请求安全校验失败」。Cherry Studio 的同类报告
// (CherryHQ/cherry-studio#18362) 定位到触发源是浏览器上下文自动附加的头。
//
// Chrome 155 实测结论（写在这里，免得以后又去重新试一遍）：
//   1) declarativeNetRequest 的 modifyHeaders **可以**移除我们自己 service worker
//      发出去的 Origin / Sec-Fetch-Site / Referer —— 规则命中，对端看到的 origin=null。
//   2) condition 里**不能**写 initiatorDomains: [chrome.runtime.getURL('')]：
//      规则照样注册成功、updateSessionRules 不报错，但**永不匹配**（onRuleMatchedDebug 无回调）。
//      只写 urlFilter + resourceTypes 就正常。
//   3) 因此这里只按域名匹配。范围就是用户自己配的 API 域名，不会外溢。
//
// 只有平台定义里带 stripBrowserHeaders: true 才会启用（目前只有基元律动）。

const RULE_BASE_ID = 9100;

// host -> ruleId；同时用来做「本次 SW 生命周期内已装好」的缓存
const registered = new Map();
const inflight = new Map();

export function hostOfUrl(input) {
  try {
    const u = new URL(String(input || ''));
    return u.host || '';
  } catch (err) {
    return '';
  }
}

export function headerStripRule(host, id) {
  return {
    id,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'origin', operation: 'remove' },
        { header: 'referer', operation: 'remove' },
        { header: 'sec-fetch-site', operation: 'remove' }
      ]
    },
    condition: {
      urlFilter: `||${host}`,
      resourceTypes: ['xmlhttprequest', 'other']
    }
  };
}

function dnr() {
  try {
    return globalThis.chrome?.declarativeNetRequest || null;
  } catch (err) {
    return null;
  }
}

async function install(host) {
  const api = dnr();
  if (!api || typeof api.updateSessionRules !== 'function') return false;
  let ruleId = registered.get(host);
  if (ruleId) return true;
  // SW 随时可能被回收，session 规则却还在浏览器会话里活着：先查一次，避免重复报错
  let existing = [];
  try {
    existing = (await api.getSessionRules()) || [];
  } catch (err) {
    existing = [];
  }
  const hit = existing.find(
    (r) => r?.condition?.urlFilter === `||${host}` && r?.action?.type === 'modifyHeaders'
  );
  if (hit) {
    registered.set(host, hit.id);
    return true;
  }
  const used = new Set(existing.map((r) => r.id));
  let id = RULE_BASE_ID;
  while (used.has(id)) id += 1;
  try {
    await api.updateSessionRules({ addRules: [headerStripRule(host, id)] });
  } catch (err) {
    return false;
  }
  registered.set(host, id);
  return true;
}

// 对带 stripBrowserHeaders 的平台，在真正发请求前确保规则就位。
// 参数可以是平台对象 + 已算好的 url，也可以直接给 url。
export async function ensureHeaderRules(platform, url) {
  if (!platform || platform.stripBrowserHeaders !== true) return false;
  const host = hostOfUrl(url || platform.baseUrl);
  if (!host) return false;
  if (registered.has(host)) return true;
  if (inflight.has(host)) return inflight.get(host);
  const task = install(host).finally(() => inflight.delete(host));
  inflight.set(host, task);
  return task;
}

// 给测试/诊断用：清掉缓存（不卸规则）
export function resetHeaderRuleCache() {
  registered.clear();
  inflight.clear();
}
