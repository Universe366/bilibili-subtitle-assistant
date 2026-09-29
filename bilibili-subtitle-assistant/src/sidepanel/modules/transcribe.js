// 语音转录（2.2）：获取音轨 → 分块下载 → 解码 → 单声道 16 kHz → 重叠切片 →
// 逐片识别 → 合并去重。支持终止、超时、并发可配置、按平台上限自适应分片。

import { call, backgroundVersion } from './bridge.js';
import { ASR_LIMITS, CONTENT_VERSION } from '../../shared/constants.js';
// 重试判定与后台共用同一份策略
import { isRetriableAsrError } from '../../background/providers.js';
import {
  AudioDownloader,
  decodeAudioBytes,
  toMono16k,
  planSlices,
  sliceToWav,
  dedupeAppend,
  segmentPlainText,
  estimateWavBytes,
  canEncodeM4a,
  encodeSliceToM4a
} from './audio.js';

// 上传格式按**模型**决定，这一点已用真实 API 实测确认：
//   FunAudioLLM/SenseVoiceSmall   + M4A → 200 ；WAV → 500
//   XingChenAGI/XingChenGSR-V1.0  + WAV → 200 ；M4A → 400
// 所以绝不能按「平台」一刀切 —— 同一个平台的不同模型要求完全不同。
const WAV_ONLY_MODEL = /xingchen|gsr|teleai|telespeech/i;
const M4A_MODEL = /sensevoice/i;
// 实测只有它返回时间段（segments 带 start/end）。其余模型只给纯文本，
// 字幕时间只能靠估算 —— 必须提前告诉用户，并给出改用的建议。
const TIMESTAMP_MODEL = /diarize/i;

// 返回 'm4a' | 'wav'
export function audioFormatFor(platform) {
  const fmt = String((platform && platform.audioFormat) || '').toLowerCase();
  const model = String((platform && platform.model) || '');
  const host = String((platform && platform.baseUrl) || '').toLowerCase();
  const id = String((platform && platform.id) || '').toLowerCase();
  const wavOnly = WAV_ONLY_MODEL.test(model);

  // 1) 用户显式指定优先，但 WAV-only 模型必须压过「平台默认的 m4a」，
  //    否则选了 XingChenGSR 又会退回去发 M4A（实测会 400）。
  if (fmt === 'wav') return 'wav';
  if (fmt === 'm4a') return wavOnly ? 'wav' : 'm4a';

  // 2) 未显式指定时按**模型**判断（比按平台更具体）
  if (wavOnly) return 'wav';
  if (M4A_MODEL.test(model)) return 'm4a';

  // 3) 最后才按平台默认：硅基流动默认模型是 SenseVoice，走 M4A
  if (id === 'siliconflow' || host.includes('siliconflow')) return 'm4a';
  return 'wav';
}

