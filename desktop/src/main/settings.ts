import { app, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AiPlatform, AppSettings, SettingsSnapshot } from '../shared/types';

const DEFAULT_PROMPT = `你是一个严谨的中文视频笔记助手。请只依据提供的字幕，输出 Markdown 格式的总结，包含：

## 一句话总结
用一句话概括视频讲了什么。

## 核心观点
- 3 到 6 条，按重要性排序。

## 章节脉络
- [mm:ss] 标题
按时间顺序梳理视频结构。

## 关键细节
- 值得记下的数字、结论、方法或观点。

要求：不要编造字幕里没有的信息；不确定的地方标注「不确定」。`;

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    activeId: 'deepseek',
    platforms: [
      {
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: '',
        model: 'deepseek-chat'
      },
      {
        id: 'siliconflow',
        name: '硅基流动',
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: '',
        model: 'deepseek-ai/DeepSeek-V3'
      },
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini'
      },
      {
        id: 'custom',
        name: '自定义（OpenAI 兼容）',
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: '',
        model: 'qwen2.5:7b'
      }
    ]
  },
  prompt: { summary: DEFAULT_PROMPT },
  bridge: { enabled: true, port: 47821, token: '' },
  dataDir: ''
};

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function normalize(raw: any): AppSettings {
  const base: AppSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  base.dataDir = app.getPath('userData');

  if (raw && typeof raw === 'object') {
    const prompt = raw.prompt && typeof raw.prompt.summary === 'string' ? raw.prompt.summary.trim() : '';
    if (prompt) base.prompt.summary = prompt;

    if (raw.bridge && typeof raw.bridge === 'object') {
      base.bridge.enabled = raw.bridge.enabled !== false;
      const port = Number(raw.bridge.port);
      if (Number.isFinite(port) && port >= 1024 && port <= 65535) base.bridge.port = Math.floor(port);
      base.bridge.token = typeof raw.bridge.token === 'string' ? raw.bridge.token : '';
    }

    const byId = new Map(base.ai.platforms.map((platform) => [platform.id, platform]));
    const incoming = Array.isArray(raw.ai?.platforms) ? raw.ai.platforms : [];
    for (const item of incoming) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || '').trim();
      if (!id) continue;
      byId.set(id, {
        id,
        name: String(item.name || id),
        baseUrl: String(item.baseUrl || ''),
        apiKey: String(item.apiKey || ''),
        model: String(item.model || '')
      });
    }
    base.ai.platforms = [...byId.values()];
    const active = String(raw.ai?.activeId || '');
    base.ai.activeId = base.ai.platforms.some((platform) => platform.id === active)
      ? active
      : base.ai.platforms[0].id;
  }

  return base;
}

export function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    return normalize(raw);
  } catch {
    return normalize(null);
  }
}

export function saveSettings(next: AppSettings): AppSettings {
  const normalized = normalize(next);
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

export function activePlatform(settings: AppSettings = loadSettings()): AiPlatform {
  return (
    settings.ai.platforms.find((platform) => platform.id === settings.ai.activeId) ||
    settings.ai.platforms[0]
  );
}

export function settingsSnapshot(): SettingsSnapshot {
  return {
    settings: loadSettings(),
    dataDir: app.getPath('userData'),
    version: app.getVersion()
  };
}

export async function testPlatform(platform: AiPlatform): Promise<{ latencyMs: number; message: string }> {
  if (!platform.baseUrl.trim()) throw new Error('请填写 Base URL');
  if (!platform.model.trim()) throw new Error('请填写模型名');
  if (!platform.apiKey.trim()) throw new Error('请填写 API Key');

  const base = platform.baseUrl.replace(/\/+$/, '');
  const started = Date.now();
  const response = await session.defaultSession.fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${platform.apiKey.trim()}`
    },
    body: JSON.stringify({
      model: platform.model.trim(),
      max_tokens: 4,
      stream: false,
      messages: [{ role: 'user', content: 'ping' }]
    })
  });
  const text = await response.text();
  const latencyMs = Date.now() - started;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}：${text.slice(0, 200)}`);
  }
  return { latencyMs, message: '连接成功' };
}
