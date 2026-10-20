// 默认配置。仅存 chrome.storage.local —— API Key 绝不同步到其它设备（3.3）。
import { DEFAULT_SYSTEM_PROMPT, ASR_LIMITS } from './constants.js';

export function newId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// AI 平台
// ---------------------------------------------------------------------------

export function defaultAiPlatforms() {
  return [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      homepage: 'https://platform.deepseek.com/',
      keyUrl: 'https://platform.deepseek.com/api_keys',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: '',
      models: ['deepseek-chat', 'deepseek-reasoner']
    },
    {
      id: 'siliconflow-ai',
      name: '硅基流动（AI）',
      homepage: 'https://cloud.siliconflow.cn/',
      keyUrl: 'https://cloud.siliconflow.cn/account/ak',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen3-8B',
      apiKey: '',
      models: ['Qwen/Qwen3-8B', 'deepseek-ai/DeepSeek-V3']
    },
    {
      id: 'openai',
      name: 'OpenAI',
      homepage: 'https://platform.openai.com/',
      keyUrl: 'https://platform.openai.com/api-keys',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: '',
      models: ['gpt-4o-mini', 'gpt-4o']
    },
    {
      id: 'anthropic',
      name: 'Anthropic Claude',
      homepage: 'https://www.anthropic.com/',
      keyUrl: 'https://console.anthropic.com/settings/keys',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-4-5',
      apiKey: '',
      models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-5-haiku-latest']
    },
    {
      id: 'groq',
      name: 'Groq',
      homepage: 'https://groq.com/',
      keyUrl: 'https://console.groq.com/keys',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      apiKey: '',
      models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']
    },
    // ---- 以下内置平台对齐 Cherry Studio 的 provider 清单 ----
    // 所有 baseUrl 都用 curl 实测过（无 Key 时返回 401/403 即证明地址正确）。
    // 模型 id 只是**种子值**，请用「选择模型」从各平台的 /models 拉取真实列表覆盖。
    {
      id: 'dashscope',
      name: '阿里云百炼（DashScope）',
      homepage: 'https://bailian.console.aliyun.com/',
      keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      apiKey: '',
      models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen3-max']
    },
    {
      id: 'moonshot',
      name: 'Moonshot（Kimi）',
      homepage: 'https://platform.moonshot.cn/',
      keyUrl: 'https://platform.moonshot.cn/console/api-keys',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'moonshot-v1-8k',
      apiKey: '',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
    },
    {
      id: 'zhipu',
      name: '智谱 GLM',
      homepage: 'https://open.bigmodel.cn/',
      keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-flash',
      apiKey: '',
      models: ['glm-4-flash', 'glm-4-plus', 'glm-4-air']
    },
    {
      id: 'zai',
      name: 'Z.ai（智谱国际站）',
      homepage: 'https://z.ai/',
      keyUrl: 'https://z.ai/manage-apikey/apikey-list',
      baseUrl: 'https://api.z.ai/api/paas/v4',
      model: 'glm-4.5',
      apiKey: '',
      models: ['glm-4.5', 'glm-4.5-air']
    },
    {
      id: 'hunyuan',
      name: '腾讯混元',
      homepage: 'https://cloud.tencent.com/product/hunyuan',
      keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
      baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
      model: 'hunyuan-turbos-latest',
      apiKey: '',
      models: ['hunyuan-turbos-latest', 'hunyuan-large', 'hunyuan-standard']
    },
    {
      id: 'tencent-lkeap',
      name: '腾讯云 TI（LKEAP）',
      homepage: 'https://cloud.tencent.com/product/lkeap',
      keyUrl: 'https://console.cloud.tencent.com/lkeap',
      baseUrl: 'https://api.lkeap.cloud.tencent.com/v1',
      model: 'deepseek-v3',
      apiKey: '',
      models: ['deepseek-v3', 'deepseek-r1']
    },
    {
      id: 'doubao',
      name: '字节豆包（火山方舟）',
      homepage: 'https://www.volcengine.com/product/ark',
      keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-pro-32k',
      apiKey: '',
      models: ['doubao-pro-32k', 'doubao-pro-128k', 'doubao-lite-32k']
    },
    {
      id: 'baichuan',
      name: '百川智能',
      homepage: 'https://www.baichuan-ai.com/',
      keyUrl: 'https://platform.baichuan-ai.com/console/apikey',
      baseUrl: 'https://api.baichuan-ai.com/v1',
      model: 'Baichuan4',
      apiKey: '',
      models: ['Baichuan4', 'Baichuan3-Turbo', 'Baichuan3-Turbo-128k']
    },
    {
      id: 'stepfun',
      name: '阶跃星辰 StepFun',
      homepage: 'https://platform.stepfun.com/',
      keyUrl: 'https://platform.stepfun.com/interface-key',
      baseUrl: 'https://api.stepfun.com/v1',
      model: 'step-1-8k',
      apiKey: '',
      models: ['step-1-8k', 'step-1-32k', 'step-1-flash']
    },
    {
      id: 'minimax',
      name: 'MiniMax',
      homepage: 'https://www.minimaxi.com/',
      keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
      baseUrl: 'https://api.minimax.chat/v1',
      model: 'abab6.5s-chat',
      apiKey: '',
      models: ['abab6.5s-chat', 'abab6.5-chat']
    },
    {
      id: 'baidu-qianfan',
      name: '百度千帆',
      homepage: 'https://qianfan.cloud.baidu.com/',
      keyUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list',
      baseUrl: 'https://qianfan.baidubce.com/v2',
      model: 'ernie-4.0-turbo-8k',
      apiKey: '',
      models: ['ernie-4.0-turbo-8k', 'ernie-4.0-8k', 'ernie-speed-128k']
    },
    {
      id: 'infini',
      name: '无问芯穹 Infini',
      homepage: 'https://cloud.infini-ai.com/',
      keyUrl: 'https://cloud.infini-ai.com/iam/ak',
      baseUrl: 'https://cloud.infini-ai.com/maas/v1',
      model: 'deepseek-v3',
      apiKey: '',
      models: ['deepseek-v3', 'deepseek-r1']
    },
    {
      id: 'ppio',
      name: 'PPIO 派欧云',
      homepage: 'https://ppio.com/',
      keyUrl: 'https://ppio.com/settings/key-management',
      baseUrl: 'https://api.ppinfra.com/v3/openai',
      model: 'deepseek/deepseek-v3',
      apiKey: '',
      models: ['deepseek/deepseek-v3', 'deepseek/deepseek-r1']
    },
    {
      id: 'modelscope',
      name: '魔搭 ModelScope',
      homepage: 'https://modelscope.cn/',
      keyUrl: 'https://modelscope.cn/my/myaccesstoken',
      baseUrl: 'https://api-inference.modelscope.cn/v1',
      model: 'Qwen/Qwen2.5-7B-Instruct',
      apiKey: '',
      models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3']
    },
    {
      id: 'longcat',
      name: 'LongCat（美团）',
      homepage: 'https://longcat.chat/',
      keyUrl: 'https://longcat.chat/platform/api_keys',
      baseUrl: 'https://api.longcat.chat/openai/v1',
      model: 'LongCat-Flash-Chat',
      apiKey: '',
      models: ['LongCat-Flash-Chat', 'LongCat-Flash-Thinking']
    },
    {
      id: 'mimo',
      name: '小米 MiMo',
      homepage: 'https://xiaomimimo.com/',
      keyUrl: 'https://xiaomimimo.com/',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-7b-rl',
      apiKey: '',
      models: ['mimo-7b-rl']
    },
    {
      id: 'xai',
      name: 'xAI Grok',
      homepage: 'https://x.ai/',
      keyUrl: 'https://console.x.ai/',
      baseUrl: 'https://api.x.ai/v1',
      model: 'grok-2-latest',
      apiKey: '',
      models: ['grok-2-latest', 'grok-beta']
    },
    {
      id: 'gemini',
      name: 'Google Gemini（OpenAI 兼容）',
      homepage: 'https://ai.google.dev/',
      keyUrl: 'https://aistudio.google.com/app/apikey',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.0-flash',
      apiKey: '',
      models: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro']
    },
    {
      id: 'mistral',
      name: 'Mistral',
      homepage: 'https://mistral.ai/',
      keyUrl: 'https://console.mistral.ai/api-keys/',
      baseUrl: 'https://api.mistral.ai/v1',
      model: 'mistral-large-latest',
      apiKey: '',
      models: ['mistral-large-latest', 'mistral-small-latest', 'open-mistral-nemo']
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      homepage: 'https://openrouter.ai/',
      keyUrl: 'https://openrouter.ai/keys',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-4o-mini',
      apiKey: '',
      models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'google/gemini-flash-1.5']
    },
    {
      id: 'together',
      name: 'Together AI',
      homepage: 'https://www.together.ai/',
      keyUrl: 'https://api.together.xyz/settings/api-keys',
      baseUrl: 'https://api.together.xyz/v1',
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      apiKey: '',
      models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo']
    },
    {
      // 基元律动（TokenRhythm）：一个 Key 打通 DeepSeek / GLM / Qwen / Kimi /
      // MiniMax / MiMo / 豆包 Seed / LongCat 等多家模型，走 OpenAI 兼容协议。
      //
      // 关键事实（对照 https://tokenrhythm.studio/docs/api-integration 核实）：
      //   · 统一基础地址 https://tokenrhythm.studio/v1，
      //     POST /v1/chat/completions（标准 OpenAI 字段）、GET /v1/models
      //   · 鉴权 Authorization: Bearer sk_xxx（Key 形如 sk_tr_...）
      //   · 错误信封是自家格式 { code, message, traceId }，不是 OpenAI 的
      //     { error: {...} } —— errors.js 的 errorEnvelope() 专门负责把它读成人话
      //   · 不支持未知请求字段（多传一个 thinking 就 400 UNKNOWN_FIELD），
      //     所以 aiBody() 只能发 model / messages / temperature / max_tokens / stream
      //   · 支持 tools / tool_choice，但 DeepSeek 系只接受 none|auto|required 字符串，
      //     不能传 { type: 'auto' } 对象
      //   · 网关会对「来自浏览器上下文」的请求做 CSRF 校验：带 Origin / Sec-Fetch-Site
      //     的请求直接 403 CSRF_INVALID，而 curl（不带这些头）同一把 Key 完全正常。
      //     所以这里打开 stripBrowserHeaders，由 background/header-rules.js 用
      //     declarativeNetRequest 把这三类头从我们自己的请求里摘掉
      //     （CherryHQ/cherry-studio#18362 是同一现象的独立报告）。
      // 模型清单取自模型页内嵌目录（type=chat 且 status=online 的条目），
      // 用户点「刷新模型列表」会重新向 /v1/models 拉取当前账号真正可用的清单。
      id: 'tokenrhythm',
      name: '基元律动（TokenRhythm）',
      homepage: 'https://tokenrhythm.studio/',
      keyUrl: 'https://tokenrhythm.studio/account',
      baseUrl: 'https://tokenrhythm.studio/v1',
      stripBrowserHeaders: true,
      model: 'deepseek-v4-flash-0731',
      apiKey: '',
      models: [
        'deepseek-v4-flash-0731',
        'deepseek-v4.1-flash-1017',
        'deepseek-v4-pro-0813',
        'glm-5.3',
        'glm-5.2',
        'qwen3.8-max',
        'qwen3.7-max',
        'kimi-k2.6',
        'minimax-m2.7',
        'mimo-v2.5-pro',
        'longcat-2.0',
        'seed-2.1-pro'
      ]
    },
    {
      id: 'custom-ai',
      name: '自定义（OpenAI 兼容）',
      homepage: '',
      keyUrl: '',
      baseUrl: '',
      model: '',
      apiKey: '',
      models: []
    }
  ];
}