function prefersM4a(platform) {
  return audioFormatFor(platform) === 'm4a';
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    const e = new Error('已终止');
    e.name = 'AbortError';
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 并发调度（保持结果顺序）
// ---------------------------------------------------------------------------

export async function runPool(items, limit, worker, signal) {
  const results = new Array(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(limit || 1, items.length || 1));
  const runners = [];
  for (let w = 0; w < width; w += 1) {
    runners.push(
      (async () => {
        for (;;) {
          throwIfAborted(signal);
          const idx = cursor;
          cursor += 1;
          if (idx >= items.length) return;
          results[idx] = await worker(items[idx], idx);
        }
      })()
    );
  }
  await Promise.all(runners);
  return results;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

export async function transcribeVideo({ video, settings, hooks = {} }) {
  const { onProgress, onLog, signal } = hooks;
  const asr = settings.asr;
  const platform = (asr.platforms || []).find((p) => p.id === asr.activeId) || null;
  const report = (percent, detail) => {
    if (onProgress) onProgress({ percent, detail });
  };

  // --- 0. 版本自检（关键）---
  // MV3 的 service worker 与面板是两份独立更新的代码：只点「刷新」时，
  // 面板立刻用上新代码，而**旧 SW 可能仍在运行**，于是出现
  // 「日志是新版、发出去的请求却还是旧版行为」这种极难排查的现象。
  // 把两边版本都写进转录日志，一眼即可判断后台是否陈旧。
  if (onLog) {
    try {
      const bgv = await backgroundVersion();
      if (!bgv) {
        onLog(`版本自检：面板 ${CONTENT_VERSION}，后台未响应（service worker 可能未唤醒）`);
      } else if (bgv !== CONTENT_VERSION) {
        onLog(
          `⚠ 版本不一致：面板 ${CONTENT_VERSION}，后台 ${bgv} —— 后台的 service worker 还是旧代码，` +
            `请在 chrome://extensions 里「移除」后重新「加载已解压的扩展程序」。`
        );
      } else {
        onLog(`版本自检：面板与后台均为 ${CONTENT_VERSION}`);
      }
    } catch (err) {
      /* 自检失败不影响主流程 */
    }
  }

  // --- 1. 音轨候选（页面主环境解析，按鲜度与 host 排序） ---
  throwIfAborted(signal);
  report(1, '解析音轨地址');
  let candidates = [];
  let audioDiag = null;
  let audioError = null;
  try {
    const out = await call('audio.candidates', { aid: video.aid, bvid: video.bvid, cid: video.cid }, { timeoutMs: 40000 });
    candidates = (out && out.candidates) || [];
    audioDiag = (out && out.diag) || null;
    audioError = (out && out.diag && out.diag.bridgeError) || null;
    if (onLog) {
      onLog(
        `音轨候选 ${candidates.length} 条${out && out.sniffed ? `（其中 ${out.sniffed} 份来自页面 playurl 嗅探）` : ''}`
      );
    }
  } catch (err) {
    audioError = (err && err.payload) || { title: '解析音轨失败', detail: String(err && err.message) };
    if (onLog) onLog(`解析音轨候选失败：${audioError.title}`);
  }
  if (!candidates.length) {
    const stages = (audioDiag && audioDiag.stages) || [];
    const stageText = stages.length
      ? stages
          .map((s) => {
            if (s.error) return `· ${s.stage}：${s.error}`;
            if (s.ok !== undefined) return `· ${s.stage}：${s.ok ? '成功' : '失败'}${s.code != null ? `（code ${s.code}）` : ''}${s.message ? ` ${s.message}` : ''}，拿到 ${s.count || 0} 条`;
            if (s.count !== undefined) return `· ${s.stage}：${s.count} 条`;
            return `· ${s.stage}：cid=${s.cid || '无'} aid=${s.aid || '无'} bvid=${s.bvid || '无'}`;
          })
          .join('\n')
      : '· 没有拿到页面侧的诊断信息';
    const info = (audioDiag && audioDiag.pageInfo) || {};
    const bridgeBroken = !!(audioError && /主环境不支持|不支持该方法|无法在该页面运行/.test(`${audioError.title || ''} ${audioError.detail || ''}`));
    const err = new Error('没有拿到音轨地址');
    err.payload = {
      kind: 'noaudio',
      title: '没有拿到音轨地址',
      detail: [
        '页面里没有解析出 DASH 音轨。逐项诊断：',
        stageText,
        audioError ? `桥接错误：${audioError.title}${audioError.detail ? ` —— ${audioError.detail}` : ''}` : '',
        `页面状态：播放器实例 ${info.hasPlayer ? '有' : '无'}，cid ${info.cid || '无'}，bvid ${info.bvid || '无'}`,
        `网络嗅探捕获 playurl 响应：${audioDiag && audioDiag.sniffed ? `${audioDiag.sniffed} 份` : '0 份'}`
      ]
        .filter(Boolean)
        .join('\n'),
      action: bridgeBroken
        ? '页面里的注入脚本是旧版本（扩展更新后，**已在页面上运行的脚本不会自动替换**）。请按 F5 刷新这个 B 站页面，然后重新点「语音转录」。'
        : '先在页面上让视频**播放几秒**（让播放器自己去拉 playurl），再点「语音转录」；若仍失败，刷新 B 站页面。'
    };
    throw err;
  }
  // 首选候选：非 mirrorcos 节点 + 带宽较低（体积小）
  const audio = candidates[0];
  let activeUrl = audio.url;
  const pageUrl = video.url;
  if (onLog) {
    const host = (() => {
      try {
        return new URL(activeUrl).host;
      } catch (err) {
        return '未知 host';
      }
    })();
    onLog(`音轨：${audio.mimeType || '未知类型'} 带宽 ${audio.bandwidth || '?'} 来源 ${audio.source} host ${host}`);
  }

  // --- 2. 分块下载（403 时刷新地址 / 换候选重试） ---
  const downloadStart = Date.now();
  let dl = null;
  let lastError = null;
  const tried = new Set();
  const queue = [...candidates];
  for (let attempt = 0; attempt < 4 && queue.length; attempt += 1) {
    throwIfAborted(signal);
    const cand = queue.shift();
    if (!cand || tried.has(cand.url)) continue;
    tried.add(cand.url);
    activeUrl = cand.url;
    try {
      const downloader = new AudioDownloader({ pageUrl, url: activeUrl });
      dl = await downloader.download({
        signal,
        durationHint: video.duration,
        onProgress: (p) => {
          const pct = p.total ? 5 + (p.percent / 100) * 40 : 5;
          report(pct, `已下载 ${(p.received / 1024 / 1024).toFixed(1)}MB${p.total ? ` / ${(p.total / 1024 / 1024).toFixed(1)}MB` : ''}`);
        }
      });
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      const payload = (err && err.payload) || {};
      const isForbidden = payload.kind === 'audio-forbidden' || payload.status === 403;
      if (onLog) {
        onLog(`候选失败（${isForbidden ? '403 防盗链' : payload.title || err.message}）：${cand.source}`);
      }
      if (!isForbidden) throw err;
      // 403：重新解析一份新鲜地址，插到队首重试
      try {
        const refreshed = await call('audio.refresh', { aid: video.aid, bvid: video.bvid, cid: video.cid }, { timeoutMs: 30000 });
        const fresh = (refreshed && refreshed.audio) || [];
        if (fresh.length) {
          const freshList = fresh
            .map((a) => ({
              url: a.base_url || a.url,
              bandwidth: Number(a.bandwidth) || 0,
              mimeType: a.mime_type || '',
              source: 'playurl-refresh',
              initRange: a.init_range || null
            }))
            .filter((a) => a.url && !tried.has(a.url))
            .sort((a, b) => (a.bandwidth || 1e12) - (b.bandwidth || 1e12));
          if (freshList.length) {
            queue.unshift(...freshList);
            if (onLog) onLog(`已刷新音轨地址，新增 ${freshList.length} 条候选`);
          }
        }
      } catch (err2) {
        if (onLog) onLog(`刷新音轨地址失败：${(err2.payload && err2.payload.title) || err2.message}`);
      }
    }
  }
  if (!dl) {
    const payload = (lastError && lastError.payload) || {};
    const err = new Error(payload.title || '音轨下载失败');
    err.payload = {
      kind: payload.kind || 'download',
      title: payload.title || '音轨下载失败',
      detail: `${payload.detail || ''}\n已尝试 ${tried.size} 条音轨候选（含刷新后的新地址），均未成功。`,
      action:
        '请刷新 B 站页面后重试；如果这个视频在网页上能正常播放，说明是音轨 CDN 的防盗链策略，可换用「抓取字幕」或稍后再试。',
      extra: payload
    };
    throw err;
  }
  if (onLog) onLog(`下载完成：${(dl.bytes.length / 1024 / 1024).toFixed(1)}MB，用时 ${((Date.now() - downloadStart) / 1000).toFixed(1)}s`);

  // --- 2.5 平台偏好 M4A 时走「流复制重封装」路径（对齐 Bilitato）---
  //
  // 不再解码 + 重采样 + 用 MediaRecorder 重新编码，而是把原始音轨直接交给
  // FFmpeg 做 `-c:a copy`：编码与 B 站原始 AAC 完全一致，产出**普通 MP4**
  // （moov 在前）而不是 MediaRecorder 必然产生的 fragmented MP4。
  // 同时没有实时编码开销（重封装通常几百毫秒）。
  if (prefersM4a(platform)) {
    let ffmpegOk = false;
    try {
      const ff = await import('./ffmpeg.js');
      ffmpegOk = ff.ffmpegAvailable();
    } catch (err) {
      ffmpegOk = false;
    }
    if (ffmpegOk) {
      const durationSeconds = video.duration || 0;
      if (onLog) {
        onLog(
          `按 M4A 重封装上传（FFmpeg 流复制，不重新编码）。` +
            (durationSeconds ? `音频约 ${Math.round(durationSeconds)} 秒。` : '')
        );
      }
      report(38, '用 FFmpeg 重封装音频（流复制，比实时编码快得多）');
      const { rawResults, base } = await transcribeViaRemux({
        rawBytes: dl.bytes,
        platform,
        sliceSeconds: Number(asr.sliceSeconds) || ASR_LIMITS.defaultSliceSeconds,
        timeoutSeconds: Number(asr.timeoutSeconds) || ASR_LIMITS.defaultTimeoutSeconds,
        durationSeconds,
        hooks: { onLog, onProgress: ({ percent, detail }) => report(percent, detail), signal }
      });
      report(100, '转录完成');
      const out = assembleRemuxOutcome({
        rawResults,
        base,
        platform,
        durationSeconds,
        bytes: dl.bytes.length
      });
      if (onLog && out.meta.missingTimestamps) {
        onLog(
          `⚠ 当前模型「${platform ? platform.model : ''}」不返回时间戳，字幕时间是**按字数估算**的（与视频可能对不齐）。` +
            `如需精确时间轴，请在 设置 → 语音识别 改用 XingChenAGI/XingChenASR-Diarize-V3.0。`
        );
      }
      return out;
    }
    if (onLog) onLog('FFmpeg 不可用，退回「解码 + 重新编码」路径');
  }

  // --- 3. 解码 ---
  throwIfAborted(signal);
  report(46, '解码音频（可能需要一会儿）');
  const decoded = await decodeAudioBytes(dl.bytes, {
    signal,
    onProgress: (p) => {
      if (p.stage === 'decode') report(46 + (p.percent / 100) * 12, p.note || '解码音频');
      if (p.stage === 'playcapture') report(46 + (p.percent / 100) * 12, `流式采集音频 ${Math.round(p.percent)}%`);
    }
  });
  if (onLog) {
    onLog(`解码完成：${decoded.numberOfChannels} 声道 / ${decoded.sampleRate}Hz / ${decoded.duration.toFixed(1)}s`);
  }

  // --- 4. 重采样为单声道 16 kHz ---
  throwIfAborted(signal);
  report(59, '重采样为单声道 16 kHz');
  const { samples, rate } = await toMono16k(decoded, {
    onProgress: (p) => report(59 + (p.percent / 100) * 5, '重采样为单声道 16 kHz')
  });

  // 释放解码缓存
  try {
    decoded.length = 0;
  } catch (err) {
    /* ignore */
  }

  // --- 5. 切片计划（按平台文件大小上限自适应） ---
  const sizeLimitMB = Number(asr.sizeLimitMB) || ASR_LIMITS.defaultSizeLimitMB;
  const totalSeconds = samples.length / rate;
  let sliceSeconds = Number(asr.sliceSeconds) || ASR_LIMITS.defaultSliceSeconds;
  // 每秒字节数 -> 按上限反推每片时长（2.2）
  const computed = Math.floor((sizeLimitMB * 1024 * 1024) / (rate * 2));
  if (computed > 0) sliceSeconds = Math.min(sliceSeconds, computed);
  sliceSeconds = Math.max(ASR_LIMITS.minSliceSeconds, Math.min(ASR_LIMITS.maxSliceSeconds, sliceSeconds));

  let plan = planSlices({
    samples,
    rate,
    sliceSeconds,
    overlapSeconds: Number(asr.overlapSeconds) || ASR_LIMITS.overlapSeconds,
    sizeLimitMB
  });
  if (onLog) {
    onLog(
      `切片计划：${plan.slices.length} 片，每片 ${plan.sliceSeconds.toFixed(0)}s，重叠 ${asr.overlapSeconds || ASR_LIMITS.overlapSeconds}s${
        plan.attempts ? `（因超限重切 ${plan.attempts} 次）` : ''
      }`
    );
  }
  if (!plan.slices.length) {
    const err = new Error('音轨没有可用音频数据');
    err.payload = { kind: 'empty-audio', title: '音轨没有音频数据', detail: '解码后的音轨长度为 0。', action: '请刷新页面后重试。' };
    throw err;
  }

  // --- 6. 逐片识别 ---
  const timeoutSeconds = Number(asr.timeoutSeconds) || ASR_LIMITS.defaultTimeoutSeconds;
  const concurrency = Math.max(1, Math.min(8, Number(asr.concurrency) || 1));

  // 该平台是否偏好 M4A（硅基流动对 WAV 会 500）。MediaRecorder 是实时编码，
  // 因此并发也无济于事（编码走同一批音频上下文），这里如实提示预计额外耗时。
  const wantsM4a = prefersM4a(platform);
  const useM4a = wantsM4a && canEncodeM4a();
  if (wantsM4a) {
    if (useM4a) {
      const totalSeconds = plan.slices.reduce((a, s) => a + (s.end - s.start), 0);
      if (onLog) {
        onLog(
          `该平台按 M4A（MP4/AAC）上传。浏览器只能实时编码，预计额外耗时约 ${Math.ceil(totalSeconds)} 秒（音频共 ${Math.round(
            totalSeconds
          )} 秒）。`
        );
      }
      report(64, `编码 M4A（实时，约需 ${Math.ceil(totalSeconds)} 秒）`);
    } else if (onLog) {
      onLog('该平台偏好 M4A，但当前浏览器不支持编码，退回 WAV 上传（可能被服务端拒绝）');
    }
  }

  report(65, `识别中 0/${plan.slices.length}`);
  let done = 0;
  const mergeAttempts = [];
  // 记录每一片的成败与状态码：用于区分「一开始就不通」和「跑到中途才失败」
  // （后者最常见的原因是账号额度/次数用尽）。
  const sliceOutcomes = [];

  const rawResults = await runPool(
    plan.slices,
    concurrency,
    async (slice, idx) => {
      throwIfAborted(signal);
      const wav = sliceToWav(samples, rate, slice.start, slice.end);
      const bytes = wav.length;
      // 打印一次音频电平：静音或电平极低的音频会让部分 ASR 服务端 500，
      // 有了这个数据就能立刻判断「是不是音频本身没内容」。
      if (idx === 0) {
        let peak = 0;
        let sum = 0;
        let n = 0;
        for (let p = 44; p + 1 < wav.length; p += 2) {
          const v = ((wav[p] | (wav[p + 1] << 8)) << 16) >> 16;
          const a = Math.abs(v) / 32768;
          if (a > peak) peak = a;
          sum += a * a;
          n += 1;
        }
        const rms = n ? Math.sqrt(sum / n) : 0;
        if (onLog) {
          onLog(
            `音频电平：峰值 ${(peak * 100).toFixed(1)}%，RMS ${(rms * 100).toFixed(2)}%${
              peak < 0.001 ? '（⚠ 几乎全是静音，服务端可能因此报错）' : ''
            }`
          );
        }
      }
      if (estimateWavBytes(slice.seconds, rate) > sizeLimitMB * 1024 * 1024) {
        if (onLog) onLog(`第 ${idx + 1} 片仍超过平台上限（${(bytes / 1024 / 1024).toFixed(1)}MB）`);
      }

      // 平台偏好 M4A 时先编码（MediaRecorder 是实时编码，耗时≈音频时长），
      // 编码不可用或失败则退回 WAV。
      let payload = wav;
      let filename = `slice-${String(idx + 1).padStart(3, '0')}.wav`;
      if (useM4a) {
        try {
          const m4a = await encodeSliceToM4a(samples, rate, slice.start, slice.end, { signal });
          if (m4a && m4a.length) {
            payload = m4a;
            filename = `slice-${String(idx + 1).padStart(3, '0')}.m4a`;
          } else if (idx === 0) {
            if (onLog) onLog('M4A 编码不可用，改用 WAV 上传');
          }
        } catch (err) {
          if (err && err.name === 'AbortError') throw err;
          if (idx === 0) onLog(`M4A 编码失败（${(err && err.message) || err}），改用 WAV 上传`);
        }
      }

      // 识别请求由后台代发（侧边栏直接跨域请求会被 CORS 拦），后台负责超时与错误分类。
      if (onLog) {
        onLog(
          `第 ${idx + 1}/${plan.slices.length} 片上传：${filename}，${(payload.length / 1024).toFixed(1)} KB（${
            filename.endsWith('.m4a') ? 'MP4/AAC' : 'WAV 16kHz 单声道'
          }）`
        );
      }
      try {
        const res = await callAsr(platform, payload, {
          timeoutMs: timeoutSeconds * 1000,
          signal,
          filename,
          onRetry: (attempt, err) => {
            if (onLog) {
              const title = (err && err.payload && err.payload.title) || '请求失败';
              onLog(`第 ${idx + 1} 片${title}，正在重试（第 ${attempt} 次）`);
            }
          }
        });
        sliceOutcomes.push({ idx: idx + 1, ok: true, status: 200 });
        done += 1;
        report(65 + (done / plan.slices.length) * 30, `识别中 ${done}/${plan.slices.length}`);
        return { idx, slice, result: res };
      } catch (err) {
        sliceOutcomes.push({ idx: idx + 1, ok: false, status: (err && err.payload && err.payload.status) || null, kind: err && err.payload && err.payload.kind });
        // 关键判断：如果之前已经有成功的片，说明凭证与格式都是通的，
        // 中途才失败通常意味着**额度/次数用尽**，而不是配置问题。
        const successCount = sliceOutcomes.filter((o) => o.ok).length;
        const status = (err && err.payload && err.payload.status) || null;
        const detail =
          `${successCount > 0 ? `前 ${successCount} 片已成功，第 ` : '第 '}${idx + 1} 片失败` +
          `${status ? `（HTTP ${status}）` : ''}。` +
          (successCount > 0
            ? '\n这说明凭证、接口地址与音频格式都是通的（否则第一片就会失败）。中途才开始失败，最常见的原因是**该账号的额度/调用次数用尽**，或触发限流。'
            : '') +
          '\n各片结果：' +
          sliceOutcomes.map((o) => `#${o.idx}${o.ok ? '成功' : `失败${o.status ? `(${o.status})` : ''}`}`).join(' ');
        if (err && err.payload) {
          err.payload.detail = `${err.payload.detail || ''}\n\n${detail}`.trim();
          if (successCount > 0) {
            err.payload.title = `${err.payload.title || '请求失败'}（前 ${successCount} 片已成功）`;
            err.payload.action = '请到平台控制台确认额度/调用次数是否用尽；充值或换 Key 后重试。也可换用其它平台（设置 → 语音识别）。';
          }
        } else if (err) {
          err.payload = { kind: 'asr', title: '语音识别失败', detail, action: '稍后重试或更换平台。' };
        }
        if (onLog) onLog(detail.replace(/\n+/g, ' '));
        throw err;
      }
    },
    signal
  );

  // --- 7. 合并（重叠去重） ---
  report(96, '合并识别结果');
  const lines = [];
  let prevTail = '';
  for (const item of rawResults) {
    if (!item) continue;
    const { slice, result } = item;
    if (!result) continue;
    mergeAttempts.push({
      index: item.idx,
      start: slice.start,
      end: slice.end,
      segments: result.segments ? result.segments.length : 0,
      chars: (result.text || '').length
    });

    // 7a. 带时间戳：按时间区间去重（优先），再按文本重叠去重
    const segs = (result.segments || [])
      .map((s) => ({
        from: s.t + slice.start,
        to: (s.d ?? 3) + s.t + slice.start,
        raw: s.text
      }))
      .filter((s) => s.raw && s.raw.trim());

    if (segs.length) {
      const cut = slice.start + Math.max(0, (Number(asr.overlapSeconds) || ASR_LIMITS.overlapSeconds) / 2);
      for (const s of segs) {
        const isOverlapZone = s.from < cut && lines.length;
        let text = s.raw.trim();
        if (isOverlapZone) {
          const prevText = lines.slice(-4).map((l) => l.text).join('');
          const { append } = dedupeAppend(prevText, text, 4);
          text = append;
        }
        if (!text) continue;
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.from - s.from) < 0.25 && last.text === text) continue;
        lines.push({ from: s.from, to: Math.max(s.from + 0.4, s.to), text, source: 'asr' });
      }
      prevTail = lines.slice(-3).map((l) => l.text).join('');
      continue;
    }

    // 7b. 无时间戳（如 SenseVoice）：文本标点归一化 + 小写化后窗口匹配去重
    const text = String(result.text || '').trim();
    if (!text) continue;
    const { append } = dedupeAppend(prevTail || lines.slice(-6).map((l) => l.text).join(''), text, 6);
    const novel = append || '';
    prevTail = (prevTail + novel).slice(-400);
    const rows = segmentPlainText(novel, { maxLen: 80 });
    if (rows.length) {
      const span = slice.end - slice.start;
      const per = span / rows.length;
      const base = slice.start;
      rows.forEach((r, i) => {
        lines.push({
          from: base + i * per,
          to: base + (i + 1) * per,
          text: r,
          source: 'asr',
          estimated: true
        });
      });
    }
  }

  // 兜底：无时间戳结果如果一行都没有，把整段文本按标点切成行
  if (!lines.length) {
    const joined = rawResults.map((r) => (r && r.result ? r.result.text : '')).filter(Boolean).join('');
    const rows = segmentPlainText(joined, { maxLen: 80 });
    const duration = video.duration || totalSeconds;
    const per = rows.length ? duration / rows.length : 0;
    rows.forEach((r, i) => {
      lines.push({ from: i * per, to: (i + 1) * per, text: r, source: 'asr', estimated: true });
    });
  }

  // 统一编号
  const withIndex = lines.map((l, i) => ({ ...l, i, edited: false, original: l.text }));
  const hasTime = withIndex.some((l) => l.source !== 'asr' || !l.estimated);

  report(100, '转录完成');
  return {
    lines: withIndex,
    meta: {
      source: 'asr',
      platform: platform ? platform.name : '',
      model: platform ? platform.model : '',
      slices: plan.slices.length,
      sliceSeconds: plan.sliceSeconds,
      retries: plan.attempts,
      concurrency,
      timeoutSeconds,
      duration: totalSeconds,
      missingTimestamps: !hasTime,
      bytes: dl.bytes.length,
      attempts: mergeAttempts,
      rawText: rawResults.map((r) => (r && r.result ? r.result.text : '')).filter(Boolean).join('\n')
    }
  };
}

