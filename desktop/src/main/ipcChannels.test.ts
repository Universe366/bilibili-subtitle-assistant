import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * IPC channel 契约：主进程注册的 channel 必须和 `scripts/ipc-channels.json` 一致，
 * 且 preload 暴露的每个 invoke/send 都必须在主进程注册过。
 *
 * 新增/删除 channel 后运行：`UPDATE_IPC_CHANNELS=1 npm test`
 * （Windows PowerShell：`$env:UPDATE_IPC_CHANNELS=1; npm test`）
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..');
const snapshotFile = path.resolve(srcRoot, '..', 'scripts', 'ipc-channels.json');

const MAIN_CHANNEL_RE = /ipcMain\.(?:handle|handleOnce|on)\(\s*'([^']+)'/g;
const PRELOAD_CHANNEL_RE = /ipcRenderer\.(?:invoke|send)\(\s*'([^']+)'/g;

function collect(files: string[], pattern: RegExp): string[] {
  const found = new Set<string>();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found].sort();
}

function mainFiles(): string[] {
  const ipcDir = path.join(here, 'ipc');
  const extra = fs.existsSync(ipcDir)
    ? fs
        .readdirSync(ipcDir)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
        .map((name) => path.join(ipcDir, name))
    : [];
  return [path.join(here, 'ipc.ts'), ...extra].filter((file) => fs.existsSync(file));
}

describe('IPC channel 契约', () => {
  const channels = collect(mainFiles(), MAIN_CHANNEL_RE);
  const saved: string[] = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));

  it('主进程 channel 与清单一致', () => {
    if (process.env.UPDATE_IPC_CHANNELS === '1') {
      fs.writeFileSync(snapshotFile, `${JSON.stringify(channels, null, 2)}\n`, 'utf8');
    }
    const expected = JSON.parse(fs.readFileSync(snapshotFile, 'utf8')) as string[];
    const added = channels.filter((channel) => !expected.includes(channel));
    const removed = expected.filter((channel) => !channels.includes(channel));
    expect({ added, removed, total: channels.length }).toEqual({
      added: [],
      removed: [],
      total: expected.length
    });
  });

  it('preload 的 invoke/send 都有主进程处理', () => {
    const exposed = collect([path.join(srcRoot, 'preload', 'index.ts')], PRELOAD_CHANNEL_RE);
    const missing = exposed.filter((channel) => !channels.includes(channel));
    expect(missing).toEqual([]);
  });

  it('channel 清单没有重复项', () => {
    expect(saved.length).toBe(new Set(saved).size);
    expect(channels.length).toBeGreaterThan(140);
  });
});
