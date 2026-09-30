// 复用 B 站**原始 AAC 音轨**：按字节范围取「init + sidx 索引 + 各分片」，
// 拼成完整 fMP4 直接上传 —— 完全不解码、不重编码。
//
// 为什么值得做（实测数据，BV1be41127ft，974 秒）：
//   · B 站音轨   ~41 kbps  →  2.38 MB
//   · 我们的 WAV 16kHz 单声道  →  29.7 MB
// 体积降到 8%，于是「下载 + 上传」这两段（用户实测占大头的时间）大幅缩短，
// 而且彻底省掉解码与（实时）重编码。
//
// 实测验证过：逐字节按 sidx 取回的分片与索引声明的大小完全一致，
// 拼出来的文件头部是 ftyp、含 mdat，Chrome 的 <audio> 能正常加载（无 error）。
//
// ⚠ 已知限制：这是 fragmented MP4 且**不带 moov 里的总时长**，
// 因此某些服务端可能不接受。所以调用方必须保留回退路径
// （本模块不做决定，由 transcribe.js 在失败时退回 WAV/M4A）。

// "0-942" → { start: 0, end: 942 }
export function parseByteRange(s) {
  const m = /^(\d+)-(\d+)$/.exec(String(s || '').trim());
  return m ? { start: Number(m[1]), end: Number(m[2]) } : null;
}

// 解析 sidx box。
//
// ⚠ 这里有两个**都踩过的坑**：
//
// 1) version+flags 之后还有 4 字节 `reference_ID`。漏掉它会把
//    reference_count 读成 0（表现为「索引里 0 个分片」）。
//
// 2) **偏移的基准是「sidx 所在的那个数据段的起始」，不是文件起始**。
//    `first_offset` 是相对 sidx box 之后的位置，所以第一个分片的绝对偏移是：
//
//        baseOffset + boxStart + boxSize + firstOffset
//
//    其中 baseOffset 是「传出这份 sidx 字节的那一段在文件里的起点」
//    （B 站的 indexRange 从 943 开始，不是 0）。
//    我一开始漏了 baseOffset，于是每个分片偏移都少了 943 字节 ——
//    取回来的是**错位的字节**，拼出来的音频是坏的，
//    而表面积上一切正常（长度对、box 头也在），极难发现。
//
// 返回 { timescale, earliest, segments:[{offset,size,dur}] }
// offset 为**相对整个资源**的字节偏移。
export function parseSidx(buf, opts = {}) {
  const baseOffset = Math.max(0, Number(opts.baseOffset) || 0);
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf || 0);
  if (!bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 找到 sidx（一般就在 index 段开头）
  let p = 0;
  let boxStart = -1;
  let boxSize = 0;
  while (p + 8 <= bytes.length) {
    const size = view.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    if (type === 'sidx') {
      boxStart = p;
      boxSize = size;
      break;
    }
    if (size < 8) break;
    p += size;
  }
  if (boxStart < 0) return null;

  let q = boxStart + 8;
  const version = bytes[q];
  q += 4; // version(1) + flags(3)
  q += 4; // ★ reference_ID
  const timescale = view.getUint32(q);
  q += 4;
  let earliest = 0;
  if (version === 0) {
    earliest = view.getUint32(q);
    q += 4;
  } else {
    earliest = Number(view.getBigUint64(q));
    q += 8;
  }
  const firstOffset = view.getUint32(q);
  q += 4;
  q += 2; // reserved
  const refCount = view.getUint16(q);
  q += 2;

  const segments = [];
  // ★ 绝对偏移 = 数据段起点 + sidx 在段内的位置 + sidx 长度 + first_offset
  let off = baseOffset + boxStart + boxSize + firstOffset;
  for (let i = 0; i < refCount && q + 12 <= bytes.length; i += 1) {
    const refSize = view.getUint32(q) >>> 1; // 最高位是 reference_type
    q += 4;
    const dur = view.getUint32(q);
    q += 4;
    q += 4; // SAP 等
    segments.push({ offset: off, size: refSize, dur });
    off += refSize;
  }
  return { timescale, earliest, segments, boxSize, firstOffset, baseOffset, dataStart: baseOffset + boxStart + boxSize };
}

// 把 sidx 的分片按目标时长（秒）分组成若干「切片」。
// 每片 = init 段 + 连续若干分片 → 各自都是一个可独立播放的 fMP4。
//
// 一次遍历同时算出「字节范围」与「时间范围」，避免调用方再按字节区间
// 反查分片（那是 O(n·m) 的重复扫描）。
export function groupSegmentsIntoSlices(sidx, initLen, targetSeconds) {
  const ts = (sidx && sidx.timescale) || 0;
  const segs = (sidx && sidx.segments) || [];
  if (!ts || !segs.length) return [];
  const targetTicks = Math.max(1, targetSeconds) * ts;
  const out = [];
  let cur = null;
  let tick = 0;
  for (const s of segs) {
    if (!cur) cur = { startTick: tick, dur: 0, parts: [] };
    cur.parts.push(s);
    cur.dur += s.dur;
    tick += s.dur;
    if (cur.dur >= targetTicks) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur && cur.parts.length) out.push(cur);
  return out.map((g) => {
    const first = g.parts[0];
    const last = g.parts[g.parts.length - 1];
    return {
      from: g.startTick / ts,
      to: (g.startTick + g.dur) / ts,
      bytesFrom: first.offset,
      bytesTo: last.offset + last.size - 1,
      bytes: g.parts.reduce((a, s) => a + s.size, 0) + initLen,
      parts: g.parts,
      segCount: g.parts.length
    };
  });
}

