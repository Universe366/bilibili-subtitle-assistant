// 模拟「浏览器插件 → 桌面端」的推送，验证桥协议。
// 用法：node spike/bridge-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const settingsPath =
  process.env.BSUB_BRIDGE_SETTINGS ||
  path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Electron', 'settings.json');

let settings = null;
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
} catch (error) {
  console.error('[bridge-test] 读不到设置文件:', settingsPath, error.message);
  process.exit(1);
}

const port = Number(settings?.bridge?.port) || 47821;
const token = String(settings?.bridge?.token || '');
if (!token) {
  console.error('[bridge-test] settings.json 里没有 bridge.token，先启动一次桌面端');
  process.exit(1);
}

const base = `http://127.0.0.1:${port}`;
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

const payload = {
  protocolVersion: 1,
  clientId: 'bridge-test',
  browserKind: 'chrome',
  extensionVersion: '2.16.2',
  video: {
    bvid: 'BV1TEST00001',
    cid: 999000001,
    title: '插件桥测试视频',
    owner: '测试 UP',
    duration: 120,
    url: 'https://www.bilibili.com/video/BV1TEST00001',
    cover: ''
  },
  track: {
    lan: 'zh-CN',
    lanDoc: '中文',
    source: 'extension-test',
    isAi: false,
    url: 'extension://bridge-test'
  },
  lines: [
    { start: 0, end: 1.5, text: '这是从插件推到桌面端的第一句。' },
    { start: 1.5, end: 3.2, text: '这是第二句，用来验证入库链路。' }
  ],
  summary: '## 桥接测试\n- 插件的字幕与总结已经写入桌面库。'
};

const health = await fetch(`${base}/v1/health`, { headers });
console.log('[bridge-test] health', health.status, await health.text());

const response = await fetch(`${base}/v1/ingest`, {
  method: 'POST',
  headers,
  body: JSON.stringify(payload)
});
console.log('[bridge-test] ingest', response.status, await response.text());

const unauthorized = await fetch(`${base}/v1/health`);
console.log('[bridge-test] unauthorized', unauthorized.status);