// 把「单次识别结果」按时间/标点切行。M4A 单请求路径复用它，
// 保证两条路径产出完全一致的行结构。
//
// 关于时间戳（重要）：硅基流动上绝大多数模型**只返回纯文本**，没有时间信息。
// 实测（2024，同一段中文语音）：
//   · XingChenAGI/XingChenASR-Diarize-V3.0 → **返回 segments**（start/end/text/speaker）
//   · XingChenAGI/XingChenGSR-V1.0、FunAudioLLM/SenseVoiceSmall、TeleAI/TeleSpeechASR
//       → 只有 `text`，无任何时间信息
// 对没有时间戳的模型，只能把整段文本摊到音频时长上 —— 那是**估算**，
// 因此必须标记 `estimated: true` 并在界面提示，不能让用户误以为是真实对齐。
export function linesFromSingleResult(result, durationSeconds) {
  const lines = [];
  const segs = (result && result.segments ? result.segments : [])
    .map((s) => {
      // 兼容两种常见字段：{start,end} 与 {t,d}
      const start = Number.isFinite(Number(s.start)) ? Number(s.start) : Number(s.t) || 0;
      const endRaw = Number.isFinite(Number(s.end)) ? Number(s.end) : start + (Number(s.d) || 3);
      return { from: start, to: Math.max(endRaw, start + 0.2), raw: s.text, speaker: s.speaker };
    })
    .filter((s) => s.raw && s.raw.trim());
  if (segs.length) {
    // 有的模型（Diarize）会在 text 里带 "1: " 这样的说话人前缀，去掉
    for (const s of segs) {
      const clean = String(s.raw).replace(/^\s*\d+\s*[:：]\s*/, '').trim();
      if (!clean) continue;
      lines.push({
        from: s.from,
        to: s.to,
        text: clean,
        source: 'asr',
        estimated: false,
        ...(s.speaker ? { speaker: String(s.speaker) } : {})
      });
    }
    if (lines.length) return lines;
  }
  const text = String((result && result.text) || '')
    // 去掉每行开头的说话人前缀（"1: "），否则会混进字幕正文
    .replace(/^\s*\d+\s*[:：]\s*/gm, '')
    .trim();
  const rows = segmentPlainText(text, { maxLen: 80 });
  return distributeByLength(rows, durationSeconds);
}