// ---------------------------------------------------------------------------
// 语音识别平台（默认：硅基流动）
// ---------------------------------------------------------------------------

export function defaultAsrPlatforms() {
  return [
    {
      id: 'siliconflow',
      name: '硅基流动（SiliconFlow）',
      homepage: 'https://cloud.siliconflow.cn/',
      keyUrl: 'https://cloud.siliconflow.cn/account/ak',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'FunAudioLLM/SenseVoiceSmall',
      // 硅基流动只接受 multipart/form-data，且只认 file + model 两个字段
      // （官方参数表即如此；多传 response_format / language 会 400）
      transport: 'multipart',
      paramStyle: 'minimal',
      // 上传格式**按模型决定**（实测结论，见 transcribe.js 的 audioFormatFor）：
      //   SenseVoiceSmall 只吃 M4A（发 WAV 会 500）
      //   XingChenGSR / TeleSpeechASR 只吃 WAV（发 M4A 会 400）
      // 这里只是平台默认值；一旦用户换成 XingChenGSR，会自动切回 WAV。
      audioFormat: 'm4a',
      apiKey: '',
      keyField: 'file',
      models: [
        // 唯一实测**会返回时间戳**的模型（segments 带 start/end/speaker）。
        // 想要字幕与视频精确对齐就用它。注意它只接受 WAV。
        'XingChenAGI/XingChenASR-Diarize-V3.0',
        // 只返回纯文本（无时间戳）→ 字幕时间只能估算
        'FunAudioLLM/SenseVoiceSmall',
        // Bilitato 默认用它，只返回纯文本
        'XingChenAGI/XingChenGSR-V1.0',
        'TeleAI/TeleSpeechASR'
      ]
    },    {
      id: 'groq',
      name: 'Groq',
      homepage: 'https://groq.com/',
      keyUrl: 'https://console.groq.com/keys',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'whisper-large-v3-turbo',
      transport: 'multipart',
      paramStyle: 'full',
      apiKey: '',
      keyField: 'file',
      models: ['whisper-large-v3-turbo', 'whisper-large-v3', 'distil-whisper-large-v3-en']
    },
    {
      id: 'custom-asr',
      name: '自定义（OpenAI 兼容 /audio/transcriptions）',
      homepage: '',
      keyUrl: '',
      baseUrl: '',
      model: '',
      transport: 'multipart',
      paramStyle: 'auto',
      apiKey: '',
      keyField: 'file',
      models: []
    }
  ];
}

