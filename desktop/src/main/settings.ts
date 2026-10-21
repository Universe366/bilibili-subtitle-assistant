import { app, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AiPlatform,
  AsrPlatform,
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

const DEFAULT_CHAT_PROMPT = `你是一个严谨的中文视频助手。请只依据提供的字幕回答用户的问题。
- 字幕里没有的信息，明确说「字幕里没有提到」，不要编造。
- 回答用 Markdown，先给结论，再给依据。
- 引用字幕时尽量带上 [mm:ss]。`;

const DEFAULT_TRANSLATE_PROMPT = `你是专业字幕翻译。把用户给出的每条字幕翻译成指定目标语言。
要求：
- 保持原意，口语自然，不增删信息。
- 人名、产品名、专有名词保留原文或通用译名。
- 每条译文单独一行，顺序和条数必须与输入完全一致。
- 只输出 JSON：{"lines":["第1条译文","第2条译文"]}，不要 Markdown 代码块，不要解释。`;

const DEFAULT_OPTIMIZE_PROMPT = `你是严谨的字幕校对员。只修正错别字、同音字、标点、明显的 ASR 识别错误和专有名词写法。
要求：
- 不改变原意，不润色风格，不合并或拆分条目。
- 没有把握的地方保持原样。
- 输出 JSON：{"lines":["第1条修正后文本","第2条修正后文本"]}
- 条数必须与输入完全一致；不需要修改的行原样返回。
- 不要输出 Markdown 代码块，不要解释。`;

const DEFAULT_CHAPTERS_PROMPT = `你是视频章节编辑。根据字幕把视频划分为 3 到 12 个章节，覆盖开头到结尾。
要求：
- 每个章节标题简洁（不超过 20 字），能概括该时间段内容。
- 时间点尽量落在话题切换处。
- 只输出 JSON 数组：[{"start":0,"end":120,"title":"开场"}, ...]
- start/end 使用秒数，不要输出 Markdown 代码块或解释。`;

const DEFAULT_TEMPLATES: PromptTemplate[] = [  { id: 'default', name: '默认', text: DEFAULT_PROMPT },
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

const EXPORT_FORMATS: ExportFormat[] = ['md', 'srt', 'vtt', 'ass', 'txt', 'json'];
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
    templates: DEFAULT_TEMPLATES,
    chat: DEFAULT_CHAT_PROMPT,
    translate: DEFAULT_TRANSLATE_PROMPT,
    optimize: DEFAULT_OPTIMIZE_PROMPT,
    chapters: DEFAULT_CHAPTERS_PROMPT
  },
  asr: {
    activeId: 'siliconflow',
    platforms: [
      {
        id: 'siliconflow',
        name: '硅基流动（SiliconFlow）',
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: '',
        model: 'FunAudioLLM/SenseVoiceSmall'
      },
      {
        id: 'groq',
        name: 'Groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: '',
        model: 'whisper-large-v3-turbo'
      },
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'whisper-1'
      },
      {
        id: 'custom-asr',
        name: '自定义（OpenAI 兼容）',
        baseUrl: '',
        apiKey: '',
        model: ''
      }
    ],
    language: 'auto',
    chunkSeconds: 120,
    transport: 'auto',
    audioFormat: 'auto',
    concurrency: 1
  },
  mcp: {
    enabled: false,
    servers: []
  },
  skills: {
    enabled: true,
    items: [
      {
        id: 'skill_deep_summary',
        name: '深度总结',
        description: '按主题分节，给出要点、结论与时间轴',
        body:
          '请对本期视频做一份深度总结：\n' +
          '1. 先用一句话概括主题；\n' +
          '2. 再按内容分成 3~6 个主题小节，每节给 2~4 条要点；\n' +
          '3. 最后列出结论与「值得回看的片段」（用 mm:ss 标注时间）。',
        enabled: true,
        source: 'builtin'
      },
      {
        id: 'skill_qa_extract',
        name: '提取问答',
        description: '把视频里的问题与回答整理成问答对',
        body:
          '把视频内容整理成问答对：\n' +
          '- 只保留视频中明确提出的问题；\n' +
          '- 每个问题给出简洁回答，并标注对应时间点（mm:ss）；\n' +
          '- 没有明确答案的问题标注「视频未回答」。',
        enabled: false,
        source: 'builtin'
      }
    ]
  },
  search: {
    enabled: false,
    provider: 'exa',
    apiKey: '',
    maxResults: 5,
    includeContent: true,
    timeRange: 'any',
    verify: false
  },
  correction: {
    enabled: true,
    groups: [],
    glossary: {
      enabled: true,
      terms: []
    }
  },
  export: {
    format: 'md',
    includeTimestamps: true,
    filenamePattern: '{title}',
    template: 'timestamped',
    assFontSize: 28
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

    if (raw.asr && typeof raw.asr === 'object') {
      const asrIncoming = Array.isArray(raw.asr.platforms) ? raw.asr.platforms : [];
      if (asrIncoming.length) {
        const platforms: AsrPlatform[] = [];
        const seenAsr = new Set<string>();
        for (const item of asrIncoming) {
          if (!item || typeof item !== 'object') continue;
          const id = String(item.id || '').trim();
          if (!id || seenAsr.has(id)) continue;
          seenAsr.add(id);
          platforms.push({
            id,
            name: String(item.name || id),
            baseUrl: String(item.baseUrl || ''),
            apiKey: String(item.apiKey || ''),
            model: String(item.model || '')
          });
        }
        if (platforms.length) base.asr.platforms = platforms;
      }
      const asrActive = String(raw.asr.activeId || '');
      base.asr.activeId = base.asr.platforms.some((platform) => platform.id === asrActive)
        ? asrActive
        : base.asr.platforms[0].id;
      if (typeof raw.asr.language === 'string') base.asr.language = raw.asr.language.trim() || 'auto';
      const chunk = Number(raw.asr.chunkSeconds);
      if (Number.isFinite(chunk)) base.asr.chunkSeconds = Math.min(300, Math.max(30, Math.round(chunk)));
      const transports = ['auto', 'multipart', 'base64-json', 'chat-audio'];
      base.asr.transport = transports.includes(raw.asr.transport) ? raw.asr.transport : 'auto';
      const formats = ['auto', 'm4a', 'wav'];
      base.asr.audioFormat = formats.includes(raw.asr.audioFormat) ? raw.asr.audioFormat : 'auto';
      const concurrency = Number(raw.asr.concurrency);
      if (Number.isFinite(concurrency)) {
        base.asr.concurrency = Math.min(3, Math.max(1, Math.round(concurrency)));
      }
    }

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

    if (typeof raw.prompt?.chat === 'string' && raw.prompt.chat.trim()) {
      base.prompt.chat = raw.prompt.chat.trim();
    }
    if (typeof raw.prompt?.translate === 'string' && raw.prompt.translate.trim()) {
      base.prompt.translate = raw.prompt.translate.trim();
    }
    if (typeof raw.prompt?.optimize === 'string' && raw.prompt.optimize.trim()) {
      base.prompt.optimize = raw.prompt.optimize.trim();
    }
    if (typeof raw.prompt?.chapters === 'string' && raw.prompt.chapters.trim()) {
      base.prompt.chapters = raw.prompt.chapters.trim();
    }

    if (raw.export && typeof raw.export === 'object') {
      base.export.format = EXPORT_FORMATS.includes(raw.export.format) ? raw.export.format : 'md';
      base.export.includeTimestamps = raw.export.includeTimestamps !== false;
      const pattern = String(raw.export.filenamePattern || '').trim();
      base.export.filenamePattern = pattern || '{title}';
      const templates = ['plain', 'timestamped', 'notes', 'meeting'];
      base.export.template = templates.includes(raw.export.template)
        ? raw.export.template
        : 'timestamped';
      const fontSize = Number(raw.export.assFontSize);
      if (Number.isFinite(fontSize)) {
        base.export.assFontSize = Math.min(96, Math.max(12, Math.round(fontSize)));
      }
    }

    if (raw.mcp && typeof raw.mcp === 'object') {
      base.mcp.enabled = raw.mcp.enabled === true;
      if (Array.isArray(raw.mcp.servers)) {
        base.mcp.servers = raw.mcp.servers
          .filter((server: any) => server && typeof server === 'object' && String(server.id || '').trim())
          .map((server: any) => ({
            id: String(server.id),
            name: String(server.name || 'MCP 服务'),
            url: String(server.url || ''),
            token: String(server.token || ''),
            headers:
              server.headers && typeof server.headers === 'object'
                ? Object.fromEntries(
                    Object.entries(server.headers)
                      .filter(([key, value]) => key && value)
                      .map(([key, value]) => [String(key), String(value)])
                  )
                : {},
            enabled: server.enabled !== false,
            transport: server.transport === 'sse' ? 'sse' : 'http'
          }));
      }
    }

    if (raw.skills && typeof raw.skills === 'object') {
      base.skills.enabled = raw.skills.enabled !== false;
      if (Array.isArray(raw.skills.items)) {
        base.skills.items = raw.skills.items
          .filter((item: any) => item && typeof item === 'object' && String(item.id || '').trim())
          .map((item: any) => ({
            id: String(item.id),
            name: String(item.name || '未命名技能'),
            description: String(item.description || ''),
            body: String(item.body || ''),
            enabled: item.enabled !== false,
            source: ['builtin', 'manual', 'file'].includes(item.source) ? item.source : 'manual'
          }));
      }
    }

    if (raw.search && typeof raw.search === 'object') {
      base.search.enabled = raw.search.enabled === true;
      const providers = ['anysearch', 'exa', 'tavily', 'brave'];
      base.search.provider = providers.includes(raw.search.provider) ? raw.search.provider : 'exa';
      base.search.apiKey = String(raw.search.apiKey || '').trim();
      const maxResults = Number(raw.search.maxResults);
      if (Number.isFinite(maxResults)) {
        base.search.maxResults = Math.min(10, Math.max(1, Math.round(maxResults)));
      }
      base.search.includeContent = raw.search.includeContent !== false;
      const ranges = ['any', 'year', 'month', 'week'];
      base.search.timeRange = ranges.includes(raw.search.timeRange) ? raw.search.timeRange : 'any';
      base.search.verify = raw.search.verify === true;
    }

    if (raw.correction && typeof raw.correction === 'object') {
      base.correction.enabled = raw.correction.enabled !== false;
      const groups = Array.isArray(raw.correction.groups) ? raw.correction.groups : [];
      base.correction.groups = groups
        .filter((group: any) => group && typeof group === 'object' && String(group.id || '').trim())
        .map((group: any) => ({
          id: String(group.id),
          name: String(group.name || '规则组'),
          enabled: group.enabled !== false,
          rules: (Array.isArray(group.rules) ? group.rules : [])
            .filter((rule: any) => rule && typeof rule === 'object' && String(rule.id || '').trim())
            .map((rule: any) => ({
              id: String(rule.id),
              pattern: String(rule.pattern || ''),
              replacement: String(rule.replacement || ''),
              regex: rule.regex === true,
              caseSensitive: rule.caseSensitive === true
            }))
        }));

      const glossary = raw.correction.glossary;
      if (glossary && typeof glossary === 'object') {
        base.correction.glossary.enabled = glossary.enabled !== false;
        base.correction.glossary.terms = (Array.isArray(glossary.terms) ? glossary.terms : [])
          .filter((term: any) => term && typeof term === 'object' && String(term.id || '').trim())
          .map((term: any) => ({
            id: String(term.id),
            from: String(term.from || ''),
            to: String(term.to || ''),
            note: String(term.note || '')
          }));
      }
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
