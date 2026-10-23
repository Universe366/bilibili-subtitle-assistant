import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * 统一日志：把主进程现有的 console.* 同时落到 `userData/logs/main-YYYY-MM-DD.log`。
 *
 * - 不要求每个调用点改成 log.info：安装一次 console 钩子就能覆盖存量代码；
 * - 写日志本身绝不抛错，磁盘满/权限不足只影响日志；
 * - 落盘前做一次脱敏，避免 Key、Bearer Token 进日志；
 * - 只保留最近 7 天。
 */
const KEEP_DAYS = 7;
const MAX_LINE = 4000;

let installed = false;
let logDir = '';
let original: Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug'> | null = null;

function redact(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, 'sk-***')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1 ***')
    .replace(
      /("?(?:api[_-]?key|authorization|token|secret)"?\s*[:=]\s*"?)([^"',}\s]{4,})/gi,
      '$1***'
    );
}

function dayStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toText(args: unknown[]): string {
  return args
    .map((value) => {
      if (typeof value === 'string') return value;
      if (value instanceof Error) return value.stack || value.message;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join(' ')
    .slice(0, MAX_LINE);
}

function write(level: string, args: unknown[]): void {
  if (!logDir) return;
  try {
    const line = `${new Date().toISOString()} [${level}] ${redact(toText(args))}\n`;
    fs.appendFileSync(path.join(logDir, `main-${dayStamp()}.log`), line, 'utf8');
  } catch {
    // 日志失败不能影响主流程
  }
}

function prune(): void {
  try {
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(logDir)) {
      if (!/^main-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
      const file = path.join(logDir, name);
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
    }
  } catch {
    // ignore
  }
}

export function installLogger(): void {
  if (installed) return;
  try {
    logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    prune();
  } catch {
    logDir = '';
  }
  installed = true;

  const current = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console)
  };
  original = current;

  const wrap =
    (level: string, fallback: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      write(level, args);
      fallback(...args);
    };

  console.log = wrap('INFO', current.log);
  console.info = wrap('INFO', current.info);
  console.warn = wrap('WARN', current.warn);
  console.error = wrap('ERROR', current.error);
  console.debug = wrap('DEBUG', current.debug);
}

export function uninstallLogger(): void {
  if (!installed || !original) return;
  console.log = original.log;
  console.info = original.info;
  console.warn = original.warn;
  console.error = original.error;
  console.debug = original.debug;
  installed = false;
  original = null;
}

export function logDirectory(): string {
  return logDir;
}
