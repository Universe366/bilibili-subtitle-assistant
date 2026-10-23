// 音轨下载 / 解码 / 重采样 / 切片 / WAV 编码（2.2）
// 解码在主页面（侧边栏）完成：这里能用 WebAudio 与 MediaSource。
// 下载经后台 `audio.range` 代理到**页面主环境**（Referer 由浏览器自动带）；
// 只有页面不可用（没有 B 站标签页）时才退回后台请求。这里只做编排。

import { call } from './bridge.js';
import { ASR_LIMITS } from '../../shared/constants.js';

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    const e = new Error('已终止');
    e.name = 'AbortError';
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 下载（分块 + 进度）
// ---------------------------------------------------------------------------

export class AudioDownloader {
  constructor({ pageUrl, url }) {
    this.pageUrl = pageUrl;
    this.url = url;
    this.signal = null;
  }

  abort() {
    if (this.signal) this.signal.aborted = true;
  }

  // 取一段字节；后台会把「防盗链拦截」抛成 audio-forbidden 错误，这里统一判失败
  async fetchRange(start, end) {
    const res = await call('audio.range', { url: this.url, pageUrl: this.pageUrl, start, end }, { timeoutMs: 180000 });
    if (!res || res.ok === false) {
      const e = new Error((res && res.title) || '音轨分块下载失败');
      e.payload = (res && res.error) || { kind: 'download', title: '音轨分块下载失败', detail: '' };
      throw e;
    }
    if (!res.byteLength) return { byteLength: 0, bytes: new Uint8Array(0), contentType: res.contentType || null, contentRange: res.contentRange || null };
    return {
      byteLength: res.byteLength,
      bytes: base64ToBytes(res.base64),
      contentType: res.contentType || null,
      contentRange: res.contentRange || null
    };
  }

  // 返回 { bytes: Uint8Array, totalBytes, contentType, durationSeconds }
  async download({ onProgress, signal, durationHint = 0 } = {}) {
    this.signal = signal || { aborted: false };
    // 探测总长度：页面侧 1 字节 Range 顺带验证防盗链是否放行
    let head = {};
    try {
      head = await call('audio.head', { url: this.url, pageUrl: this.pageUrl }, { timeoutMs: 40000 });
    } catch (err) {
      head = {};
    }
    if (head && head.failed) {
      const e = new Error('音轨探测被拒绝');
      e.payload = {
        kind: 'audio-forbidden',
        title: `音轨请求被拒绝（HTTP ${head.status || 403}）`,
        detail: '音轨 CDN 拒绝了这次请求，通常是地址过期或防盗链。',
        action: '会自动尝试刷新音轨地址与切换节点。',
        status: head.status || 403
      };
      throw e;
    }
    const total = Number.isFinite(head.totalBytes) && head.totalBytes > 0 ? head.totalBytes : 0;
    const CHUNK = 384 * 1024;
    const parts = [];
    let received = 0;
    if (!total) {
      // 无法得知总长度：逐块拉到空为止
      let start = 0;
      for (;;) {
        throwIfAborted(this.signal);
        const res = await this.fetchRange(start, start + CHUNK - 1);
        if (!res.byteLength) break;
        parts.push(res.bytes);
        received += res.byteLength;
        start += res.byteLength;
        if (onProgress) onProgress({ received, total: 0, percent: 0 });
        if (res.byteLength < CHUNK) break;
      }
    } else {
      for (let start = 0; start < total; start += CHUNK) {
        throwIfAborted(this.signal);
        const end = Math.min(total - 1, start + CHUNK - 1);
        const res = await this.fetchRange(start, end);
        parts.push(res.bytes);
        received += res.byteLength;
        if (onProgress) onProgress({ received, total, percent: Math.min(100, (received / total) * 100) });
        if (res.byteLength <= 0) break;
      }
    }
    const bytes = new Uint8Array(received);
    let off = 0;
    for (const p of parts) {
      bytes.set(p, off);
      off += p.length;
    }
    return { bytes, totalBytes: total || received, contentType: head.contentType, durationHint };
  }
}

// ---------------------------------------------------------------------------
// 解码
// ---------------------------------------------------------------------------

