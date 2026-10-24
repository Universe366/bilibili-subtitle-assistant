import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let logDir = '';

vi.mock('electron', () => ({
  app: { getPath: () => logDir }
}));

const { writeLog, fatal } = await import('./log');

describe('日志', () => {
  beforeEach(() => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-log-'));
  });
  afterEach(() => {
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  it('写入带时间戳的一行', () => {
    writeLog('startup.log', 'boot ok');
    const content = fs.readFileSync(path.join(logDir, 'startup.log'), 'utf8');
    expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(content).toContain('boot ok');
  });

  it('多次写入追加而不是覆盖', () => {
    writeLog('startup.log', 'one');
    writeLog('startup.log', 'two');
    const lines = fs.readFileSync(path.join(logDir, 'startup.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('two');
  });

  it('fatal 写 fatal.log 并带错误栈', () => {
    fatal('uncaughtException', new Error('boom'));
    const content = fs.readFileSync(path.join(logDir, 'fatal.log'), 'utf8');
    expect(content).toContain('uncaughtException');
    expect(content).toContain('boom');
  });

  it('目录不可写时不抛错', () => {
    logDir = path.join(logDir, 'missing', 'child', 'deep');
    expect(() => writeLog('x.log', 'y')).not.toThrow();
  });
});