// 按**字数**比例把若干行摊到 [0, durationSeconds] 区间。
// 比「平均分配」明显更接近真实语速（长句占更多时间），
// 但这终究是估算 —— 调用方需保留 estimated: true。
export function distributeByLength(rows, durationSeconds) {
  const total = Math.max(0.1, Number(durationSeconds) || 0);
  const weights = rows.map((r) => Math.max(1, String(r).replace(/\s/g, '').length));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  let cursor = 0;
  return rows.map((r, i) => {
    const span = (weights[i] / sum) * total;
    const from = cursor;
    const to = i === rows.length - 1 ? total : cursor + span;
    cursor = to;
    return { from, to, text: r, source: 'asr', estimated: true };
  });
}

// ---------------------------------------------------------------------------
// M4A 单请求路径（对齐 Bilitato）
//
// 与主路径的区别：**不解码、不重采样、不重新编码**，直接把原始音轨交给
// FFmpeg 做流复制重封装（-c:a copy），得到普通 MP4 后整段上传。
// 这样：
//   · 音频编码与 B 站原始 AAC 完全一致（没有转码损失）
//   · 没有 MediaRecorder 的实时编码开销
//   · 普通 MP4（moov 在前）而不是 fragmented MP4
// ---------------------------------------------------------------------------
async function transcribeViaRemux({
  rawBytes,
  platform,
  sliceSeconds,
  timeoutSeconds,
  durationSeconds,
  hooks
}) {
  const { onLog, onProgress, signal } = hooks;
  const { remuxToMp4 } = await import('./ffmpeg.js');

  const total = rawBytes.length;
  const perSecond = durationSeconds > 0 ? total / durationSeconds : 0;
  const limitBytes = 50 * 1024 * 1024;
  const fitsWhole = total < limitBytes * 0.72;

  const slices = [];
  if (fitsWhole) {
    slices.push({ start: 0, duration: null });
  } else {
    // 超过上限：按时间切成多段，每段单独重封装
    const maxSeconds = perSecond > 0 ? Math.floor((limitBytes * 0.72) / perSecond) : sliceSeconds;
    const step = Math.max(30, Math.min(sliceSeconds, maxSeconds));
    if (onLog) onLog(`音轨 ${(total / 1024 / 1024).toFixed(1)}MB 超过单请求上限，按 ${step}s 分段重封装`);
    for (let t = 0; t < durationSeconds; t += step) {
      const d = Math.min(step, durationSeconds - t);
      slices.push({ start: t, duration: d });
      if (t + d >= durationSeconds - 0.05) break;
    }
  }

  const outputs = [];
  for (let i = 0; i < slices.length; i += 1) {
    throwIfAborted(signal);
    const s = slices[i];
    if (onProgress) onProgress({ percent: 40 + (i / slices.length) * 35, detail: `重封装音频 ${i + 1}/${slices.length}` });
    const out = await remuxToMp4(rawBytes, {
      inputName: 'input.m4s',
      outputName: `out-${i}.m4a`,
      startSec: s.duration == null ? undefined : s.start,
      durationSec: s.duration == null ? undefined : s.duration,
      onProgress: (m) => {
        if (onLog) onLog(m);
      }
    });
    if (onLog) onLog(`第 ${i + 1}/${slices.length} 片重封装：${(out.length / 1024).toFixed(1)} KB（普通 MP4，流复制）`);
    outputs.push({ slice: s, bytes: out });
  }

  // 逐片识别（重封装很便宜，此处串行足够）
  const rawResults = [];
  const base = { slices: outputs.length, sliceSeconds, attempts: 0, planSlices: outputs.map((o) => o.slice) };
  for (let i = 0; i < outputs.length; i += 1) {
    throwIfAborted(signal);
    if (onProgress) onProgress({ percent: 78 + (i / outputs.length) * 18, detail: `识别中 ${i + 1}/${outputs.length}` });
    const res = await callAsr(platform, outputs[i].bytes, {
      timeoutMs: timeoutSeconds * 1000,
      signal,
      filename: `slice-${String(i + 1).padStart(3, '0')}.m4a`,
      onRetry: (attempt, err) => {
        if (onLog) {
          const title = (err && err.payload && err.payload.title) || '请求失败';
          onLog(`第 ${i + 1} 片${title}，正在重试（第 ${attempt} 次）`);
        }
      }
    });
    rawResults.push({ idx: i, slice: { start: outputs[i].slice.start, end: outputs[i].slice.start + (outputs[i].slice.duration || durationSeconds) }, result: res });
  }
  return { rawResults, base };
}