// ---------------------------------------------------------------------------
// 检索平台（第六章）
// ---------------------------------------------------------------------------

export function defaultSearchPlatforms() {
  return [
    {
      id: 'deepseek-search',
      name: 'DeepSeek 搜索（官方，推荐）',
      homepage: 'https://api-docs.deepseek.com/guides/search/',
      keyUrl: 'https://platform.deepseek.com/api_keys',
      baseUrl: 'https://api.deepseek.com/v1/tools/search',
      apiKey: '',
      kind: 'deepseek-search',
      // 复用 AI 平台里的 DeepSeek Key（同一把 Key），用户不用再填一遍
      reuseAiKey: 'deepseek',
      models: []
    },
    {
      id: 'tavily',
      name: 'Tavily',
      homepage: 'https://tavily.com/',
      keyUrl: 'https://app.tavily.com/home',
      baseUrl: 'https://api.tavily.com/search',
      apiKey: '',
      kind: 'tavily',
      models: []
    },
    {
      id: 'bocha',
      name: '博查 Bocha',
      homepage: 'https://open.bochaai.com/',
      keyUrl: 'https://open.bochaai.com/',
      baseUrl: 'https://api.bochaai.com/v1/web-search',
      apiKey: '',
      kind: 'bocha',
      models: []
    },
    {
      id: 'serper',
      name: 'Serper（Google）',
      homepage: 'https://serper.dev/',
      keyUrl: 'https://serper.dev/api-key',
      baseUrl: 'https://google.serper.dev/search',
      apiKey: '',
      kind: 'serper',
      models: []
    },
    // ---- 以下对齐 Cherry Studio 的搜索 provider 清单 ----
    // baseUrl 实测：无 Key 时 401/405 即证明地址正确。
    {
      id: 'zhipu-web',
      name: '智谱 Web 搜索（国内，推荐）',
      homepage: 'https://open.bigmodel.cn/',
      keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4/web_search',
      apiKey: '',
      kind: 'zhipu',
      models: []
    },
    {
      id: 'metaso',
      name: '秘塔搜索（国内）',
      homepage: 'https://metaso.cn/',
      keyUrl: 'https://metaso.cn/settings/api',
      baseUrl: 'https://metaso.cn/api/v1/search',
      apiKey: '',
      kind: 'metaso',
      models: []
    },
    {
      id: 'baidu-ai-search',
      name: '百度千帆 AI 搜索（国内）',
      homepage: 'https://qianfan.cloud.baidu.com/',
      keyUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list',
      baseUrl: 'https://qianfan.baidubce.com/v2/ai_search/web_search',
      apiKey: '',
      kind: 'baidu',
      models: []
    },
    {
      id: 'brave',
      name: 'Brave Search',
      homepage: 'https://brave.com/search/api/',
      keyUrl: 'https://api-dashboard.search.brave.com/app/keys',
      baseUrl: 'https://api.search.brave.com/res/v1/web/search',
      apiKey: '',
      kind: 'brave',
      models: []
    },
    {
      id: 'exa',
      name: 'Exa（语义搜索）',
      homepage: 'https://exa.ai/',
      keyUrl: 'https://dashboard.exa.ai/api-keys',
      baseUrl: 'https://api.exa.ai/search',
      apiKey: '',
      kind: 'exa',
      models: []
    },
    {
      id: 'jina-search',
      name: 'Jina 搜索 + 正文提取',
      homepage: 'https://jina.ai/',
      keyUrl: 'https://jina.ai/api-dashboard/',
      baseUrl: 'https://s.jina.ai/',
      apiKey: '',
      kind: 'jina',
      models: []
    },
    {
      id: 'searxng',
      name: 'SearXNG（自建 / 免 Key）',
      homepage: 'https://docs.searxng.org/',
      keyUrl: '',
      baseUrl: 'https://searx.be/search',
      apiKey: '',
      kind: 'searxng',
      models: []
    },
    {
      id: 'custom-search',
      name: '自定义搜索接口',
      homepage: '',
      keyUrl: '',
      baseUrl: '',
      apiKey: '',
      kind: 'custom',
      models: []
    }
  ];
}

