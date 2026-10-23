import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 桌面端冒烟：启动真实 Electron、连 CDP、验证壳与 IPC 基本可用。
 *
 * 用法：npm run smoke
 * 依赖：本机 Electron 二进制、图形会话（Windows 直接跑；Linux 需要 xvfb）。
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
        reject(new Error(JSON.stringify(message.result.exceptionDetails)));
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

try {
  const target = await waitForTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  const title = await evaluate(ws, 'document.title');
  if (title !== '拾字') throw new Error(`窗口标题异常：${title}`);

  const api = await evaluate(ws, 'typeof window.bsub');
  if (api !== 'object') throw new Error('preload API 未注入');

  const snapshot = JSON.parse(
    await evaluate(ws, 'window.bsub.getSettings().then((r) => JSON.stringify(r))')
  );
  if (!snapshot.ok) throw new Error(`getSettings 失败：${snapshot.error}`);
  if (snapshot.data.version !== pkg.version) {
    throw new Error(`版本不一致：${snapshot.data.version} != ${pkg.version}`);
  }

  const tabs = JSON.parse(
    await evaluate(ws, 'window.bsub.listTabs().then((list) => JSON.stringify(list))')
  );
  if (!Array.isArray(tabs) || tabs.length === 0) throw new Error('没有打开的标签页');

  ws.close();
  console.log(`SMOKE OK title=${title} version=${pkg.version} tabs=${tabs.length}`);
  stop();
  process.exit(0);
} catch (error) {
  console.error('SMOKE FAIL', error?.message || error);
  stop();
  process.exit(1);
}