export async function decodeAudioBytes(bytes, opts = {}) {
  const { onProgress, signal, codecs = '' } = opts;
  const raw = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const probe = new AudioContext();
  try {
    if (onProgress) onProgress({ stage: 'decode', percent: 20 });
    const buf = await probe.decodeAudioData(raw);
    if (onProgress) onProgress({ stage: 'decode', percent: 100 });
    return buf;
  } catch (err) {
    // 分片 MP4 有时无法整体解码：退化为 MediaSource + 实时采集
    if (onProgress) {
      onProgress({
        stage: 'decode',
        percent: 5,
        note: `整体解码失败（${(err && err.name) || 'Error'}），改用流式采集`
      });
    }
    return await decodeViaMediaSource(bytes, { ...opts, codecs });
  } finally {
    try {
      await probe.close();
    } catch (err) {
      /* ignore */
    }
  }
}

async function decodeViaMediaSource(bytes, { onProgress, signal, speed = 4, codecs = '' } = {}) {
  throwIfAborted(signal);
  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  const CHUNKS = [];
  let totalFrames = 0;
  const CHUNK_FRAMES = 16384;

  const gain = audioCtx.createGain();
  gain.gain.value = 1;
  const collector = audioCtx.createScriptProcessor(CHUNK_FRAMES, 2, 2);
  collector.onaudioprocess = (ev) => {
    const inBuf = ev.inputBuffer;
    const n = inBuf.length;
    const ch0 = inBuf.getChannelData(0);
    const ch1 = inBuf.numberOfChannels > 1 ? inBuf.getChannelData(1) : ch0;
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    L.set(ch0);
    R.set(ch1);
    CHUNKS.push({ L, R });
    totalFrames += n;
  };
  collector.connect(audioCtx.destination);
  const silent = audioCtx.createGain();
  silent.gain.value = 0;
  silent.connect(audioCtx.destination);

  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(el);

  const ms = new MediaSource();
  el.src = URL.createObjectURL(ms);
  const cleanup = () => {
    collector.onaudioprocess = null;
    try {
      collector.disconnect();
    } catch (err) {
      /* ignore */
    }
    try {
      silent.disconnect();
    } catch (err) {
      /* ignore */
    }
    try {
      el.pause();
    } catch (err) {
      /* ignore */
    }
    try {
      el.removeAttribute('src');
      el.load();
    } catch (err) {
      /* ignore */
    }
    try {
      el.remove();
    } catch (err) {
      /* ignore */
    }
    try {
      URL.revokeObjectURL(el.src);
    } catch (err) {
      /* ignore */
    }
    try {
      audioCtx.close();
    } catch (err) {
      /* ignore */
    }
  };

  try {
    await new Promise((resolve, reject) => {
      ms.addEventListener('sourceopen', () => resolve(), { once: true });
      ms.addEventListener('error', () => reject(new Error('MediaSource 打开失败')), { once: true });
      setTimeout(() => reject(new Error('MediaSource 超时')), 8000);
    });

    // 用**实际音轨的 codec** 建 SourceBuffer。
    //
    // 以前硬编码 'audio/mp4; codecs="mp4a.40.2"' —— 而 B 站相当一部分
    // 音轨是 HE-AAC（`mp4a.40.5`）。codec 对不上时 MediaSource 会在
    // appendBuffer 时报错，表现为「音频数据追加失败」，
    // 而且这个报错完全看不出真因（用户 2 小时的视频就撞在这里）。
    const candidates = [];
    if (codecs) candidates.push(`audio/mp4; codecs="${codecs}"`);
    candidates.push('audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="mp4a.40.5"', 'audio/mp4');
    let sb = null;
    let sbError = null;
    for (const mime of candidates) {
      if (typeof MediaSource.isTypeSupported === 'function' && !MediaSource.isTypeSupported(mime) && mime !== 'audio/mp4') {
        continue;
      }
      try {
        sb = ms.addSourceBuffer(mime);
        if (onProgress) onProgress({ stage: 'decode', percent: 8, note: `流式解码：${codecs || mime}` });
        break;
      } catch (err) {
        sbError = err;
      }
    }
    if (!sb) {
      throw new Error(`找不到可用的音频解码格式（音轨 codec=${codecs || '未知'}）：${(sbError && sbError.message) || ''}`);
    }
    const append = (data) =>
      new Promise((resolve, reject) => {
        let settled = false;
        const done = (err) => {
          if (settled) return;
          settled = true;
          sb.removeEventListener('updateend', onEnd);
          sb.removeEventListener('error', onErr);
          err ? reject(err) : resolve();
        };
        const onEnd = () => done(null);
        const onErr = () => {
          // 把 MediaSource 的真实原因带出来。
          // 以前只抛「音频数据追加失败」，完全看不出是 codec 不匹配、
          // 还是配额不足 —— 排查时等于没有信息。
          const err = sb.error || ms.error || null;
          const detail = err ? `${err.name || 'MediaError'}: ${err.message || ''}` : '';
          const quota = /quota|QuotaExceeded/i.test(detail);
          done(
            new Error(
              `音频数据追加失败${detail ? `（${detail}）` : ''}` +
                (quota ? ' —— SourceBuffer 配额不足，音频过大' : '') +
                `；音轨 codec=${codecs || '未知'}，本次追加 ${(data.byteLength / 1024 / 1024).toFixed(1)}MB`
            )
          );
        };
        sb.addEventListener('updateend', onEnd);
        sb.addEventListener('error', onErr);
        try {
          sb.appendBuffer(data);
        } catch (err) {
          onErr();
        }
      });

    // 分块追加：一次塞 60MB 容易撞 SourceBuffer 配额，
    // 分成 4MB 的小块逐段追加（等 updateend 再下一块）。
    const APPEND_CHUNK = 4 * 1024 * 1024;
    const appendAll = async (buf) => {
      if (buf.byteLength <= APPEND_CHUNK) {
        await append(buf);
        return;
      }
      for (let off = 0; off < buf.byteLength; off += APPEND_CHUNK) {
        throwIfAborted(signal);
        // 配额紧张时等 SourceBuffer 被消费掉一部分再继续。
        // buffered 为空时 end() 会抛错，所以整段都要护住。
        let guard = 0;
        for (;;) {
          let behind = 0;
          try {
            if (sb.buffered.length) {
              behind = sb.buffered.end(sb.buffered.length - 1) - (el.currentTime || 0);
            }
          } catch (err) {
            behind = 0;
          }
          if (!(behind > 60) || guard >= 200) break;
          guard += 1;
          await new Promise((r) => setTimeout(r, 150));
        }
        await append(buf.slice(off, Math.min(buf.byteLength, off + APPEND_CHUNK)));
      }
    };

    // init 段（moov）优先；没有就整段试
    if (bytes.length > 8 && String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === 'ftyp') {
      await append(bytes.buffer.slice(0, Math.min(bytes.length, 2 * 1024 * 1024)));
    }
    await appendAll(bytes.buffer.slice(0));

    if (onProgress) onProgress({ stage: 'playcapture', percent: 0 });

    try {
      ms.duration = isFinite(el.duration) && el.duration > 0 ? el.duration : 1e6;
    } catch (err) {
      /* ignore */
    }

    await el.play().catch(() => {});
    try {
      el.playbackRate = Math.min(16, Math.max(1, speed));
    } catch (err) {
      /* ignore */
    }

    const stream = el.captureStream ? el.captureStream() : el.mozCaptureStream ? el.mozCaptureStream() : null;
    if (!stream) throw new Error('当前浏览器不支持 captureStream');
    const srcNode = audioCtx.createMediaStreamSource(stream);
    srcNode.connect(collector);
    collector.connect(dest);

    const started = Date.now();
    const total = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
    let lastReport = 0;
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (signal && signal.aborted) {
          clearInterval(timer);
          resolve();
          return;
        }
        const t = el.currentTime || 0;
        const pct = total ? Math.min(99, (t / total) * 100) : 0;
        if (Date.now() - lastReport > 400) {
          lastReport = Date.now();
          if (onProgress) onProgress({ stage: 'playcapture', percent: pct, currentTime: t, duration: total });
        }
        if (el.ended || (total && t >= total - 0.05)) {
          clearInterval(timer);
          resolve();
        }
        if (Date.now() - started > 1000 * 60 * 90) {
          // 硬上限，避免永久卡住
          clearInterval(timer);
          resolve();
        }
      }, 120);
    });

    if (totalFrames === 0) throw new Error('没有采集到音频数据');

    const rate = 48000;
    const out = audioCtx.createBuffer(1, totalFrames, rate);
    const dst = out.getChannelData(0);
    let off = 0;
    for (const c of CHUNKS) {
      for (let i = 0; i < c.L.length; i += 1) {
        dst[off + i] = 0.5 * (c.L[i] + c.R[i]);
      }
      off += c.L.length;
    }
    if (onProgress) onProgress({ stage: 'playcapture', percent: 100 });
    return out;
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// 重采样为单声道 16 kHz
// ---------------------------------------------------------------------------

