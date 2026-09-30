// 取「整条 B 站原始音轨」直接上传 —— 不解码、不重编码。
//
// ===========================================================================
// 为什么需要这个模块（长视频转录慢的根因）
// ===========================================================================
//
// 用户问：为什么视频一长，转录速度就急转直下？
//   1 小时多的视频 → 2 分多钟
//   2 小时的视频   → 10 分钟还没出来
//
// 根因是 **MediaRecorder 只能实时编码**：
//   `encodeSliceToM4a` 里 `timer = setTimeout(..., len/rate*1000)`，
//   也就是说「编 600 秒的音频，就要实打实等 600 秒」。
//   而编码池宽度只有 2（MediaRecorder 走音频实时时钟，开宽了互相拖慢），
//   于是整条音轨的编码墙钟时间 ≈ **音频时长 ÷ 2**。
//
//   130 分钟的视频 → 仅编码就需要 **65 分钟**；84 分钟 → 42 分钟。
//   识别（并发 4）其实只要几分钟，**编码成了唯一随时间线性增长的瓶颈**。
//   时长越长，这个瓶颈占比越高 —— 所以「越长的视频越是慢得离谱」。
//
// 解法：**根本不必编码**。
//   B 站给的 dash 音轨本身就是一个**完整的 MP4/AAC**（ftyp + moov +
//   moof/mdat），大小约 **41kbps × 时长**：
//       974 秒的曲子 → 4.77MB
//       130 分钟     → 约 10MB
//   它可以直接作为 mp4 上传给「接受 M4A 的模型」。
//   于是解码、重编码、切片全部省掉：
//       耗时 ≈ 下载时间（几十秒）
//       内存 ≈ 10MB（而不是解码路径的 5GB 级）
//
// 与上一轮被撤回的「sidx 切片」不同：
//   那条路要去解析出每个分片的字节范围，我**没能验证正确**（拼出来的音频
//   可能是坏的），所以撤回了。
//   这条路**完全不做字节范围推导** —— 就是「把整条音轨从头取到尾」，
//   取回来的东西与浏览器播的是同一份，天然正确。
//
// 唯一代价：下载量比"只取需要的分片"大（整条 vs 部分）。
//   但对 M4A 平台而言这仍然远优于「下载 + 解码 + 实时重编码」。

const M4A_MIME_PREFIX = 'audio/mp4';

// 粗估整条音轨的字节数。带宽单位是 bps。
export function estimateWholeAudioBytes(candidate, durationSeconds) {
  const bw = Number(candidate && candidate.bandwidth) || 0;
  const sec = Number(durationSeconds) || 0;
  if (!bw || !sec) return 0;
  return Math.ceil((bw / 8) * sec);
}

// 校验这确实是一个可上传的 MP4/AAC。
//
// 只看「容器头 + 有没有 moov + 有没有 mp4a」这几件**必然成立**的事，
// 不做任何需要解码才能确认的判断 —— 上一轮的教训就是
// 「容器看起来对」不等于「内容对」，所以这里也**不声称**内容正确，
// 只确认它是浏览器能播、服务端能收的那种文件。
export function looksLikePlayableMp4(bytes) {
  if (!bytes || bytes.length < 1024) return { ok: false, reason: 'too-small' };
  const tag = (o) => String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
  if (tag(0) !== 'ftyp') return { ok: false, reason: 'no-ftyp' };
  // 前 1MB 里找 moov 与 mp4a（moov 通常在文件头部）
  const head = bytes.subarray(0, Math.min(bytes.length, 1024 * 1024));
  const find = (s) => {
    const code = s.split('').map((c) => c.charCodeAt(0));
    outer: for (let i = 0; i + code.length <= head.length; i += 1) {
      for (let k = 0; k < code.length; k += 1) if (head[i + k] !== code[k]) continue outer;
      return true;
    }
    return false;
  };
  if (!find('moov')) return { ok: false, reason: 'no-moov' };
  if (!find('mp4a')) return { ok: false, reason: 'no-mp4a' };
  return { ok: true };
}

/**
 * 取整条原始音轨。
 *
 * @param {object} candidate  音轨候选（含 url）
 * @param {object} opts
 *   fetcher(url, start?, end?) -> { ok, bytes, status, reason }  （不传 start/end 即整条）
 *   signal
 *   durationSeconds  用于粗估大小，避免明知超限还去下
 *   maxBytesMB       超过就不下（返回 oversized）
 *   onProgress(pct, detail)
 * @returns {{ok:true, bytes:Uint8Array, meta:object} | {ok:false, reason:string, ...}}
 */
export async function fetchWholeAudio(candidate, opts = {}) {
  const { fetcher, signal, durationSeconds, onProgress } = opts;
  const maxBytes = (Number(opts.maxBytesMB) || 50) * 1024 * 1024;
  const url = candidate && candidate.url;
  if (!url) return { ok: false, reason: 'no-url' };
  if (!candidate.codecs || !/^mp4a/.test(String(candidate.codecs))) {
    // 不是 AAC-in-MP4 就交给原来的解码路径处理，别在这里硬来
    if (opts.onLog) opts.onLog(`整条音轨直传不可用：音轨 codec 是 ${candidate.codecs || '未知'}，不是 mp4a`);
    return { ok: false, reason: 'not-aac' };
  }

  const estimated = estimateWholeAudioBytes(candidate, durationSeconds);
  if (estimated && estimated > maxBytes) {
    return { ok: false, reason: 'oversized', estimated };
  }

  if (onProgress) onProgress(5, '正在下载整条原始音轨');
  let res;
  try {
    // 不传 start/end → 页面侧发不带 Range 的请求，拿整条
    res = await fetcher(url, undefined, undefined);
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    return { ok: false, reason: 'network', message: String((err && err.message) || err) };
  }
  if (!res || !res.ok || !res.bytes || !res.bytes.length) {
    return { ok: false, reason: (res && res.reason) || 'fetch-failed', status: res && res.status };
  }
  const bytes = res.bytes instanceof Uint8Array ? res.bytes : new Uint8Array(res.bytes);
  if (bytes.length > maxBytes) {
    return { ok: false, reason: 'oversized-actual', size: bytes.length };
  }
  const check = looksLikePlayableMp4(bytes);
  if (!check.ok) {
    return { ok: false, reason: `invalid-container:${check.reason}`, size: bytes.length };
  }
  if (onProgress) onProgress(100, '整条音轨已就绪');
  return {
    ok: true,
    bytes,
    // 直传时不需要切片循环
    meta: {
      transport: 'original-audio-whole',
      bytes: bytes.length,
      codecs: candidate.codecs,
      bandwidth: candidate.bandwidth || 0,
      mimeType: M4A_MIME_PREFIX,
      duration: Number(durationSeconds) || 0
    }
  };
}
