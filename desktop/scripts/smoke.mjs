import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 桌面端冒烟 / E2E：启动真实 Electron、连 CDP，验证壳、设置、库、笔记与回收站。
 *
 * 用法：npm run smoke
 * 依赖：本机 Electron 二进制、图形会话（Windows 直接跑；Linux 需要 xvfb）。
 * 隔离：临时 BSUB_USER_DATA，不会碰真实库。
 */
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bsub-smoke-'));
const port = 9300 + Math.floor(Math.random() * 200);

function electronBin() {
  try {
    return require('electron');
  } catch {
    return path.join(desktop, 'node_modules', 'electron', 'dist', 'electron.exe');
  }
}

const env = { ...process.env, BSUB_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBin(), ['.', `--remote-debugging-port=${port}`], {
  cwd: desktop,
  env,
  stdio: 'ignore',
  windowsHide: true
});

function stop() {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // ignore
  }
  try {
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    // ignore
  }
}

async function waitForTarget(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const targets = await response.json();
      const page = targets.find(
        (target) => target.type === 'page' && String(target.url).includes('renderer/index.html')
      );
      if (page) return page;
    } catch {
      // not ready
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('等待 Electron CDP 超时');
}

function evaluate(ws, expression) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const timer = setTimeout(() => reject(new Error('CDP evaluate 超时')), 20000);
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (message.result?.exceptionDetails) {
        const detail = message.result.exceptionDetails;
        const text = detail.exception?.description || detail.text || JSON.stringify(detail);
        reject(new Error(text));
      } else {
        resolve(message.result?.result?.value);
      }
    };
    ws.addEventListener('message', onMessage);
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true }
      })
    );
  });
}

/** 在渲染进程里执行一段 async 函数体，返回其 JSON 结果。 */
async function run(ws, body) {
  const value = await evaluate(ws, `(async () => { ${body} })()`);
  return value === undefined ? undefined : JSON.parse(value);
}

const passed = [];
const state = { tabCount: 0, videoId: 0 };
let current = '';

async function step(name, fn) {
  current = name;
  const started = Date.now();
  const detail = await fn();
  passed.push(name);
  console.log(`PASS  ${name}${detail ? `  -> ${detail}` : ''}  (${Date.now() - started}ms)`);
}

const SMOKE_TITLE = '冒烟自检 · 拾字';
const ingestPayload = {
  info: {
    kind: 'video',
    bvid: 'BVSMOKE00001',
    aid: 1,
    cid: 1,
    epId: null,
    seasonId: null,
    page: 1,
    partTitle: '',
    parts: [],
    title: SMOKE_TITLE,
    owner: 'self-test',
    desc: '',
    duration: 120,
    url: 'https://www.bilibili.com/video/BVSMOKE00001',
    signature: 'smoke'
  },
  track: {
    lan: 'zh-CN',
    lanDoc: '中文（自动生成）',
    url: 'https://example.invalid/smoke.json',
    isAi: true,
    aiStatus: 2,
    source: 'smoke'
  },
  lines: [
    { start: 0, end: 1.5, text: '拾字自检第一句' },
    { start: 1.5, end: 3, text: '第二句包含关键词' },
    { start: 3, end: 4, text: '第三句结束' }
  ]
};