export function defaultPrompts() {
  return [
    { id: 'default', name: '默认（视频整理）', text: DEFAULT_SYSTEM_PROMPT },
    {
      id: 'meeting',
      name: '会议纪要',
      text: '把这段视频整理成会议纪要：先写一句话结论，再按「议题 / 讨论要点 / 结论 / 待办（含负责人）」输出，用表格呈现待办。'
    },
    {
      id: 'study',
      name: '学习笔记',
      text: '把这段视频整理成学习笔记：先给知识框架，再逐条讲解关键概念，补充定义、例子与易错点，最后给出 5 道自测题。'
    },
    {
      id: 'timeline',
      name: '时间线与要点',
      text: '按时间顺序输出这期视频的要点时间线（表格：时间 / 主题 / 关键内容），并单独列出所有提到的数字、结论与行动建议。'
    }
  ];
}

export function defaultRuleGroups() {
  return [
    {
      id: 'builtin-fix',
      name: '常见同音字修正',
      builtin: true,
      rules: [
        { from: '因该', to: '应该' },
        { from: '在座的各位', to: '在座的各位' },
        { from: '的的', to: '的' }
      ]
    }
  ];
}

export function defaultSettings() {
  return {
    schema: 1,
    general: {
      theme: 'system', // system | light | dark
      fontScale: 1,
      layout: 'one', // one（默认：单列堆叠）| two | auto（仅窄屏才单列）
      autoFollow: true,
      showInlineActions: 'hover',
      firstRun: true,
      wizardDone: false,
      lastTab: 'subtitles'
    },
    ai: {
      activeId: 'deepseek',
      platforms: defaultAiPlatforms(),
      temperature: 0.3,
      maxTokens: 8192,
      stream: true,
      // 思维链默认折叠。推理模型（deepseek-reasoner 等）的思考过程动辄上千字，
      // 默认展开会把最终回答挤出屏幕。
      expandReasoning: false,
      // 回车行为：true = 回车发送、Shift+回车换行（默认，聊天框习惯）
      //           false = 回车换行、Ctrl/Cmd+回车发送（写长消息更方便）
      sendOnEnter: true
    },
    asr: {
      activeId: 'siliconflow',
      platforms: defaultAsrPlatforms(),
      concurrency: ASR_LIMITS.defaultConcurrency,
      timeoutSeconds: ASR_LIMITS.defaultTimeoutSeconds,
      sizeLimitMB: ASR_LIMITS.defaultSizeLimitMB,
      sliceSeconds: ASR_LIMITS.defaultSliceSeconds,
      overlapSeconds: ASR_LIMITS.overlapSeconds,
      autoOptimizeAfter: false, // 默认关闭
      autoApplyAfter: false, // 默认关闭
      // （原始音轨复用那条实验路径已按用户要求移除）
    },
    prompt: {
      activeId: 'default',
      templates: defaultPrompts(),
      chatPrefix: '只依据下面的字幕内容回答，不要编造。'
    },
    optimize: {
      activeGroupId: 'builtin-fix',
      groups: defaultRuleGroups(),
      glossary: [
        { term: 'DeepSeek', note: 'AI 公司 / 模型名' },
        { term: 'Bilibili', note: '哔哩哔哩' }
      ],
      useSearch: false,
      searchMaxResults: 3
    },
    search: {
      // 默认用 DeepSeek 官方搜索：它复用 AI 平台的 DeepSeek Key，
      // 自带重排分数、权威度、发布时间与 600~800 字摘要，比免费引擎更适合当模型依据。
      // 没配 DeepSeek Key 时仍会自动落到免费引擎兜底。
      activeId: 'deepseek-search',
      platforms: defaultSearchPlatforms(),
      engine: 'bing',
      maxResults: 6,
      // 默认开启抓取正文：只给 AI 搜索摘要效果有限，
      // 把网页正文一起喂进去，总结/核对质量明显更好（代价是慢一些）。
      fetchPageContent: true,
      // 对话时自动联网检索：
      //   autoSearchOnChat —— 问题里出现「最新/是谁/多少钱/查一下」等外部信息需求时自动检索
      //   alwaysSearchOnChat —— 每一轮对话都检索（更准但更慢、更耗额度）
      autoSearchOnChat: true,
      alwaysSearchOnChat: false,
      // 免费无 Key 引擎兜底：没配检索 Key 时也能真的联网
      // （Bing 网页 / AnySearch / Exa MCP 均已实测可用）
      keylessFallback: true,
      // 默认时间范围：'' / day / week / month / year，或自定义 3d / 2w / 2026-01-01
      // 注意：免费引擎实测无法按时间过滤；要严格生效需配置支持该能力的检索平台
      timeRange: '',
      // 自定义免费引擎优先顺序（空 = 用默认顺序）
      keylessOrder: [],
      // 结果缓存时长（分钟，0 = 关闭）。
      // 免费引擎有限流、付费引擎按次计费，缓存能同时缓解两者。
      cacheMinutes: 5,
      // 生成总结前**主动联网核实**：用视频标题+字幕关键句检索一次，
      // 把网页资料交给模型去校正字幕里的事实性错误（用户明确要的「多方求证」）。
      verifyOnSummary: true,
      // 每次从字幕里抽多少条去核实。12 条覆盖更广，但更慢、也更容易消耗检索额度。
      verifyItemCount: 12
    },
    // 总结的附加上下文：视频简介、热门评论
    summary: {
      useVideoMeta: true,
      // 评论默认关闭 —— 需要多跑一次接口，且评论区噪声较大，让用户自己决定
      useComments: false
    },
    exportCfg: {
      format: 'srt',
      template: 'timed',
      includeTimestamps: true,
      estimateTimestamps: true,
      assFontSize: 42,
      filenamePattern: '{title}-{part}'
    },
    page: {
      playerButton: true,
      playerButtonPrompt: '总结这个视频的要点',
      overlay: false,
      overlayFontScale: 1,
      overlayBottom: 8,
      followPlayback: true
    },
    behavior: {
      preferOfficial: true,
      useLocalCache: true
    },
    batch: {
      autoExport: false,
      pauseBetween: 800
    },
    cache: {
      subtitleTtlDays: 30
    },
    diagnostics: {
      verbose: false
    },
    update: {
      autoCheck: true
    },
    // ---- MCP 服务：给模型接上「手和脚」 ----
    // 浏览器无法起 stdio 子进程，所以只支持 HTTP 与 SSE 两种远程传输。
    mcp: {
      enabled: false,
      servers: [],
      callTimeoutMs: 60000,
      maxToolRounds: 6
    },
    // ---- Skills：可复用的提示词 / 工作流 ----
    skills: {
      enabled: true,
      items: [
        {
          id: 'skill_deep_summary',
          name: '深度总结',
          icon: '📝',
          desc: '按主题分节，给出要点、结论与时间轴',
          source: 'builtin',
          body:
            '请对本期视频做一份深度总结：\n' +
            '1. 先用一句话概括主题；\n' +
            '2. 再按内容分成 3~6 个主题小节，每节给 2~4 条要点；\n' +
            '3. 最后列出结论与「值得回看的片段」（用 mm:ss 标注时间）。'
        },
        {
          id: 'skill_qa_extract',
          name: '提取问答',
          icon: '❓',
          desc: '把视频里的问题与回答整理成问答对',
          source: 'builtin',
          body:
            '把本期视频中出现的问题与回答整理成问答对，格式为：\n' +
            '**Q：** …\n**A：** …\n' +
            '只保留有明确答案的问题；回答尽量用视频里的原话，并在末尾标注 mm:ss。'
        },
        {
          id: 'skill_glossary',
          name: '术语表',
          icon: '📚',
          desc: '抽取专有名词并给出一句话解释',
          source: 'builtin',
          body: '从本期视频中抽取所有专有名词、缩写与产品名，输出 Markdown 表格：| 术语 | 一句话解释 | 首次出现(mm:ss) |'
        },
        {
          id: 'skill_timeline',
          name: '时间轴',
          icon: '🧭',
          desc: '生成章节化的时间轴目录',
          source: 'builtin',
          body: '为本期视频生成章节时间轴，输出 Markdown 列表，每行形如 `mm:ss 章节标题 — 一句话说明`，章节数量控制在 6~12 个。'
        }
      ]
    }
  };
}

