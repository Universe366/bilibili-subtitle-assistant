import type { DatabaseSync } from 'node:sqlite';

/**
 * 数据库句柄与初始化钩子。
 *
 * 单独放一个文件，是为了让 library/ 下的子模块（任务、导出、下载…）能拿到连接，
 * 又不用反向 import `library.ts` 形成环。`initLibrary()` 在 library.ts 里注册，
 * `requireDb()` 第一次被调用时懒加载。
 */
let instance: DatabaseSync | null = null;
let dbFile = '';
let initHook: (() => void) | null = null;

export function bindLibraryDatabase(db: DatabaseSync, file: string): void {
  instance = db;
  dbFile = file;
}

export function releaseLibraryDatabase(): void {
  instance = null;
}

export function hasLibraryDatabase(): boolean {
  return instance !== null;
}

export function libraryFilePath(): string {
  return dbFile;
}

/** library.ts 在模块加载时注册，供 requireDb 懒初始化。 */
export function setLibraryInitializer(init: () => void): void {
  initHook = init;
}

export function requireDb(): DatabaseSync {
  if (!instance) initHook?.();
  if (!instance) throw new Error('数据库未初始化');
  return instance;
}

let ftsEnabled = true;

export function setFtsEnabled(value: boolean): void {
  ftsEnabled = value;
}

export function isFtsEnabled(): boolean {
  return ftsEnabled;
}

export function toNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