export async function toMono16k(audioBuffer, opts = {}) {
  const { onProgress } = opts;
  const target = ASR_LIMITS.targetRate;
  const seconds = audioBuffer.duration;
  if (onProgress) onProgress({ stage: 'resample', percent: 0 });

  // 内存优化（关键）：**不要再单独复制一份 mono**。
  //
  // 以前的写法：
  //   const mono = mixToMono(audioBuffer);            // ← 1318MB（2 小时）
  //   const tmp = off.createBuffer(...); tmp.copyToChannel(mono, 0);  // ← 又 1318MB
  // 加上解码后的 2637MB，光重采样阶段就 5GB 以上。
  //
  // 现在把「混单声道」直接写进 OfflineAudioContext 的输入缓冲，
  // 省掉中间那份 mono —— 2 小时视频少占约 1.3GB。
  if (typeof OfflineAudioContext === 'function') {
    try {
      const length = Math.max(1, Math.ceil(seconds * target));
      const off = new OfflineAudioContext(1, length, target);
      const src = off.createBufferSource();
      const tmp = off.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate);
      mixToMonoInto(audioBuffer, tmp.getChannelData(0));
      src.buffer = tmp;
      src.connect(off.destination);
      src.start();
      const rendered = await off.startRendering();
      if (onProgress) onProgress({ stage: 'resample', percent: 100 });
      return { samples: rendered.getChannelData(0), rate: target };
    } catch (err) {
      /* 落到手写重采样 */
    }
  }
  // 手写重采样兜底（此时才需要一份 mono）
  const mono = audioBuffer.numberOfChannels > 1 ? mixToMono(audioBuffer) : audioBuffer.getChannelData(0);
  const ratio = audioBuffer.sampleRate / target;
  const outLen = Math.max(1, Math.floor(mono.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(mono.length - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
  }
  if (onProgress) onProgress({ stage: 'resample', percent: 100 });
  return { samples: out, rate: target };
}

function mixToMono(audioBuffer) {
  const out = new Float32Array(audioBuffer.length);
  mixToMonoInto(audioBuffer, out);
  return out;
}

// 把多声道混成单声道写入**已有的**目标数组（不额外分配）
function mixToMonoInto(audioBuffer, dst) {
  const n = audioBuffer.length;
  const chs = Math.min(2, audioBuffer.numberOfChannels);
  if (chs <= 1) {
    dst.set(audioBuffer.getChannelData(0));
    return;
  }
  const a = audioBuffer.getChannelData(0);
  const b = audioBuffer.getChannelData(1);
  for (let i = 0; i < n; i += 1) dst[i] = (a[i] + b[i]) / 2;
}

// ---------------------------------------------------------------------------
// 切片 + WAV 编码（按平台文件大小上限自适应，2.2）
// ---------------------------------------------------------------------------

export function estimateWavBytes(seconds, rate = ASR_LIMITS.targetRate) {
  return Math.ceil(seconds * rate) * 2 + 44;
}

export function computeSliceSeconds({ sizeLimitMB, durationSeconds }) {
  const limitBytes = Math.max(1, sizeLimitMB) * 1024 * 1024;
  const perSecond = ASR_LIMITS.targetRate * 2;
  // 留安全余量（对齐 Bilitato 的 ASR_CHUNK_SIZE_SAFETY_RATIO = 0.72）：
  // 编码后的容器体积与码率会有浮动，按 100% 估容易踩上限。
  const safety = Number(ASR_LIMITS.sizeSafetyRatio) || 0.72;
  const maxSeconds = Math.floor((limitBytes * safety) / perSecond);
  let sec = Math.min(ASR_LIMITS.maxSliceSeconds, Math.max(ASR_LIMITS.minSliceSeconds, Math.min(maxSeconds, durationSeconds || maxSeconds)));
  if (!Number.isFinite(sec) || sec <= 0) sec = ASR_LIMITS.defaultSliceSeconds;
  return Math.max(ASR_LIMITS.minSliceSeconds, Math.min(ASR_LIMITS.maxSliceSeconds, sec));
}

// 返回分片计划
export function planSlices({ samples, rate, sliceSeconds, overlapSeconds, sizeLimitMB, maxRetries = ASR_LIMITS.maxRetries }) {
  const totalSeconds = samples.length / rate;
  let sec = sliceSeconds;
  let attempt = 0;
  let slices = [];
  for (;;) {
    const step = Math.max(10, sec - overlapSeconds);
    slices = [];
    for (let t = 0; t < totalSeconds; t += step) {
      const end = Math.min(totalSeconds, t + sec);
      slices.push({ start: t, end, seconds: end - t });
      if (end >= totalSeconds - 0.05) break;
    }
    const worst = slices.reduce((m, s) => Math.max(m, estimateWavBytes(s.seconds, rate)), 0);
    const overLimit = worst > sizeLimitMB * 1024 * 1024;
    if (!overLimit || attempt >= maxRetries) break;
    attempt += 1;
    sec = Math.max(ASR_LIMITS.minSliceSeconds * 0.5, sec * ASR_LIMITS.retryFactor);
  }
  return { slices, sliceSeconds: sec, attempts: attempt, totalSeconds, rate };
}

export function sliceToWav(samples, rate, start, end) {
  const s0 = Math.max(0, Math.floor(start * rate));
  const s1 = Math.min(samples.length, Math.ceil(end * rate));
  const len = Math.max(0, s1 - s0);
  const dataSize = len * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = s0; i < s1; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    off += 2;
  }
  return new Uint8Array(buf);
}