// ---------------------------------------------------------------------------
// 深合并 / 掩码
// ---------------------------------------------------------------------------

export function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out = { ...base };
  for (const key of Object.keys(patch)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const pv = patch[key];
    const bv = base[key];
    if (isPlainObject(pv) && isPlainObject(bv)) {
      out[key] = deepMerge(bv, pv);
    } else {
      out[key] = pv;
    }
  }
  return out;
}

export function migrateSettings(raw) {
  const def = defaultSettings();
  const merged = deepMerge(def, isPlainObject(raw) ? raw : {});
  // 分片策略升级：默认从 300s 提到 600s（对齐参考实现）。
  // 只把「恰好等于旧默认值 300」的配置迁移过来，用户手动设过的其它值不动。
  if (merged.asr && Number(merged.asr.sliceSeconds) === 300) {
    merged.asr.sliceSeconds = def.asr.sliceSeconds;
  }
  if (merged.asr && Number(merged.asr.sizeLimitMB) === 24) {
    merged.asr.sizeLimitMB = def.asr.sizeLimitMB;
  }
  // 输出上限升级：默认 4096 → 8192。
  // 4096 写详细总结容易被截断。只迁移「恰好等于旧默认值」的配置，
  // 用户手动设过的其它值不动。
  if (merged.ai && Number(merged.ai.maxTokens) === 4096) {
    merged.ai.maxTokens = def.ai.maxTokens;
  }
  // 保底：默认提示词必须存在
  if (!Array.isArray(merged.prompt.templates) || merged.prompt.templates.length === 0) {
    merged.prompt.templates = defaultPrompts();
    merged.prompt.activeId = 'default';
  }
  if (!merged.prompt.templates.some((t) => t.id === 'default')) {
    merged.prompt.templates.unshift(defaultPrompts()[0]);
  }
  const hadDefault = merged.prompt.templates.find((t) => t.id === 'default');
  if (hadDefault && !hadDefault.text) hadDefault.text = DEFAULT_SYSTEM_PROMPT;
  if (!Array.isArray(merged.ai.platforms) || !merged.ai.platforms.length) {
    merged.ai.platforms = defaultAiPlatforms();
  } else {
    merged.ai.platforms = mergeBuiltinPlatforms(merged.ai.platforms, defaultAiPlatforms());
  }
  if (!Array.isArray(merged.asr.platforms) || !merged.asr.platforms.length) {
    merged.asr.platforms = defaultAsrPlatforms();
  } else {
    merged.asr.platforms = mergeBuiltinPlatforms(merged.asr.platforms, defaultAsrPlatforms());
  }
  if (!Array.isArray(merged.search.platforms) || !merged.search.platforms.length) {
    merged.search.platforms = defaultSearchPlatforms();
  } else {
    merged.search.platforms = mergeBuiltinPlatforms(merged.search.platforms, defaultSearchPlatforms());
  }
  return merged;
}

