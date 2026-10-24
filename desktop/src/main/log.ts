import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/** 启动/致命日志：写 userData 下的纯文本，失败时静默（日志不能拖垮启动）。 */
export function writeLog(file: string, message: string): void {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, file), `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {
    // ignore
  }
}

export function fatal(tag: string, error: unknown): void {
  writeLog('fatal.log', `${tag}: ${(error as Error)?.stack || String(error)}`);
}
