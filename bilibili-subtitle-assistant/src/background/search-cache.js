// 检索结果缓存。
//
// 为什么需要（参考 dsh-free-search 的做法）：
//   免费引擎有匿名额度/限流，付费引擎按次计费。同一句话反复问时，
//   走缓存既省额度又快。默认 5 分钟，可在设置里设为 0 关闭。
//
// 提示注入防护的内容边界的实现放在 ../../shared/untrusted.js，
// 因为侧边栏与后台都要用同一份实现。

export class ResultCache {
  constructor({ max = 50, ttlMs = 5 * 60 * 1000 } = {}) {
    this.max = Math.max(1, max);
    this.ttlMs = Math.max(0, ttlMs);
    this.map = new Map(); // key -> { at, value }
  }

  keyOf(query, opts = {}) {
    return JSON.stringify([
      String(query || '').trim().toLowerCase(),
      Number(opts.maxResults) || 0,
      opts.providerId || '',
      opts.engineId || '',
      opts.timeRange || '',
      !!opts.fetchPageContent
    ]);
  }

  get(key) {
    if (this.ttlMs <= 0) return null;
    const hit = this.map.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return null;
    }
    // 命中后移到队尾（最近使用）
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key, value) {
    if (this.ttlMs <= 0) return;
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { at: Date.now(), value });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}