// ---------------------------------------------------------------------------
// M4A（MP4/AAC）编码
//
// 为什么需要它：有的平台（硅基流动）对 WAV 直接返回 500 —— 服务端解码崩了，
// 而参数校验是过的（所以不报 400）。参考实现 Bilitato 上传的就是 .m4a：
// 它用 FFmpeg 的 `-c:a copy` 复用原始 AAC 流。
//
// 浏览器里没有能用的 AAC 编码器（此版本 Chrome 的 WebCodecs
// AudioEncoder 不支持 mp4a.40.2），但 **MediaRecorder 支持
// `audio/mp4;codecs=mp4a.40.2`**。代价是 MediaRecorder 以**实时**速度工作：
// 一段 N 秒的音频需要约 N 秒编码完（实测 12s 音频 → 12.5s，产出合法 MP4）。
// 因此这里按「较短切片」逐片编码，并在开始前如实告知预计耗时。
// ---------------------------------------------------------------------------

export const M4A_MIME = 'audio/mp4;codecs=mp4a.40.2';

export function canEncodeM4a() {
  try {
    return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(M4A_MIME);
  } catch (err) {
    return false;
  }
}

// 把一段 PCM 编成 MP4/AAC。返回 Uint8Array。
// 注意：这是实时编码，耗时可与音频时长同量级。
export function encodeSliceToM4a(samples, rate, start, end, opts = {}) {
  const signal = opts.signal;
  const s0 = Math.max(0, Math.floor(start * rate));
  const s1 = Math.min(samples.length, Math.ceil(end * rate));
  const len = Math.max(0, s1 - s0);
  if (!len) return Promise.resolve(null);
  if (!canEncodeM4a()) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    let ctx = null;
    let rec = null;
    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try {
        if (rec && rec.state !== 'inactive') rec.stop();
      } catch (err) {
        /* ignore */
      }
      try {
        if (ctx && ctx.close) ctx.close();
      } catch (err) {
        /* ignore */
      }
    };
    const fail = (err) => {
      cleanup();
      reject(err);
    };
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return resolve(null);
      ctx = new Ctx();
      const buf = ctx.createBuffer(1, len, rate);
      const ch = buf.getChannelData(0);
      ch.set(samples.subarray(s0, s1));
      const dest = ctx.createMediaStreamDestination();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      rec = new MediaRecorder(dest.stream, { mimeType: M4A_MIME, audioBitsPerSecond: opts.bitrate || 32000 });
      const parts = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) parts.push(e.data);
      };
      rec.onerror = (e) => fail(new Error(`M4A 编码失败：${(e.error && e.error.name) || 'unknown'}`));
      rec.onstop = async () => {
        try {
          if (signal && signal.aborted) {
            cleanup();
            const e = new Error('已终止');
            e.name = 'AbortError';
            return reject(e);
          }
          const blob = new Blob(parts, { type: 'audio/mp4' });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          cleanup();
          // 校验确实是 MP4：偏移 4 处应有 'ftyp'
          const tag = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
          if (bytes.length < 1000 || tag !== 'ftyp') {
            return resolve(null);
          }
          resolve(bytes);
        } catch (err) {
          fail(err);
        }
      };
      // 中止支持
      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            fail(Object.assign(new Error('已终止'), { name: 'AbortError' }));
          },
          { once: true }
        );
      }
      rec.start(250);
      src.start();
      const durationMs = (len / rate) * 1000;
      // 留一点余量让最后一片数据出来
      timer = setTimeout(() => {
        try {
          if (rec && rec.state !== 'inactive') rec.stop();
        } catch (err) {
          fail(err);
        }
      }, durationMs + 350);
    } catch (err) {
      fail(err);
    }
  });
}



