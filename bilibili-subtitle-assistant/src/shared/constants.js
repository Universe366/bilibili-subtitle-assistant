// 共享常量：版本、消息协议、默认提示词、默认平台。
// 本文件被 service worker 与侧边栏同时以 ES module 方式引入。

export const VERSION = '1.40.0';

// 内容脚本声明的版本。扩展侧探测到版本不一致时重新注入（稳定性 #6）。
export const CONTENT_VERSION = VERSION;

export const APP_NAME = 'B站字幕助手';

// ---------------------------------------------------------------------------
// 消息协议
// ---------------------------------------------------------------------------

export const CHANNEL = {
  // 页面主环境 <-> 内容脚本（隔离环境）之间的 DOM 通道
  PAGE_DOM_ID: '__bsub_page_channel__',
  CONTENT_DOM_ID: '__bsub_content_channel__',
  DOM_EVENT: '__bsub_dom_event__',
  // 内容脚本 -> 后台
  FROM_CONTENT: 'bsub:content',
  // 后台 -> 内容脚本
  TO_CONTENT: 'bsub:to-content'
};

export const RPC = {
  KIND_REQ: 'rpc',
  KIND_RES: 'rpc:res',
  KIND_START: 'stream:start',
  KIND_DELTA: 'stream:delta',
  KIND_END: 'stream:end',
  KIND_ERROR: 'stream:error',
  KIND_LOG: 'stream:log',
  PORT_NAME: 'bsub-stream'
};

// 每个方法最大执行时间（毫秒），跨上下文请求一律带超时（第七章）。
export const METHOD_TIMEOUT = {
  'settings.get': 8000,
  'settings.set': 8000,
  'settings.reset': 8000,
  'platform.test': 45000,
  'platform.models': 30000,
  'permission.request': 120000,
  'page.info': 20000,
  'page.subtitles': 60000,
  'page.time': 8000,
  'page.seek': 8000,
  'page.call': 20000,
  'subtitle.fetch': 45000,
  'subtitle.cache.get': 8000,
  'subtitle.cache.put': 15000,
  'audio.head': 30000,
  'audio.chunk': 180000,
  // 语音识别：上一次真实请求要先把音频传上去（13MB 的 WAV 约需 30 秒），
  // 再由服务端转录，最后整段返回。**必须显著大于 HTTP 超时**，
  // 否则会出现「RPC 先超时、而 HTTP 其实还在跑」的假失败。
  'asr.transcribe': 600000,
  'asr.probe': 300000,
  // MCP：握手 + 列工具，或调用一个可能很慢的外部工具
  'mcp.probe': 60000,
  'mcp.tools': 60000,
  'ai.model': 30000,
  'search.provider': 60000,
  'search.fetch-page': 45000,
  'history.list': 8000,
  'history.get': 8000,
  'history.put': 8000,
  'history.remove': 8000,
  'history.clear': 8000,
  'cache.stats': 8000,
  'cache.clear': 15000,
  'diagnostics': 15000
};

export const DEFAULT_RPC_TIMEOUT = 30000;

// ---------------------------------------------------------------------------
// 默认系统提示词 —— 必须一字不差（第四章）
// ---------------------------------------------------------------------------

export const DEFAULT_SYSTEM_PROMPT =
  '整理这期视频的内容（可以用表格、代码块、高亮块、引用、超链接、公式、图片等飞书支持的格式输出，可以加上一些图标增加可读性）';

export const BILIBILI_LANGUAGES = [
  { code: 'zh-CN', label: '中文（简体）' },
  { code: 'zh-Hans', label: '中文（简体，AI）' },
  { code: 'ai-zh', label: '中文（自动生成）' },
  { code: 'zh-Hant', label: '中文（繁体）' },
  { code: 'ai-zh-Hant', label: '中文（繁体，自动生成）' },
  { code: 'en-US', label: '英语' },
  { code: 'ai-en', label: '英语（自动生成）' },
  { code: 'ja', label: '日语' },
  { code: 'ai-ja', label: '日语（自动生成）' }
];

export const SEARCH_ENGINES = [
  { id: 'bing', label: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  { id: 'google', label: 'Google', url: 'https://www.google.com/search?q=%s' },
  { id: 'baidu', label: '百度', url: 'https://www.baidu.com/s?wd=%s' },
  { id: 'duckduckgo', label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  { id: 'bilibili', label: 'B站搜索', url: 'https://search.bilibili.com/all?keyword=%s' }
];

export const EXPORT_FORMATS = [
  { id: 'srt', label: 'SRT', ext: 'srt' },
  { id: 'vtt', label: 'WebVTT', ext: 'vtt' },
  { id: 'ass', label: 'ASS', ext: 'ass' },
  { id: 'txt', label: 'TXT', ext: 'txt' },
  { id: 'md', label: 'Markdown', ext: 'md' },
  { id: 'json', label: 'JSON', ext: 'json' }
];

export const EXPORT_TEMPLATES = [
  { id: 'plain', label: '纯内容', desc: '只要字幕正文，不带时间戳' },
  { id: 'timed', label: '带时间戳', desc: '每行前加 [00:00:00] 时间标记' },
  { id: 'study', label: '学习笔记', desc: '带章节与要点的小标题结构' },
  { id: 'meeting', label: '会议纪要', desc: '按参会/议题/决议/待办组织' }
];

// 进度条必须显示任务名 + 百分比（第七章）
export const TASK_LABEL = {
  harvest: '字幕抓取',
  transcribe: '语音转录',
  download: '音轨下载',
  decode: '音频解码',
  summarize: 'AI 总结',
  chat: 'AI 对话',
  optimize: '字幕优化',
  quality: '质量自检',
  chapters: '章节分段',
  search: '联网检索',
  batch: '批量处理'
};

// 语音识别分片默认参数（2.2）
// 分片长度对齐参考实现 Bilitato：DEFAULT_ASR_CHUNK_SECONDS = 600、MIN = 45、
// 体积安全系数 0.72。分片越少越好 —— 每多一片就多一次网络请求与一次失败机会，
// 而 415s 这类常见时长在 600s 分片下只需要 1 片。
export const ASR_LIMITS = {
  minSliceSeconds: 45,
  maxSliceSeconds: 600,
  defaultSliceSeconds: 600,
  overlapSeconds: 4,
  retryFactor: 0.7,
  maxRetries: 3,
  sizeSafetyRatio: 0.72,
  defaultSizeLimitMB: 50,
  targetRate: 16000,
  defaultTimeoutSeconds: 180,
  defaultConcurrency: 1
};

// 字幕时长校验分档（2.1）
export function minCoverageRatio(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  if (durationSeconds >= 600) return 0.18;
  if (durationSeconds >= 300) return 0.22;
  if (durationSeconds >= 180) return 0.25;
  // 极短视频不设覆盖度门限，避免误杀
  return 0.15;
}

export const OVERRUN_RATIO = 0.15; // 超出视频时长 15%
export const OVERRUN_MIN_SECONDS = 12; // 且至少 12 秒

export const VIDEO_PAGE_TYPES = {
  video: '普通视频页',
  list: '列表页',
  bangumi: '番剧播放页',
  collection: '合集播放页'
};
