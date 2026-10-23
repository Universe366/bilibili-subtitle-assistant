import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

/** 用 ffmpeg 读取媒体时长（秒）；读不到返回 0，ASR 仍会按分段限制处理。 */
export function probeDuration(file: string): Promise<number> {
  return new Promise((resolve) => {
    const ffmpeg = ffmpegStatic;
    if (!ffmpeg) {
      resolve(0);
      return;
    }
    let stderr = '';
    let settled = false;
    const done = (value: number) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const child = spawn(ffmpeg, ['-hide_banner', '-i', file], { windowsHide: true });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.length > 64 * 1024) stderr = stderr.slice(-32 * 1024);
      });
      child.on('error', () => done(0));
      child.on('close', () => {
        const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
        if (!match) return done(0);
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        done(Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
      });
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignore
        }
        done(0);
      }, 15000).unref?.();
    } catch {
      done(0);
    }
  });
}