// M4A 路径的成品组装（结构与其主路径一致）
export function assembleRemuxOutcome({ rawResults, base, platform, durationSeconds, bytes }) {
  const lines = [];
  for (const item of rawResults) {
    if (!item || !item.result) continue;
    const rel = item.slice.start;
    for (const l of linesFromSingleResult(item.result, (item.slice.end - item.slice.start) || durationSeconds)) {
      lines.push({ ...l, from: l.from + rel, to: l.to + rel });
    }
  }
  const withIndex = lines.map((l, i) => ({ ...l, i, edited: false, original: l.text }));
  const hasTime = withIndex.some((l) => !l.estimated);
  return {
    lines: withIndex,
    meta: {
      source: 'asr',
      platform: platform ? platform.name : '',
      model: platform ? platform.model : '',
      slices: base.slices,
      sliceSeconds: base.sliceSeconds,
      retries: 0,
      concurrency: 1,
      duration: durationSeconds,
      missingTimestamps: !hasTime,
      bytes,
      transport: 'ffmpeg-remux',
      attempts: [],
      rawText: rawResults.map((r) => (r && r.result ? r.result.text : '')).filter(Boolean).join('\n')
    }
  };
}

// 侧边栏不能直接调外部平台（没有宿主权限/可能被 CORS 拦），统一交给后台。
// 后台方法名：asr.transcribe（见 service-worker.js）
// 服务端 5xx 多为瞬时故障，值得重试；但 4xx 是请求本身的问题，重试无意义。
// 判定逻辑与后台共用同一份（isRetriableAsrError），避免两边策略不一致。
const ASR_RETRY_DELAYS_MS = [1200, 3000];

