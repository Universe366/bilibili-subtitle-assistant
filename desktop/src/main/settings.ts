import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AiPlatform,
  AsrPlatform,
  AppSettings,
  ExportFormat,
  PromptTemplate,
  SearchPlatform,
  SettingsSnapshot,
  ThemeMode
} from '../shared/types';
import { AI_PRESETS, AI_PRESET_VERSION, ASR_PRESETS, SEARCH_PRESETS } from '../shared/presets';
import { testAiConnection } from './aiClient';
import { isSealedSecret, openSecret, sealSecret, canEncrypt } from './secrets';

export const DEFAULT_PROMPT =
  '整理这期视频的内容（可以用表格、代码块、高亮块、引用、超链接、公式、图片等飞书支持的格式输出，可以加上一些图标增加可读性）';

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

const DEFAULT_TEMPLATES: PromptTemplate[] = [
  { id: 'default', name: '默认（视频整理）', text: DEFAULT_PROMPT },
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

const AI_PRESET_ALIASES: Record<string, string> = {
  siliconflow: 'siliconflow-ai',
  custom: 'custom-ai'
};

function aiPresetFor(id: string): (typeof AI_PRESETS)[number] | undefined {
  const target = AI_PRESET_ALIASES[id] || id;
  return AI_PRESETS.find((preset) => preset.id === target);
}

const EXPORT_FORMATS: ExportFormat[] = ['md', 'srt', 'vtt', 'ass', 'txt', 'json'];
const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    theme: 'system',
    closeToTray: true,
    suspendMinutes: 5,
    cacheSubtitles: true,
    subtitleCacheDays: 30,
    fontScale: 1,
    sidebarWidth: 320,
    sidebarPosition: 'left',
    sidebarCollapsed: false,
    autoFollow: true,
    wizardDone: false,
    restoreSession: true,
    selectionToolbar: true,
    searchEngine: 'bilibili',
    searchEngineCustom: ''
  },
  ai: {
    activeId: 'deepseek',
    temperature: 0.3,
    maxTokens: 64000,
    stream: true,
    preProofread: false,
    sendOnEnter: true,
    expandReasoning: false,
    appTools: true,
    presetVersion: AI_PRESET_VERSION,
    platforms: AI_PRESETS.map((platform) => ({
      ...platform,
      models: [...(platform.models || [])]
    }))
  },
  asr: {
    activeId: 'siliconflow',
    platforms: ASR_PRESETS.map((platform) => ({
      ...platform,
      models: [...(platform.models || [])]
    })),
    language: 'auto',
    // 与插件对齐：分片越少越好（每多一片就多一次请求与失败机会），
    // 415s 这类常见时长在 600s 下只需 1 片；并发 4 路。
    chunkSeconds: 600,
    transport: 'auto',
    audioFormat: 'auto',
    concurrency: 4,
    timeoutSeconds: 180,
    maxFileMb: 50,
    overlapSeconds: 4,
    autoOptimizeAfter: false,
    autoApplyAfter: false
  },
  mcp: {
    enabled: false,
    servers: [],
    callTimeoutMs: 60000,
    maxToolRounds: 6
  },
  skills: {
    enabled: true,
    builtinVersion: 2,
    items: [
      {
        id: 'skill_deep_summary',
        name: '深度总结',
        description: '按主题分节，给出要点、结论与时间轴',
        icon: '📝',
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
        icon: '💬',
        body:
          '把视频内容整理成问答对：\n' +
          '- 只保留视频中明确提出的问题；\n' +
          '- 每个问题给出简洁回答，并标注对应时间点（mm:ss）；\n' +
          '- 没有明确答案的问题标注「视频未回答」。',
        enabled: false,
        source: 'builtin'
      },
      {
        id: 'skill_glossary',
        name: '术语表',
        description: '抽取专有名词并给出一句话解释',
        icon: '📚',
        body:
          '从本期视频中抽取所有专有名词、缩写与产品名，输出 Markdown 表格：' +
          '| 术语 | 一句话解释 | 首次出现(mm:ss) |',
        enabled: true,
        source: 'builtin'
      },
      {
        id: 'skill_timeline',
        name: '时间轴',
        description: '生成章节化的时间轴目录',
        icon: '🧭',
        body:
          '为本期视频生成章节时间轴，输出 Markdown 列表，每行形如 ' +
          '`mm:ss 章节标题 — 一句话说明`，章节数量控制在 6~12 个。',
        enabled: true,
        source: 'builtin'
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
  search: {
    enabled: true,
    activeId: 'exa',
    platforms: SEARCH_PRESETS.map((platform) => ({ ...platform })),
    maxResults: 5,
    includeContent: true,
    timeRange: 'any',
    verify: false,
    verifySummary: true,
    verifyItemCount: 12,
    keylessFallback: true,
    keylessOrder: ['exa', 'anysearch'],
    cacheMinutes: 5,
    autoSearchOnChat: false,
    alwaysSearchOnChat: false,
    useVideoMeta: true,
    useComments: true,
    aiQueryGeneration: true,
    extraVerifyQueries: ''
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
    assFontSize: 28,
    estimateTimestamps: true
  },
  bridge: { enabled: true, port: 47821, token: '' },
  update: { autoCheck: true, autoDownload: false, feedUrl: '', skippedVersion: '' },
  dataDir: ''
};

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

type SettingsWithLegacyFields = AppSettings & {
  prompt: AppSettings['prompt'] & { summary?: string };
  search: AppSettings['search'] & { provider?: string; apiKey?: string };
};

function normalize(input: unknown): AppSettings {
  const raw = (input || {}) as SettingsWithLegacyFields;
  const base: AppSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  base.dataDir = app.getPath('userData');

  if (raw && typeof raw === 'object') {
    if (raw.general && typeof raw.general === 'object') {
      const theme = raw.general.theme;
      base.general.theme = THEME_MODES.includes(theme) ? theme : 'system';
      base.general.closeToTray = raw.general.closeToTray !== false;
      base.general.cacheSubtitles = raw.general.cacheSubtitles !== false;
      const cacheDays = Number(raw.general.subtitleCacheDays);
      if (Number.isFinite(cacheDays)) {
        base.general.subtitleCacheDays = Math.min(365, Math.max(0, Math.round(cacheDays)));
      }
      const fontScale = Number(raw.general.fontScale);
      if (Number.isFinite(fontScale)) {
        base.general.fontScale = Math.min(1.6, Math.max(0.8, Math.round(fontScale * 100) / 100));
      }
      const sidebarWidth = Number(raw.general.sidebarWidth);
      if (Number.isFinite(sidebarWidth)) {
        base.general.sidebarWidth = Math.min(560, Math.max(260, Math.round(sidebarWidth)));
      }
      base.general.sidebarPosition = raw.general.sidebarPosition === 'right' ? 'right' : 'left';
      base.general.sidebarCollapsed = raw.general.sidebarCollapsed === true;
      base.general.autoFollow = raw.general.autoFollow !== false;
      base.general.wizardDone = raw.general.wizardDone === true;
      base.general.restoreSession = raw.general.restoreSession !== false;
      base.general.selectionToolbar = raw.general.selectionToolbar !== false;
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
        const preset = aiPresetFor(id);
        platforms.push({
          id,
          name: String(item.name || preset?.name || id),
          baseUrl: String(item.baseUrl || preset?.baseUrl || ''),
          apiKey: String(item.apiKey || ''),
          model: String(item.model || preset?.model || ''),
          models:
            Array.isArray(item.models) && item.models.length
              ? item.models.map(String)
              : [...(preset?.models || [])],
          homepage: String(item.homepage || preset?.homepage || ''),
          keyUrl: String(item.keyUrl || preset?.keyUrl || ''),
          kind: String(item.kind || preset?.kind || '')
        });
      }
      if (platforms.length) base.ai.platforms = platforms;
    }
    const active = String(raw.ai?.activeId || '');
    base.ai.activeId = base.ai.platforms.some((platform) => platform.id === active)
      ? active
      : base.ai.platforms[0].id;

    const presetVersion = Number(raw.ai?.presetVersion) || 0;
    if (presetVersion < AI_PRESET_VERSION) {
      for (const preset of AI_PRESETS) {
        const exists = base.ai.platforms.some(
          (item) => item.id === preset.id || AI_PRESET_ALIASES[item.id] === preset.id
        );
        if (!exists) {
          base.ai.platforms.push({
            ...preset,
            models: [...(preset.models || [])]
          });
        }
      }
    }
    base.ai.presetVersion = AI_PRESET_VERSION;

    const temperature = Number(raw.ai?.temperature);
    if (Number.isFinite(temperature)) {
      base.ai.temperature = Math.min(2, Math.max(0, Math.round(temperature * 100) / 100));
    }
    const maxTokens = Number(raw.ai?.maxTokens);
    if (Number.isFinite(maxTokens)) {
      base.ai.maxTokens = Math.min(64000, Math.max(256, Math.round(maxTokens)));
    }
    base.ai.stream = raw.ai?.stream !== false;
    base.ai.preProofread = raw.ai?.preProofread === true;
    base.ai.sendOnEnter = raw.ai?.sendOnEnter !== false;
    base.ai.appTools = raw.ai?.appTools !== false;
    base.ai.expandReasoning = raw.ai?.expandReasoning === true;

    if (raw.asr && typeof raw.asr === 'object') {
      // 旧默认值（120s / 1 并发 / 20MB / 120s 超时）是历史遗留：
      // 与插件对齐后应迁移到 600s / 4 并发 / 50MB / 180s。
      // 只有四项都仍是旧默认值时才迁移，用户手动改过的配置不动。
      const legacyAsrDefaults =
        Number(raw.asr.chunkSeconds) === 120 &&
        Number(raw.asr.concurrency) === 1 &&
        Number(raw.asr.maxFileMb) === 20 &&
        Number(raw.asr.timeoutSeconds) === 120;
      const asrIncoming = Array.isArray(raw.asr.platforms) ? raw.asr.platforms : [];
      if (asrIncoming.length) {
        const platforms: AsrPlatform[] = [];
        const seenAsr = new Set<string>();
        for (const item of asrIncoming) {
          if (!item || typeof item !== 'object') continue;
          const id = String(item.id || '').trim();
          if (!id || seenAsr.has(id)) continue;
          seenAsr.add(id);
          const preset = ASR_PRESETS.find((candidate) => candidate.id === id);
          platforms.push({
            id,
            name: String(item.name || id),
            baseUrl: String(item.baseUrl || preset?.baseUrl || ''),
            apiKey: String(item.apiKey || ''),
            model: String(item.model || preset?.model || ''),
            models: Array.isArray(item.models)
              ? item.models.map(String)
              : [...(preset?.models || [])],
            homepage: String(item.homepage || preset?.homepage || ''),
            keyUrl: String(item.keyUrl || preset?.keyUrl || ''),
            transport: item.transport || preset?.transport || 'multipart',
            paramStyle: item.paramStyle || preset?.paramStyle || 'auto',
            audioFormat: item.audioFormat || preset?.audioFormat || 'auto',
            keyField: String(item.keyField || preset?.keyField || 'file')
          });
        }
        if (platforms.length) base.asr.platforms = platforms;
      }
      const asrActive = String(raw.asr.activeId || '');
      base.asr.activeId = base.asr.platforms.some((platform) => platform.id === asrActive)
        ? asrActive
        : base.asr.platforms[0].id;
      if (typeof raw.asr.language === 'string')
        base.asr.language = raw.asr.language.trim() || 'auto';
      const chunk = Number(raw.asr.chunkSeconds);
      if (Number.isFinite(chunk))
        base.asr.chunkSeconds = Math.min(600, Math.max(45, Math.round(chunk)));
      const transports = ['auto', 'multipart', 'base64-json', 'chat-audio'];
      base.asr.transport = transports.includes(raw.asr.transport) ? raw.asr.transport : 'auto';
      const formats = ['auto', 'm4a', 'wav'];
      base.asr.audioFormat = formats.includes(raw.asr.audioFormat) ? raw.asr.audioFormat : 'auto';
      const concurrency = Number(raw.asr.concurrency);
      if (Number.isFinite(concurrency)) {
        base.asr.concurrency = Math.min(8, Math.max(1, Math.round(concurrency)));
      }
      const timeout = Number(raw.asr.timeoutSeconds);
      if (Number.isFinite(timeout)) {
        base.asr.timeoutSeconds = Math.min(1800, Math.max(30, Math.round(timeout)));
      }
      const maxFileMb = Number(raw.asr.maxFileMb);
      if (Number.isFinite(maxFileMb)) {
        base.asr.maxFileMb = Math.min(100, Math.max(1, Math.round(maxFileMb)));
      }
      const overlap = Number(raw.asr.overlapSeconds);
      if (Number.isFinite(overlap)) {
        base.asr.overlapSeconds = Math.min(30, Math.max(0, Math.round(overlap)));
      }
      base.asr.autoOptimizeAfter = raw.asr.autoOptimizeAfter === true;
      base.asr.autoApplyAfter = raw.asr.autoApplyAfter === true;
      if (legacyAsrDefaults) {
        base.asr.chunkSeconds = 600;
        base.asr.concurrency = 4;
        base.asr.maxFileMb = 50;
        base.asr.timeoutSeconds = 180;
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
      const defaultTemplate = templates.find((template) => template.id === 'default');
      if (defaultTemplate && /^你是一个严谨的中文视频笔记助手/.test(defaultTemplate.text.trim())) {
        defaultTemplate.text = DEFAULT_PROMPT;
        defaultTemplate.name = '默认（视频整理）';
      }
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
      base.export.estimateTimestamps = raw.export.estimateTimestamps !== false;
    }

    if (raw.mcp && typeof raw.mcp === 'object') {
      base.mcp.enabled = raw.mcp.enabled === true;
      const callTimeout = Number(raw.mcp.callTimeoutMs);
      if (Number.isFinite(callTimeout)) {
        base.mcp.callTimeoutMs = Math.min(300000, Math.max(5000, Math.round(callTimeout)));
      }
      const maxRounds = Number(raw.mcp.maxToolRounds);
      if (Number.isFinite(maxRounds)) {
        base.mcp.maxToolRounds = Math.min(12, Math.max(1, Math.round(maxRounds)));
      }
      if (Array.isArray(raw.mcp.servers)) {
        base.mcp.servers = raw.mcp.servers
          .filter(
            (server) => server && typeof server === 'object' && String(server.id || '').trim()
          )
          .map((server) => ({
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
          .filter((item) => item && typeof item === 'object' && String(item.id || '').trim())
          .map((item) => ({
            id: String(item.id),
            name: String(item.name || '未命名技能'),
            description: String(item.description || ''),
            body: String(item.body || ''),
            icon: String(item.icon || '✨'),
            enabled: item.enabled !== false,
            source: ['builtin', 'manual', 'file'].includes(item.source) ? item.source : 'manual'
          }));
      }
      // 新增内置技能时补进老配置；版本号避免用户删掉后又被加回来。
      const skillsVersion = Number(raw.skills.builtinVersion) || 0;
      if (skillsVersion < 2) {
        for (const builtin of DEFAULT_SETTINGS.skills.items) {
          if (!base.skills.items.some((item) => item.id === builtin.id)) {
            base.skills.items.push({ ...builtin });
          }
        }
      }
      base.skills.builtinVersion = 2;
    }

    if (raw.search && typeof raw.search === 'object') {
      base.search.enabled = raw.search.enabled === undefined ? true : raw.search.enabled === true;

      let platforms: SearchPlatform[] = [];
      if (Array.isArray(raw.search.platforms)) {
        const seen = new Set<string>();
        for (const item of raw.search.platforms) {
          if (!item || typeof item !== 'object') continue;
          const id = String(item.id || '').trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          platforms.push({
            id,
            name: String(item.name || id),
            kind: String(item.kind || 'custom'),
            baseUrl: String(item.baseUrl || ''),
            apiKey: String(item.apiKey || ''),
            homepage: String(item.homepage || ''),
            keyUrl: String(item.keyUrl || ''),
            reuseAiKey: String(item.reuseAiKey || '')
          });
        }
      }

      if (!platforms.length) {
        platforms = SEARCH_PRESETS.map((platform) => ({ ...platform }));
        const legacyId = String(raw.search.provider || '').trim();
        const hit = platforms.find(
          (platform) => platform.id === legacyId || platform.kind === legacyId
        );
        if (hit) {
          if (raw.search.apiKey) hit.apiKey = String(raw.search.apiKey || '').trim();
          base.search.activeId = hit.id;
        }
      }
      if (platforms.length) base.search.platforms = platforms;

      const activeId = String(raw.search.activeId || '');
      base.search.activeId = base.search.platforms.some((platform) => platform.id === activeId)
        ? activeId
        : base.search.platforms[0].id;

      const maxResults = Number(raw.search.maxResults);
      if (Number.isFinite(maxResults)) {
        base.search.maxResults = Math.min(10, Math.max(1, Math.round(maxResults)));
      }
      base.search.includeContent = raw.search.includeContent !== false;
      const ranges = ['any', 'year', 'month', 'week'];
      base.search.timeRange = ranges.includes(raw.search.timeRange) ? raw.search.timeRange : 'any';
      base.search.verify = raw.search.verify === true;
      base.search.verifySummary = raw.search.verifySummary !== false;
      base.search.verifyItemCount = Math.max(
        1,
        Math.min(20, Number(raw.search.verifyItemCount) || 12)
      );
      base.search.keylessFallback = raw.search.keylessFallback !== false;
      const keylessOrder = Array.isArray(raw.search.keylessOrder)
        ? raw.search.keylessOrder
            .map((item) =>
              String(item || '')
                .trim()
                .toLowerCase()
            )
            .filter((item) => ['exa', 'anysearch', 'searxng'].includes(item))
        : [];
      base.search.keylessOrder = keylessOrder.length
        ? [...new Set<string>(keylessOrder)]
        : ['exa', 'anysearch'];
      const cacheMinutes = Number(raw.search.cacheMinutes);
      if (Number.isFinite(cacheMinutes)) {
        base.search.cacheMinutes = Math.min(60, Math.max(0, Math.round(cacheMinutes)));
      }
      base.search.autoSearchOnChat = raw.search.autoSearchOnChat === true;
      base.search.alwaysSearchOnChat = raw.search.alwaysSearchOnChat === true;
      base.search.useVideoMeta = raw.search.useVideoMeta !== false;
      base.search.useComments =
        raw.search.useComments === undefined ? true : raw.search.useComments === true;
      base.search.aiQueryGeneration = raw.search.aiQueryGeneration !== false;
      if (typeof raw.search.extraVerifyQueries === 'string') {
        base.search.extraVerifyQueries = raw.search.extraVerifyQueries.slice(0, 4000);
      }
    }

    if (raw.correction && typeof raw.correction === 'object') {
      base.correction.enabled = raw.correction.enabled !== false;
      const groups = Array.isArray(raw.correction.groups) ? raw.correction.groups : [];
      base.correction.groups = groups
        .filter((group) => group && typeof group === 'object' && String(group.id || '').trim())
        .map((group) => ({
          id: String(group.id),
          name: String(group.name || '规则组'),
          enabled: group.enabled !== false,
          rules: (Array.isArray(group.rules) ? group.rules : [])
            .filter((rule) => rule && typeof rule === 'object' && String(rule.id || '').trim())
            .map((rule) => ({
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
          .filter((term) => term && typeof term === 'object' && String(term.id || '').trim())
          .map((term) => ({
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
      if (Number.isFinite(port) && port >= 1024 && port <= 65535)
        base.bridge.port = Math.floor(port);
      base.bridge.token = typeof raw.bridge.token === 'string' ? raw.bridge.token : '';
    }

    if (raw.update && typeof raw.update === 'object') {
      base.update.autoCheck = raw.update.autoCheck !== false;
      base.update.autoDownload = raw.update.autoDownload === true;
      base.update.skippedVersion = String(raw.update.skippedVersion || '').trim();
      base.update.feedUrl = typeof raw.update.feedUrl === 'string' ? raw.update.feedUrl.trim() : '';
    }
  }

  return base;
}

function eachPlatform(
  settings: AppSettings,
  visit: (platform: { apiKey: string }, group: 'ai' | 'asr' | 'search') => void
): void {
  for (const platform of settings.ai.platforms) visit(platform, 'ai');
  for (const platform of settings.asr.platforms) visit(platform, 'asr');
  for (const platform of settings.search.platforms) visit(platform, 'search');
}

/** 磁盘 → 内存：DPAPI 密文解成明文；老版本明文原样返回。 */
function openSecrets(settings: AppSettings): AppSettings {
  eachPlatform(settings, (platform) => {
    platform.apiKey = openSecret(platform.apiKey);
  });
  return settings;
}

/** 内存 → 磁盘：只加密非空 Key；已经封装的不要重复加密。 */
function sealSecrets(settings: AppSettings): AppSettings {
  const clone: AppSettings = JSON.parse(JSON.stringify(settings));
  eachPlatform(clone, (platform) => {
    platform.apiKey = sealSecret(platform.apiKey);
  });
  return clone;
}

/** 导出/诊断/备份用：Key 与桥 Token 一律置空，导入时保留本机原值。 */
export function stripSecrets(settings: AppSettings): AppSettings {
  const clone: AppSettings = JSON.parse(JSON.stringify(settings));
  eachPlatform(clone, (platform) => {
    platform.apiKey = '';
  });
  clone.bridge.token = '';
  return clone;
}

export function settingsForExport(): AppSettings {
  return stripSecrets(loadSettings());
}

/**
 * 启动时把老版本的明文 Key 原地加密。
 * 只在确实存在明文 Key 时写盘，避免每次启动都重写 settings.json。
 */
export function migrateSettingsSecrets(): number {
  try {
    // 系统没有可用 keyring 时保持明文，不要每次启动都重写文件。
    if (!canEncrypt()) return 0;
    // 首次启动还没有 settings.json，属于正常情况，不要打错误日志。
    if (!fs.existsSync(settingsFile())) return 0;
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    const groups = [raw?.ai?.platforms, raw?.asr?.platforms, raw?.search?.platforms];
    let plaintext = 0;
    for (const group of groups) {
      if (!Array.isArray(group)) continue;
      for (const platform of group) {
        const key = String(platform?.apiKey || '');
        if (key && !isSealedSecret(key)) plaintext += 1;
      }
    }
    if (!plaintext) return 0;
    saveSettings(loadSettings());
    console.log(`[settings] 已加密 ${plaintext} 个 API Key`);
    return plaintext;
  } catch (error) {
    console.warn('[settings] Key 加密迁移失败:', (error as Error).message);
    return 0;
  }
}

/**
 * 从备份恢复设置：备份里的 Key 是空的，合并时保留本机现有 Key，
 * 避免「恢复一份备份把 API Key 清空」。
 */
export function restoreSettingsFromBackup(raw: unknown): AppSettings {
  const current = loadSettings();
  const incoming = normalize(raw);
  return saveSettings(mergeSecrets(incoming, current));
}

export function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    return openSecrets(normalize(raw));
  } catch {
    return openSecrets(normalize(null));
  }
}

function maskSecret(value: string): string {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 6) return '••••';
  return `••••${text.slice(-4)}`;
}

export function isMaskedSecret(value: string): boolean {
  return /^••••/.test(String(value || ''));
}

function maskSettings(settings: AppSettings): AppSettings {
  const clone: AppSettings = JSON.parse(JSON.stringify(settings));
  for (const platform of clone.ai.platforms) platform.apiKey = maskSecret(platform.apiKey);
  for (const platform of clone.asr.platforms) platform.apiKey = maskSecret(platform.apiKey);
  for (const platform of clone.search.platforms) platform.apiKey = maskSecret(platform.apiKey);
  return clone;
}

const CLEAR_SECRET = '__CLEAR__';

function resolveSecret(incoming: string, current: string): string {
  if (incoming === CLEAR_SECRET) return '';
  if (!incoming || isMaskedSecret(incoming)) return current || '';
  return incoming;
}

function mergeSecrets(next: AppSettings, current: AppSettings): AppSettings {
  const merged: AppSettings = JSON.parse(JSON.stringify(next));
  for (const platform of merged.ai.platforms) {
    platform.apiKey = resolveSecret(
      platform.apiKey,
      current.ai.platforms.find((item) => item.id === platform.id)?.apiKey || ''
    );
  }
  for (const platform of merged.asr.platforms) {
    platform.apiKey = resolveSecret(
      platform.apiKey,
      current.asr.platforms.find((item) => item.id === platform.id)?.apiKey || ''
    );
  }
  for (const platform of merged.search.platforms) {
    platform.apiKey = resolveSecret(
      platform.apiKey,
      current.search.platforms.find((item) => item.id === platform.id)?.apiKey || ''
    );
  }
  return merged;
}

export function setSidebarWidth(width: number): AppSettings {
  return setSidebarLayout({ width });
}

export function setSidebarLayout(patch: {
  width?: number;
  position?: 'left' | 'right';
  collapsed?: boolean;
}): AppSettings {
  const settings = loadSettings();
  if (Number.isFinite(Number(patch.width))) {
    settings.general.sidebarWidth = Math.min(560, Math.max(260, Math.round(Number(patch.width))));
  }
  if (patch.position === 'left' || patch.position === 'right') {
    settings.general.sidebarPosition = patch.position;
  }
  if (typeof patch.collapsed === 'boolean') {
    settings.general.sidebarCollapsed = patch.collapsed;
  }
  return saveSettings(settings);
}

export function saveSettings(next: AppSettings): AppSettings {
  const normalized = normalize(mergeSecrets(next, loadSettings()));
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(sealSecrets(normalized), null, 2), 'utf8');
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
    settings.prompt.templates[0] || { id: 'default', name: '默认', text: DEFAULT_PROMPT }
  );
}

export function settingsSnapshot(): SettingsSnapshot {
  return {
    settings: maskSettings(loadSettings()),
    dataDir: app.getPath('userData'),
    version: app.getVersion()
  };
}

export async function testPlatform(
  platform: AiPlatform
): Promise<{ latencyMs: number; message: string }> {
  return testAiConnection(platform);
}