// ---------------------------------------------------------------------------
// 文本去重（无时间戳结果也能重叠去重，2.2）
// ---------------------------------------------------------------------------

export function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s\u3000]/g, '')
    .replace(/[，。！？、；：""''（）《》【】,.!?;:"'()<>\[\]…—\-~·`]/g, '');
}

// 在 prev 尾部与 next 头部之间寻找最长重叠，返回需要追加的新文本。
export function dedupeAppend(prev, next, minOverlap = 6) {
  const a = normalizeForMatch(prev);
  const b = normalizeForMatch(next);
  if (!b) return { append: '', overlap: 0 };
  if (!a) return { append: next, overlap: 0 };
  const maxTry = Math.min(a.length, b.length, 600);
  let best = 0;
  for (let len = maxTry; len >= minOverlap; len -= 1) {
    const tail = a.slice(a.length - len);
    const head = b.slice(0, len);
    if (tail === head) {
      best = len;
      break;
    }
  }
  if (!best) return { append: next, overlap: 0 };
  // 把归一化后的重叠长度映射回原始 next 的字符位置
  let count = 0;
  let idx = 0;
  for (; idx < next.length; idx += 1) {
    if (normalizeForMatch(next[idx]).length) count += normalizeForMatch(next[idx]).length;
    if (count >= best) {
      idx += 1;
      break;
    }
  }
  const appendRaw = next.slice(idx);
  return { append: appendRaw.replace(/^[\s，。、；：,.]+/, ''), overlap: best };
}

// 无时间戳时按标点切分并按约 80 字合并成行
export function segmentPlainText(text, opts = {}) {
  const maxLen = opts.maxLen || 80;
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const pieces = clean.split(/(?<=[。！？!?；;])/g).map((s) => s.trim()).filter(Boolean);
  const out = [];
  let cur = '';
  for (const p of pieces) {
    if (!cur) cur = p;
    else if (cur.length + p.length <= maxLen) cur += p;
    else {
      out.push(cur);
      cur = p;
    }
    // 超长句按逗号再拆
    while (cur.length > maxLen * 2) {
      const cut = Math.max(cur.lastIndexOf('，', maxLen), cur.lastIndexOf(',', maxLen));
      if (cut <= 0) break;
      out.push(cur.slice(0, cut + 1));
      cur = cur.slice(cut + 1);
    }
  }
  if (cur) out.push(cur);
  return out;
}
