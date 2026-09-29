// 方案评估：是否真的需要 31MB 的 FFmpeg.wasm？
//
// 目的：用**实证**代替判断。要回答的是：
//   硅基流动的 /audio/transcriptions 到底能不能接受 MediaRecorder 产出的
//   「分片式 MP4（fragmented MP4）」，还是必须像参考实现那样是**普通 MP4**？
//
// 做法：用同一段真实语音，造出两个文件——
//   A. MediaRecorder 直接产出（fragmented MP4，带 mvex/moof）
//   B. 用 ffmpeg.wasm `-c:a copy` 重新封装（普通 MP4，moov 在前）
// 然后分别看结构差异。若确认差异是「没有普通 moov」，则可以用纯 JS 重封装解决，
// 不必打包 31MB；否则就按用户的建议引入 FFmpeg.wasm。
//
// 本脚本只做结构分析（不需要硅基流动的 Key）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const results = [];
const check = (n, ok, extra = '') => results.push({ n, ok: !!ok, extra });

// 解析 MP4 顶层 box 列表
function topLevelBoxes(buf) {
  const boxes = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    const size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (size < 8) break;
    boxes.push({ type, size, offset: off });
    off += size;
  }
  return boxes;
}

// 找出所有层级的 box 类型（含嵌套），用于判断是否 fragmented
function findBoxes(buf, wanted, depth = 0) {
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf', 'edts']);
  const found = [];
  const walk = (start, end, level) => {
    let off = start;
    while (off + 8 <= end) {
      const size = buf.readUInt32BE(off);
      const type = buf.toString('latin1', off + 4, off + 8);
      if (size < 8 || off + size > end) break;
      if (wanted.includes(type)) found.push({ type, level, offset: off });
      if (CONTAINERS.has(type) && level < 6) walk(off + 8, off + size, level + 1);
      off += size;
    }
  };
  walk(0, buf.length, depth);
  return found;
}

function analyze(label, file) {
  if (!fs.existsSync(file)) {
    return { label, missing: true };
  }
  const buf = fs.readFileSync(file);
  const top = topLevelBoxes(buf);
  const topTypes = top.map((b) => b.type);
  const all = findBoxes(buf, ['ftyp', 'moov', 'moof', 'mvex', 'mdat', 'trak', 'mdia', 'stbl', 'stsd', 'mp4a', 'avc1']);
  const has = (t) => all.some((b) => b.type === t);
  return {
    label,
    size: buf.length,
    topLevel: topTypes,
    hasMoov: has('moov'),
    hasMoof: has('moof'),
    hasMvex: has('mvex'),
    fragmented: has('moof') || has('mvex'),
    moovBeforeMdat: (() => {
      const mo = topTypes.indexOf('moov');
      const md = topTypes.indexOf('mdat');
      return mo >= 0 && md >= 0 ? mo < md : null;
    })(),
    codec: has('mp4a') ? 'mp4a(AAC)' : has('avc1') ? 'avc1' : 'unknown'
  };
}

const a = analyze('MediaRecorder 产出', path.join(__dirname, 'sample-mediarecorder.m4a'));
const b = analyze('ffmpeg 重新封装', path.join(__dirname, 'sample-ffmpeg.m4a'));

console.log('\n===== MP4 结构对比 =====');
for (const a1 of [a, b]) {
  console.log(JSON.stringify(a1, null, 2));
}

if (!a.missing) {
  // 这是本测试的核心结论：MediaRecorder 只能产出 fragmented MP4
  check('MediaRecorder 产出是 fragmented MP4（含 moof/mvex）', a.fragmented === true, JSON.stringify(a.topLevel));
  check('fragmented MP4 含 mvex', a.hasMvex === true, JSON.stringify(a.topLevel));
} else {
  console.log('（未找到 sample-mediarecorder.m4a，跳过；可先运行 make-m4a-sample.mjs 生成）');
}

if (!b.missing) {
  check('ffmpeg 产出是普通 MP4（有 moov、无 moof）', b.hasMoov === true && b.hasMoof === false, JSON.stringify(b.topLevel));
  check('ffmpeg 产出 moov 在 mdat 之前（faststart）', b.moovBeforeMdat !== false, String(b.moovBeforeMdat));
} else {
  console.log('（未找到 sample-ffmpeg.m4a，跳过；可先运行 ffmpeg-remux-test.mjs 生成）');
}

if (!a.missing && !b.missing) {
  check('两者结构确实不同（证明「重封装」是必要差异）', a.fragmented !== b.fragmented, `a.fragmented=${a.fragmented} b.fragmented=${b.fragmented}`);
}

if (a.missing && b.missing) {
  console.log('\n两个样本都不存在，本测试没有可验证的内容（退出码 0）。');
  process.exit(0);
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
}
console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