async function callAsr(platform, wavBytes, opts = {}) {
  const base64 = bytesToBase64(wavBytes);
  const filename = opts.filename || 'slice.wav';
  const payload = { platformId: platform ? platform.id : null, base64, filename };
  // RPC 超时必须**大于** HTTP 超时，否则会出现「RPC 先超时、HTTP 其实还在跑」的假失败。
  // 事故复盘：asr.transcribe 曾不在 METHOD_TIMEOUT 里，回落到默认 30 秒，
  // 而上传 13MB WAV 恰好要约 30 秒 → 永远超时。
  const httpTimeoutMs = opts.timeoutMs || 180000;
  const rpcTimeoutMs = Math.max(httpTimeoutMs + 60000, 600000);
  let lastErr = null;
  for (let attempt = 0; attempt <= ASR_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      if (opts.onRetry) opts.onRetry(attempt, lastErr);
      await new Promise((r) => setTimeout(r, ASR_RETRY_DELAYS_MS[attempt - 1]));
      if (opts.signal && opts.signal.aborted) throw Object.assign(new Error('已终止'), { name: 'AbortError' });
    }
    try {
      return await call('asr.transcribe', payload, { timeoutMs: rpcTimeoutMs });
    } catch (err) {
      lastErr = err;
      if (!isRetriableAsrError(err && err.payload)) throw err;
    }
  }
  throw lastErr;
}

function bytesToBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