// 把「新增的内置平台」补进用户已有配置里。
//
// 为什么需要：早期迁移只在 platforms 为空时才填默认值，
// 于是后来新增的内置平台（例如从 4 个搜索平台扩到 11 个）
// **对已安装用户永远不可见** —— 用户会发现「更新了却看不到新东西」。
//
// 规则（必须保守，绝不能覆盖用户数据）：
//   · 用户已有的条目原样保留（含其 apiKey / model / baseUrl 等一切修改）
//   · 只追加「按 id 不存在于用户配置」的内置条目，且以空白模板加入
//   · 不改变顺序：已有的在前，新追加的在后
export function mergeBuiltinPlatforms(existing, defaults) {
  const list = Array.isArray(existing) ? existing : [];
  const have = new Set(list.map((p) => String((p && p.id) || '')));
  const additions = (Array.isArray(defaults) ? defaults : [])
    .filter((p) => p && p.id && !have.has(String(p.id)))
    .map((p) => ({ ...p, apiKey: '' }));
  return additions.length ? [...list, ...additions] : list;
}

export function maskSecret(key) {
  const s = String(key || '');
  if (!s) return '';
  if (s.length <= 4) return '••••';
  return `••••••••${s.slice(-4)}`;
}

export function hasSecret(key) {
  return String(key || '').trim().length > 0;
}