// 用 Range 取一段字节。fetcher 由调用方注入（面板里是 page.call fetchAudioRange）。
export async function fetchRangeBytes(fetcher, url, start, end) {
  const r = await fetcher(url, start, end);
  if (!r || !r.ok) return null;
  if (r.bytes) return r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes);
  if (r.base64) {
    const bin = atob(r.base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  return null;
}

// 组装「原始 AAC 音轨」。返回 { ok, slices, meta } 或 { ok:false, reason }。
//
// 每片都是一个独立可上传的 fMP4（init + 该片分片）。
// onProgress(percent, detail) 用于进度显示。
export async function assembleOriginalAac(candidate, opts = {}) {
  const fetcher = opts.fetcher;
  const signal = opts.signal;
  const targetSeconds = Math.max(30, Number(opts.targetSeconds) || 300);
  const maxBytes = Math.max(1, Number(opts.maxBytesMB) || 50) * 1024 * 1024;
  if (typeof fetcher !== 'function') return { ok: false, reason: '缺少 fetcher' };
  const url = candidate && candidate.url;
  if (!url) return { ok: false, reason: '没有音轨地址' };
  const init = parseByteRange(candidate.initRange);
  const index = parseByteRange(candidate.indexRange);
  if (!init || !index) return { ok: false, reason: '该音轨没有 SegmentBase 索引（无法按字节切片）' };

  try {
    if (signal && signal.aborted) return { ok: false, reason: '已终止' };
    const initBuf = await fetchRangeBytes(fetcher, url, init.start, init.end);
    if (!initBuf || !initBuf.length) return { ok: false, reason: 'init 段下载失败' };
    const tag = String.fromCharCode(initBuf[4], initBuf[5], initBuf[6], initBuf[7]);
    if (tag !== 'ftyp') return { ok: false, reason: `init 段不是 fMP4（头部 ${tag}）` };

    const idxBuf = await fetchRangeBytes(fetcher, url, index.start, index.end);
    if (!idxBuf || !idxBuf.length) return { ok: false, reason: 'sidx 索引下载失败' };
    // ★ 必须把「index 段在文件里的起点」传进去，否则分片偏移会整体偏移
    //   （B 站的 indexRange 从 init 之后开始，不是 0）
    const sidx = parseSidx(idxBuf, { baseOffset: index.start });
    if (!sidx || !sidx.segments.length) return { ok: false, reason: 'sidx 索引解析不出分片' };

    // 分片 offset 是相对整个资源的，直接可用
    let effTarget = targetSeconds;
    let slices = groupSegmentsIntoSlices(sidx, initBuf.length, effTarget);
    if (!slices.length) return { ok: false, reason: '索引里没有有效分片' };
    // 单片超限 → 逐步减半切片时长重排（最多 4 次），直到每片都在上限内
    for (let guard = 0; guard < 4 && slices.some((s) => s.bytes > maxBytes); guard += 1) {
      effTarget = effTarget / 2;
      if (effTarget < 20) break;
      slices = groupSegmentsIntoSlices(sidx, initBuf.length, effTarget);
    }
    if (slices.some((s) => s.bytes > maxBytes)) {
      return { ok: false, reason: `即使切成 ${Math.round(effTarget)} 秒，单片仍超过平台上限` };
    }

    const totalDur = sidx.segments.reduce((a, s) => a + s.dur, 0) / sidx.timescale;
    const totalBytes = initBuf.length + idxBuf.length + sidx.segments.reduce((a, s) => a + s.size, 0);
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

    // 逐片下载并拼接（保持分片顺序，绝不重排 —— 顺序错了音频就废了）
    const out = [];
    for (let i = 0; i < slices.length; i += 1) {
      if (signal && signal.aborted) return { ok: false, reason: '已终止' };
      const sl = slices[i];
      const parts = [initBuf];
      for (const s of sl.parts) {
        const b = await fetchRangeBytes(fetcher, url, s.offset, s.offset + s.size - 1);
        if (!b || b.length !== s.size) return { ok: false, reason: `第 ${i + 1} 片有一段下载不完整` };
        parts.push(b);
      }
      const total = parts.reduce((a, p) => a + p.length, 0);
      const buf = new Uint8Array(total);
      let o = 0;
      for (const p of parts) {
        buf.set(p, o);
        o += p.length;
      }
      out.push({ bytes: buf, from: sl.from, to: sl.to, segCount: sl.segCount });
      if (onProgress) onProgress(((i + 1) / slices.length) * 100, `第 ${i + 1}/${slices.length} 片`);
    }

    return {
      ok: true,
      slices: out,
      meta: {
        codecs: candidate.codecs || '',
        bandwidth: candidate.bandwidth || 0,
        timescale: sidx.timescale,
        segCount: sidx.segments.length,
        duration: totalDur,
        totalBytes,
        // 与 WAV 的体积对比，便于在日志里直观说明省了多少
        wavBytes: Math.round(totalDur * 16000 * 2),
        sliceCount: out.length,
        sliceSeconds: effTarget
      }
    };
  } catch (err) {
    return { ok: false, reason: (err && err.message) || String(err) };
  }
}
