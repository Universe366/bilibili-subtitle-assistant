// FFmpeg.wasm 封装（单线程 core，无需 SharedArrayBuffer）。
//
// 用途：把音轨做「流复制重封装」（-c:a copy），产出的**普通 MP4** 才是参考实现
// Bilitato 上传给 ASR 的格式。
//
// 为什么必须这样做：
//   浏览器里唯一能编 AAC 的是 MediaRecorder，但它产出的必然是
//   **fragmented MP4**（已实测确认：ftyp + moov + moof/mdat × N）。
//   硅基流动对这类文件返回 500（空响应体）。而 Bilitato 用
//   ffmpeg `-c:a copy` 重新封装成普通 MP4（moov 在前），服务端就能接受。
//
// 实现方式：使用官方 @ffmpeg/ffmpeg（0.12.x）包装包（已用 esbuild 打成
// 两个无相对依赖的文件，见 vendor/ffmpeg/）。它负责创建 Worker →
// importScripts/动态 import core → 管理虚拟 FS → 调 core.exec。
// 直接手写 core.exec 容易踩到调用约定的细节，官方包装包已验证。
//
// 为什么要 blob URL：扩展页 CSP 不允许直接 import 远程脚本，且 blob 需要
// 单文件 ESM（相对导入在 blob 下无法解析），所以先打成自包含文件。
//
// 体积代价：core 为 31MB（vendor/ffmpeg/），故**按需加载** ——
// 只有真正需要重封装时才把它读进内存（首次约 1~3 秒）。

const VENDOR = 'vendor/ffmpeg';

let apiPromise = null;

function extUrl(rel) {
  try {
    return chrome.runtime.getURL(rel);
  } catch (err) {
    return rel;
  }
}

async function toBlobUrl(url, mime) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载 ${url} 失败（HTTP ${res.status}）`);
  const buf = await res.arrayBuffer();
  return URL.createObjectURL(new Blob([buf], { type: mime }));
}

export function ffmpegAvailable() {
  return typeof WebAssembly !== 'undefined' && typeof fetch === 'function' && typeof Worker !== 'undefined';
}

// 加载 @ffmpeg/ffmpeg 包装包 + core。返回 { ffmpeg, FS }。
async function loadApi(onProgress) {
  if (apiPromise) return apiPromise;
  apiPromise = (async () => {
    if (onProgress) onProgress('加载 FFmpeg 包装层…');
    // 注意：**不能**用 blob URL 导入。Chrome 禁止扩展页 CSP 的 script-src 出现
    // `blob:`（会直接报 'Insecure CSP value "blob:" in directive script-src' 并
    // 拒绝加载扩展）。这里的文件已用 esbuild 打成自包含 ESM（无相对导入），
    // 所以可以直接从 chrome-extension:// 地址导入，走 script-src 'self'。
    let mod;
    try {
      mod = await import(/* @vite-ignore */ extUrl(`${VENDOR}/ffmpeg-api.js`));
    } catch (err) {
      throw new Error(`加载 FFmpeg 包装层失败：${(err && err.message) || err}`);
    }
    const FFmpeg = mod && mod.FFmpeg;
    if (typeof FFmpeg !== 'function') throw new Error('FFmpeg 包装层导出异常（缺少 FFmpeg 类）');

    if (onProgress) onProgress('加载 FFmpeg 内核（约 31MB，首次较慢）…');
    // 这里同样传 chrome-extension:// 地址。worker 内部会对 coreURL 调 importScripts /
    // 动态 import —— 传 blob 会落到 script-src 上，同样被 CSP 拦。
    const ffmpeg = new FFmpeg();
    const logs = [];
    ffmpeg.on('log', ({ message }) => {
      logs.push(String(message));
      if (logs.length > 300) logs.shift();
    });
    await ffmpeg.load({
      // classWorkerURL：显式告诉包装层用哪个 Worker 脚本。
      // 不打这个参数时它会执行 `new Worker(new URL("./worker.js", import.meta.url))`，
      // 而我们是从 blob URL 导入的，import.meta.url 是 blob:，无法解析相对路径，
      // 会抛 "Failed to construct 'URL': Invalid URL"。所以必须显式传入。
      classWorkerURL: extUrl(`${VENDOR}/ffmpeg-worker.js`),
      coreURL: extUrl(`${VENDOR}/ffmpeg-core.js`),
      wasmURL: extUrl(`${VENDOR}/ffmpeg-core.wasm`)
    });
    if (onProgress) onProgress('FFmpeg 就绪');
    return { ffmpeg, logs };
  })();
  try {
    return await apiPromise;
  } catch (err) {
    apiPromise = null;
    throw err;
  }
}

// 把「原始音轨字节」重新封装成普通 MP4（只复制音频流，不重新编码）。
// 与参考实现 Bilitato 完全一致：ffmpeg -c:a copy -movflags +faststart
export async function remuxToMp4(audioBytes, opts = {}) {
  const inputName = opts.inputName || 'input.m4s';
  const outputName = opts.outputName || 'out.m4a';
  const { ffmpeg, logs } = await loadApi(opts.onProgress);
  await ffmpeg.writeFile(inputName, audioBytes);
  const args = ['-hide_banner', '-y', '-i', inputName];
  if (opts.startSec != null) args.push('-ss', String(opts.startSec));
  if (opts.durationSec != null) args.push('-t', String(opts.durationSec));
  args.push('-vn', '-map', '0:a:0', '-c:a', 'copy', '-movflags', '+faststart', outputName);
  let ret = null;
  try {
    ret = await ffmpeg.exec(args);
  } catch (err) {
    throw new Error(`FFmpeg 执行异常：${(err && err.message) || err}`);
  }
  if (typeof ret === 'number' && ret !== 0) {
    const tail = logs.slice(-6).join(' / ');
    throw new Error(`FFmpeg 执行失败（退出码 ${ret}）${tail ? `：${tail}` : ''}`);
  }
  let out;
  try {
    out = await ffmpeg.readFile(outputName);
  } catch (err) {
    const tail = logs.slice(-8).join('\n');
    throw new Error(`FFmpeg 没有产出 ${outputName}${tail ? `。内核输出：\n${tail}` : ''}`);
  }
  // 清理虚拟 FS，避免内存堆积
  try {
    await ffmpeg.deleteFile(inputName);
  } catch (err) {
    /* ignore */
  }
  try {
    await ffmpeg.deleteFile(outputName);
  } catch (err) {
    /* ignore */
  }
  if (!out || !out.length) throw new Error(`FFmpeg 产出为空：${outputName}`);
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}
