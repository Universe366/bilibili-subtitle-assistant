import { app, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AiPlatform,
  AppSettings,
  ExportFormat,
  PromptTemplate,
  SettingsSnapshot,
  ThemeMode
} from '../shared/types';

export const DEFAULT_PROMPT = `你是一个严谨的中文视频笔记助手。请只依据提供的字幕，输出 Markdown 格式的总结，包含：

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

const DEFAULT_TEMPLATES: PromptTemplate[] = [
  { id: 'default', name: '默认', text: DEFAULT_PROMPT },
  {
    id: 'brief',
    name: '精简',
    text: '用 Markdown 输出简洁总结，最多 5 条要点，总字数控制在 300 字以内。只依据字幕，不要编造；不确定的地方标注「不确定」。'
  },
  {
    id: 'detailed',
    name: '详细',
    text: `输出一份详细学习笔记，Markdown 格式，包含：
## 一句话总结
## 核心观点（3-8 条）
## 章节脉络（带 [mm:ss] 时间戳）
## 关键细节与数据
## 术语解释
## 可行动建议
只依据字幕，不要编造；不确定的地方标注「不确定」。`
  }
];

const EXPORT_FORMATS: ExportFormat[] = ['md', 'srt', 'txt', 'json'];
const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    theme: 'system',
    closeToTray: true,
    suspendMinutes: 5
  },
  ai: {
    activeId: 'deepseek',
    temperature: 0.3,
    maxTokens: 8192,
    stream: true,
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
  prompt: {
    activeId: 'default',
    templates: DEFAULT_TEMPLATES
  },
  export: {
    format: 'md',
    includeTimestamps: true,
    filenamePattern: '{title}'
  },
  bridge: { enabled: true, port: 47821, token: '' },
  update: { autoCheck: false, feedUrl: '' },
  dataDir: ''
};

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function normalize(raw: any): AppSettings {
  const base: AppSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  base.dataDir = app.getPath('userData');

  if (raw && typeof raw === 'object') {
    if (raw.general && typeof raw.general === 'object') {
      const theme = raw.general.theme;
      base.general.theme = THEME_MODES.includes(theme) ? theme : 'system';
      base.general.closeToTray = raw.general.closeToTray !== false;
      const minutes = Number(raw.general.suspendMinutes);
      if (Number.isFinite(minutes)) {
        base.general.suspendMinutes = Math.min(120, Math.max(1, Math.round(minutes)));
      }
    }

    const incoming = Array.isArray(raw.ai?.platforms) ? raw.ai.platforms : [];
    if (incoming.length) {
      // 有配置就按配置走：删除内置平台后不能又被默认值加回来。
      const platforms: AiPlatform[] = [];
      const seen = new Set<string>();
      for (const item of incoming) {
        if (!item || typeof item !== 'object') continue;
        const id = String(item.id || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        platforms.push({
          id,
          name: String(item.name || id),
          baseUrl: String(item.baseUrl || ''),
          apiKey: String(item.apiKey || ''),
          model: String(item.model || '')
        });
      }
      if (platforms.length) base.ai.platforms = platforms;
    }
    const active = String(raw.ai?.activeId || '');
    base.ai.activeId = base.ai.platforms.some((platform) => platform.id === active)
      ? active
      : base.ai.platforms[0].id;

    const temperature = Number(raw.ai?.temperature);
    if (Number.isFinite(temperature)) {
      base.ai.temperature = Math.min(2, Math.max(0, Math.round(temperature * 100) / 100));
    }
    const maxTokens = Number(raw.ai?.maxTokens);
    if (Number.isFinite(maxTokens)) {
      base.ai.maxTokens = Math.min(64000, Math.max(256, Math.round(maxTokens)));
    }
    base.ai.stream = raw.ai?.stream !== false;

    const templates: PromptTemplate[] = [];
    const rawTemplates = Array.isArray(raw.prompt?.templates) ? raw.prompt.templates : [];
    for (const item of rawTemplates) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || '').trim();
      if (!id) continue;
      templates.push({
        id,
        name: String(item.name || id),
        text: String(item.text || '')
      });
    }
    if (templates.length) {
      base.prompt.templates = templates;
      const promptActive = String(raw.prompt?.activeId || '');
      base.prompt.activeId = templates.some((template) => template.id === promptActive)
        ? promptActive
        : templates[0].id;
    } else if (typeof raw.prompt?.summary === 'string' && raw.prompt.summary.trim()) {
      // 旧版本只有单条 prompt.summary，迁移成默认模板。
      base.prompt.templates = [{ id: 'default', name: '默认', text: raw.prompt.summary.trim() }];
      base.prompt.activeId = 'default';
    }

    if (raw.export && typeof raw.export === 'object') {
      base.export.format = EXPORT_FORMATS.includes(raw.export.format) ? raw.export.format : 'md';
      base.export.includeTimestamps = raw.export.includeTimestamps !== false;
      const pattern = String(raw.export.filenamePattern || '').trim();
      base.export.filenamePattern = pattern || '{title}';
    }

    if (raw.bridge && typeof raw.bridge === 'object') {
      base.bridge.enabled = raw.bridge.enabled !== false;
      const port = Number(raw.bridge.port);
      if (Number.isFinite(port) && port >= 1024 && port <= 65535) base.bridge.port = Math.floor(port);
      base.bridge.token = typeof raw.bridge.token === 'string' ? raw.bridge.token : '';
    }

    if (raw.update && typeof raw.update === 'object') {
      base.update.autoCheck = raw.update.autoCheck !== false;
      base.update.feedUrl = typeof raw.update.feedUrl === 'string' ? raw.update.feedUrl.trim() : '';
    }
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

export function activePrompt(settings: AppSettings = loadSettings()): PromptTemplate {
  return (
    settings.prompt.templates.find((template) => template.id === settings.prompt.activeId) ||
    settings.prompt.templates[0] ||
    { id: 'default', name: '默认', text: DEFAULT_PROMPT }
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