try {
  const target = await waitForTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  // 1. 窗口 + preload
  await step('窗口与 preload', async () => {
    const title = await evaluate(ws, 'document.title');
    if (title !== '拾字') throw new Error(`窗口标题异常：${title}`);
    const api = await evaluate(ws, 'typeof window.bsub');
    if (api !== 'object') throw new Error('preload API 未注入');
    return `title=${title}`;
  });

  // 2. 标签页
  await step('标签页列表', async () => {
    const tabs = JSON.parse(
      await evaluate(ws, 'window.bsub.listTabs().then((list) => JSON.stringify(list))')
    );
    if (!Array.isArray(tabs) || tabs.length === 0) throw new Error('没有打开的标签页');
    state.tabCount = tabs.length;
    return tabs.length;
  });

  // 3. 设置读写（改一个无副作用的开关再还原）
  await step('设置读写与持久化', async () => {
    const result = await run(
      ws,
      `
      const first = await window.bsub.getSettings();
      if (!first.ok) throw new Error('getSettings: ' + first.error);
      if (first.data.version !== ${JSON.stringify(pkg.version)}) {
        throw new Error('版本不一致: ' + first.data.version);
      }
      const next = JSON.parse(JSON.stringify(first.data.settings));
      const before = next.general.autoFollow;
      next.general.autoFollow = !before;
      const saved = await window.bsub.saveSettings(next);
      if (!saved.ok) throw new Error('saveSettings: ' + saved.error);
      const second = await window.bsub.getSettings();
      if (!second.ok) throw new Error('getSettings(2): ' + second.error);
      if (second.data.settings.general.autoFollow !== !before) {
        throw new Error('设置未持久化');
      }
      const restored = JSON.parse(JSON.stringify(second.data.settings));
      restored.general.autoFollow = before;
      const back = await window.bsub.saveSettings(restored);
      if (!back.ok) throw new Error('restore: ' + back.error);
      return JSON.stringify({ version: first.data.version, toggled: !before, restored: before });
      `
    );
    return `version=${result.version}`;
  });

  // 4. 入库 + 列表 + 详情 + 搜索
  await step('字幕入库与检索', async () => {
    const result = await run(
      ws,
      `
      const payload = ${JSON.stringify(ingestPayload)};
      const ingested = await window.bsub.ingestLibrary(payload);
      if (!ingested.ok) throw new Error('ingest: ' + ingested.error);
      if (ingested.data.lineCount !== payload.lines.length) {
        throw new Error('入库行数不符: ' + ingested.data.lineCount);
      }
      const list = await window.bsub.listLibrary();
      if (!list.ok) throw new Error('list: ' + list.error);
      const hit = list.data.videos.find((v) => v.id === ingested.data.videoId);
      if (!hit) throw new Error('列表里找不到刚入库的条目');
      if (hit.title !== payload.info.title) throw new Error('标题不符: ' + hit.title);
      const detail = await window.bsub.getLibraryItem(ingested.data.videoId);
      if (!detail.ok) throw new Error('detail: ' + detail.error);
      if (!detail.data.bundle || detail.data.bundle.lines.length !== payload.lines.length) {
        throw new Error('详情字幕行数不符');
      }
      const search = await window.bsub.searchLibrary('冒烟自检');
      if (!search.ok) throw new Error('search: ' + search.error);
      if (search.data.total + search.data.videos.length === 0) {
        throw new Error('搜索结果为空');
      }
      return JSON.stringify({ videoId: ingested.data.videoId });
      `
    );
    state.videoId = result.videoId;
    return `videoId=${result.videoId}`;
  });

  // 5. 笔记保存
  await step('笔记保存与读取', async () => {
    const note = '# 冒烟笔记\n这是 E2E 写入的内容。';
    await run(
      ws,
      `
      const saved = await window.bsub.saveNote(${state.videoId}, ${JSON.stringify(note)});
      if (!saved.ok) throw new Error('saveNote: ' + saved.error);
      const read = await window.bsub.getNote(${state.videoId});
      if (!read.ok) throw new Error('getNote: ' + read.error);
      if (!read.data || read.data.content !== ${JSON.stringify(note)}) {
        throw new Error('笔记内容不一致');
      }
      const versions = await window.bsub.getNoteVersions(${state.videoId});
      if (!versions.ok) throw new Error('note-versions: ' + versions.error);
      return JSON.stringify({ versions: versions.data.length });
      `
    );
    return 'saved';
  });

  // 6. 回收站：删除 → 恢复 → 再删 → 清空
  await step('回收站删除与恢复', async () => {
    const result = await run(
      ws,
      `
      const id = ${state.videoId};
      const removed = await window.bsub.removeLibrary(id);
      if (!removed.ok || !removed.data.removed) throw new Error('remove: ' + removed.error);
      const trash = await window.bsub.listTrash();
      if (!trash.ok) throw new Error('trash list: ' + trash.error);
      const entry = trash.data.find((item) => item.videoId === id);
      if (!entry) throw new Error('回收站里找不到条目');
      const restored = await window.bsub.restoreTrash(entry.id);
      if (!restored.ok) throw new Error('restore: ' + restored.error);
      const list = await window.bsub.listLibrary();
      if (!list.ok) throw new Error('list(2): ' + list.error);
      const revived = list.data.videos.find((v) => v.title === ${JSON.stringify(SMOKE_TITLE)});
      if (!revived) throw new Error('恢复后列表里没有该条目');
      const removedAgain = await window.bsub.removeLibrary(revived.id);
      if (!removedAgain.ok) throw new Error('remove(2): ' + removedAgain.error);
      const cleared = await window.bsub.clearTrash();
      if (!cleared.ok) throw new Error('clear trash: ' + cleared.error);
      return JSON.stringify({ trashId: entry.id, revivedId: revived.id, cleared: cleared.data.removed });
      `
    );
    return `trashId=${result.trashId} cleared=${result.cleared}`;
  });

  // 7. 任务中心（jobs 域）
  await step('任务中心通道', async () => {
    const result = await run(
      ws,
      `
      const list = await window.bsub.listJobs();
      if (!list.ok || !Array.isArray(list.data)) throw new Error('jobs:list 异常');
      const retry = await window.bsub.retryJob('smoke-not-a-job');
      if (retry.ok || !retry.error) throw new Error('jobs:retry 应返回错误');
      await window.bsub.cancelJob('smoke-not-a-job');
      return JSON.stringify({ jobs: list.data.length });
      `
    );
    return `jobs=${result.jobs}`;
  });

  // 8. AI 参数校验（不发网络请求）
  await step('AI 参数校验', async () => {
    const result = await run(
      ws,
      `
      const bad = await window.bsub.summarize({});
      if (bad.ok) throw new Error('空载荷不应通过校验');
      return JSON.stringify({ error: bad.error });
      `
    );
    return result.error;
  });

  // 9. 历史与导出记录
  await step('历史与导出记录', async () => {
    const result = await run(
      ws,
      `
      const history = await window.bsub.getHistory();
      if (!history.ok || !Array.isArray(history.data)) throw new Error('history:list 异常');
      const exports = await window.bsub.listExports();
      if (!exports.ok || !Array.isArray(exports.data)) throw new Error('exports:list 异常');
      return JSON.stringify({ history: history.data.length, exports: exports.data.length });
      `
    );
    return `history=${result.history} exports=${result.exports}`;
  });

  ws.close();
  console.log(`SMOKE OK title=拾字 version=${pkg.version} tabs=${state.tabCount}`);
  console.log(`E2E OK ${passed.length}/${passed.length} ${passed.join(' / ')}`);
  stop();
  process.exit(0);
} catch (error) {
  console.error(`SMOKE FAIL [${current || '启动'}] ${error?.message || error}`);
  stop();
  process.exit(1);
}