// 密钥留空表示「不改动」（3.3）。
// 注意：字段名必须与存储结构一致，这里显式解析，避免误存掩码值。
const SECRET_PATHS = [
  ['ai', 'platforms'],
  ['asr', 'platforms'],
  ['search', 'platforms']
];

export function stripSecrets(settings) {
  const clone = JSON.parse(JSON.stringify(settings));
  for (const [group, listKey] of SECRET_PATHS) {
    const list = clone?.[group]?.[listKey];
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      p.apiKey = maskSecret(p.apiKey);
      p.apiKeySet = hasSecret(settings?.[group]?.[listKey]?.find?.((x) => x.id === p.id)?.apiKey);
      // 内部标记不应该出现在界面数据里
      delete p.apiKeyClear;
    }
  }
  return clone;
}

// 把界面提交的（可能带掩码/留空的）密钥合并进已存储配置。
export function mergeSecrets(incoming, stored) {
  const out = JSON.parse(JSON.stringify(incoming));
  for (const [group, listKey] of SECRET_PATHS) {
    const inList = out?.[group]?.[listKey];
    const stList = stored?.[group]?.[listKey] || [];
    if (!Array.isArray(inList)) continue;
    for (const p of inList) {
      const st = stList.find((x) => x.id === p.id);
      // 显式「清除」：空字符串本身表示「不改动」，所以必须有一个单独的标记，
      // 否则点「清除」保存后旧 Key 会被 mergeSecrets 原样保留回来。
      if (p.apiKeyClear === true) {
        p.apiKey = '';
        delete p.apiKeyClear;
        delete p.apiKeySet;
        continue;
      }
      const submitted = p.apiKey;
      const looksMasked = typeof submitted === 'string' && submitted.includes('•');
      if (looksMasked || submitted === undefined) {
        p.apiKey = st ? st.apiKey : '';
      } else if (String(submitted || '').trim() === '') {
        // 留空保存 = 不改动
        p.apiKey = st ? st.apiKey : '';
      } else {
        p.apiKey = String(submitted).trim();
      }
      delete p.apiKeySet;
    }
  }
  return out;
}

export function activeAi(settings) {
  return (settings.ai.platforms || []).find((p) => p.id === settings.ai.activeId) || null;
}

export function activeAsr(settings) {
  return (settings.asr.platforms || []).find((p) => p.id === settings.asr.activeId) || null;
}

export function activeSearch(settings) {
  return (settings.search.platforms || []).find((p) => p.id === settings.search.activeId) || null;
}

export function activePrompt(settings) {
  return (
    (settings.prompt.templates || []).find((t) => t.id === settings.prompt.activeId) ||
    (settings.prompt.templates || [])[0] ||
    null
  );
}

// 配置状态常驻提示（第七章）：明确告诉用户「为什么现在不能用」。
export function computeReadiness(settings) {
  const ai = activeAi(settings);
  const asr = activeAsr(settings);
  const prompt = activePrompt(settings);
  const issues = [];
  const ok = {};

  if (!ai) {
    issues.push({ level: 'error', area: 'ai', text: '没有可用的 AI 平台，请在设置 → AI 平台中添加。' });
  } else if (!hasSecret(ai.apiKey)) {
    issues.push({
      level: 'warn',
      area: 'ai',
      text: `AI 平台「${ai.name}」还没填 API Key，AI 总结与对话不可用。${ai.keyUrl ? '申请地址见设置页。' : ''}`
    });
  } else if (!ai.baseUrl) {
    issues.push({ level: 'error', area: 'ai', text: `AI 平台「${ai.name}」缺少接口地址。` });
  } else if (!ai.model) {
    issues.push({ level: 'error', area: 'ai', text: `AI 平台「${ai.name}」还没选择模型，请点「探测模型」后选择。` });
  }
  ok.ai = !!(ai && hasSecret(ai.apiKey) && ai.baseUrl && ai.model);

  if (!asr) {
    issues.push({ level: 'warn', area: 'asr', text: '没有可用的语音识别平台，语音转录不可用。' });
  } else if (!hasSecret(asr.apiKey)) {
    issues.push({
      level: 'warn',
      area: 'asr',
      text: `语音识别平台「${asr.name}」还没填 API Key，语音转录不可用。`
    });
  } else if (!asr.baseUrl) {
    issues.push({ level: 'error', area: 'asr', text: `语音识别平台「${asr.name}」缺少接口地址。` });
  } else if (!asr.model) {
    issues.push({ level: 'error', area: 'asr', text: `语音识别平台「${asr.name}」还没选择模型。` });
  }
  ok.asr = !!(asr && hasSecret(asr.apiKey) && asr.baseUrl && asr.model);

  if (!prompt || !String(prompt.text || '').trim()) {
    issues.push({ level: 'error', area: 'prompt', text: '当前提示词为空，请在设置 → 提示词中填写。' });
  }
  ok.prompt = !!(prompt && String(prompt.text || '').trim());

  const sp = activeSearch(settings);
  // 有些检索平台复用 AI 平台的 Key（例如 DeepSeek 搜索复用 DeepSeek Key），
  // 判定「是否已配置」时要把那把 Key 也算进来，否则会误报未配置。
  let reusedSearchKey = '';
  if (sp && sp.reuseAiKey) {
    const aiForSearch = (settings.ai.platforms || []).find((p) => p.id === sp.reuseAiKey);
    reusedSearchKey = (aiForSearch && aiForSearch.apiKey) || '';
  }
  ok.search = !!(sp && (hasSecret(sp.apiKey) || hasSecret(reusedSearchKey)) && sp.baseUrl);
  if (settings.search.platforms && settings.search.platforms.length && !ok.search) {
    issues.push({
      level: 'info',
      area: 'search',
      text: '服务商检索未配置（缺 Key 或接口地址），仍可用「直接搜索引擎」链接，不消耗额度。'
    });
  }

  return { ok, issues };
}
