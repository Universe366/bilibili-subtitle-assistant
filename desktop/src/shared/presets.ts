// 插件平台目录（与 bilibili-subtitle-assistant/src/shared/settings.js 对齐）。
// 仅数据，主进程与渲染进程共用；apiKey 一律为空。
import type { AiPlatform, AsrPlatform, SearchPlatform } from './types';

export const AI_PRESET_VERSION = 4;

export const AI_PRESETS: AiPlatform[] = [
  {
    "id": "deepseek",
    "name": "DeepSeek",
    "baseUrl": "https://api.deepseek.com/v1",
    "apiKey": "",
    "model": "deepseek-chat",
    "models": [
      "deepseek-chat",
      "deepseek-reasoner"
    ],
    "homepage": "https://platform.deepseek.com/",
    "keyUrl": "https://platform.deepseek.com/api_keys",
    "kind": ""
  },
  {
    "id": "siliconflow-ai",
    "name": "硅基流动（AI）",
    "baseUrl": "https://api.siliconflow.cn/v1",
    "apiKey": "",
    "model": "Qwen/Qwen3-8B",
    "models": [
      "Qwen/Qwen3-8B",
      "deepseek-ai/DeepSeek-V3"
    ],
    "homepage": "https://cloud.siliconflow.cn/",
    "keyUrl": "https://cloud.siliconflow.cn/account/ak",
    "kind": ""
  },
  {
    "id": "openai",
    "name": "OpenAI",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "",
    "model": "gpt-4o-mini",
    "models": [
      "gpt-4o-mini",
      "gpt-4o"
    ],
    "homepage": "https://platform.openai.com/",
    "keyUrl": "https://platform.openai.com/api-keys",
    "kind": ""
  },
  {
    "id": "anthropic",
    "name": "Anthropic Claude",
    "baseUrl": "https://api.anthropic.com/v1",
    "apiKey": "",
    "model": "claude-sonnet-4-5",
    "models": [
      "claude-sonnet-4-5",
      "claude-opus-4-1",
      "claude-3-5-haiku-latest"
    ],
    "homepage": "https://www.anthropic.com/",
    "keyUrl": "https://console.anthropic.com/settings/keys",
    "kind": "anthropic"
  },
  {
    "id": "groq",
    "name": "Groq",
    "baseUrl": "https://api.groq.com/openai/v1",
    "apiKey": "",
    "model": "llama-3.3-70b-versatile",
    "models": [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant"
    ],
    "homepage": "https://groq.com/",
    "keyUrl": "https://console.groq.com/keys",
    "kind": ""
  },
  {
    "id": "dashscope",
    "name": "阿里云百炼（DashScope）",
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "apiKey": "",
    "model": "qwen-plus",
    "models": [
      "qwen-plus",
      "qwen-max",
      "qwen-turbo",
      "qwen3-max"
    ],
    "homepage": "https://bailian.console.aliyun.com/",
    "keyUrl": "https://bailian.console.aliyun.com/?apiKey=1",
    "kind": ""
  },
  {
    "id": "moonshot",
    "name": "Moonshot（Kimi）",
    "baseUrl": "https://api.moonshot.cn/v1",
    "apiKey": "",
    "model": "moonshot-v1-8k",
    "models": [
      "moonshot-v1-8k",
      "moonshot-v1-32k",
      "moonshot-v1-128k"
    ],
    "homepage": "https://platform.moonshot.cn/",
    "keyUrl": "https://platform.moonshot.cn/console/api-keys",
    "kind": ""
  },
  {
    "id": "zhipu",
    "name": "智谱 GLM",
    "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
    "apiKey": "",
    "model": "glm-4-flash",
    "models": [
      "glm-4-flash",
      "glm-4-plus",
      "glm-4-air"
    ],
    "homepage": "https://open.bigmodel.cn/",
    "keyUrl": "https://open.bigmodel.cn/usercenter/apikeys",
    "kind": ""
  },
  {
    "id": "zai",
    "name": "Z.ai（智谱国际站）",
    "baseUrl": "https://api.z.ai/api/paas/v4",
    "apiKey": "",
    "model": "glm-4.5",
    "models": [
      "glm-4.5",
      "glm-4.5-air"
    ],
    "homepage": "https://z.ai/",
    "keyUrl": "https://z.ai/manage-apikey/apikey-list",
    "kind": ""
  },
  {
    "id": "hunyuan",
    "name": "腾讯混元",
    "baseUrl": "https://api.hunyuan.cloud.tencent.com/v1",
    "apiKey": "",
    "model": "hunyuan-turbos-latest",
    "models": [
      "hunyuan-turbos-latest",
      "hunyuan-large",
      "hunyuan-standard"
    ],
    "homepage": "https://cloud.tencent.com/product/hunyuan",
    "keyUrl": "https://console.cloud.tencent.com/hunyuan/api-key",
    "kind": ""
  },
  {
    "id": "tencent-lkeap",
    "name": "腾讯云 TI（LKEAP）",
    "baseUrl": "https://api.lkeap.cloud.tencent.com/v1",
    "apiKey": "",
    "model": "deepseek-v3",
    "models": [
      "deepseek-v3",
      "deepseek-r1"
    ],
    "homepage": "https://cloud.tencent.com/product/lkeap",
    "keyUrl": "https://console.cloud.tencent.com/lkeap",
    "kind": ""
  },
  {
    "id": "doubao",
    "name": "字节豆包（火山方舟）",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
    "apiKey": "",
    "model": "doubao-pro-32k",
    "models": [
      "doubao-pro-32k",
      "doubao-pro-128k",
      "doubao-lite-32k"
    ],
    "homepage": "https://www.volcengine.com/product/ark",
    "keyUrl": "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    "kind": ""
  },
  {
    "id": "baichuan",
    "name": "百川智能",
    "baseUrl": "https://api.baichuan-ai.com/v1",
    "apiKey": "",
    "model": "Baichuan4",
    "models": [
      "Baichuan4",
      "Baichuan3-Turbo",
      "Baichuan3-Turbo-128k"
    ],
    "homepage": "https://www.baichuan-ai.com/",
    "keyUrl": "https://platform.baichuan-ai.com/console/apikey",
    "kind": ""
  },
  {
    "id": "stepfun",
    "name": "阶跃星辰 StepFun",
    "baseUrl": "https://api.stepfun.com/v1",
    "apiKey": "",
    "model": "step-1-8k",
    "models": [
      "step-1-8k",
      "step-1-32k",
      "step-1-flash"
    ],
    "homepage": "https://platform.stepfun.com/",
    "keyUrl": "https://platform.stepfun.com/interface-key",
    "kind": ""
  },
  {
    "id": "minimax",
    "name": "MiniMax",
    "baseUrl": "https://api.minimax.chat/v1",
    "apiKey": "",
    "model": "abab6.5s-chat",
    "models": [
      "abab6.5s-chat",
      "abab6.5-chat"
    ],
    "homepage": "https://www.minimaxi.com/",
    "keyUrl": "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    "kind": ""
  },
  {
    "id": "baidu-qianfan",
    "name": "百度千帆",
    "baseUrl": "https://qianfan.baidubce.com/v2",
    "apiKey": "",
    "model": "ernie-4.0-turbo-8k",
    "models": [
      "ernie-4.0-turbo-8k",
      "ernie-4.0-8k",
      "ernie-speed-128k"
    ],
    "homepage": "https://qianfan.cloud.baidu.com/",
    "keyUrl": "https://console.bce.baidu.com/iam/#/iam/apikey/list",
    "kind": ""
  },
  {
    "id": "infini",
    "name": "无问芯穹 Infini",
    "baseUrl": "https://cloud.infini-ai.com/maas/v1",
    "apiKey": "",
    "model": "deepseek-v3",
    "models": [
      "deepseek-v3",
      "deepseek-r1"
    ],
    "homepage": "https://cloud.infini-ai.com/",
    "keyUrl": "https://cloud.infini-ai.com/iam/ak",
    "kind": ""
  },
  {
    "id": "ppio",
    "name": "PPIO 派欧云",
    "baseUrl": "https://api.ppinfra.com/v3/openai",
    "apiKey": "",
    "model": "deepseek/deepseek-v3",
    "models": [
      "deepseek/deepseek-v3",
      "deepseek/deepseek-r1"
    ],
    "homepage": "https://ppio.com/",
    "keyUrl": "https://ppio.com/settings/key-management",
    "kind": ""
  },
  {
    "id": "modelscope",
    "name": "魔搭 ModelScope",
    "baseUrl": "https://api-inference.modelscope.cn/v1",
    "apiKey": "",
    "model": "Qwen/Qwen2.5-7B-Instruct",
    "models": [
      "Qwen/Qwen2.5-7B-Instruct",
      "deepseek-ai/DeepSeek-V3"
    ],
    "homepage": "https://modelscope.cn/",
    "keyUrl": "https://modelscope.cn/my/myaccesstoken",
    "kind": ""
  },
  {
    "id": "longcat",
    "name": "LongCat（美团）",
    "baseUrl": "https://api.longcat.chat/openai/v1",
    "apiKey": "",
    "model": "LongCat-Flash-Chat",
    "models": [
      "LongCat-Flash-Chat",
      "LongCat-Flash-Thinking"
    ],
    "homepage": "https://longcat.chat/",
    "keyUrl": "https://longcat.chat/platform/api_keys",
    "kind": ""
  },
  {
    "id": "mimo",
    "name": "小米 MiMo",
    "baseUrl": "https://api.xiaomimimo.com/v1",
    "apiKey": "",
    "model": "mimo-7b-rl",
    "models": [
      "mimo-7b-rl"
    ],
    "homepage": "https://xiaomimimo.com/",
    "keyUrl": "https://xiaomimimo.com/",
    "kind": ""
  },
  {
    "id": "xai",
    "name": "xAI Grok",
    "baseUrl": "https://api.x.ai/v1",
    "apiKey": "",
    "model": "grok-2-latest",
    "models": [
      "grok-2-latest",
      "grok-beta"
    ],
    "homepage": "https://x.ai/",
    "keyUrl": "https://console.x.ai/",
    "kind": ""
  },
  {
    "id": "gemini",
    "name": "Google Gemini（OpenAI 兼容）",
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
    "apiKey": "",
    "model": "gemini-2.0-flash",
    "models": [
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro"
    ],
    "homepage": "https://ai.google.dev/",
    "keyUrl": "https://aistudio.google.com/app/apikey",
    "kind": ""
  },
  {
    "id": "mistral",
    "name": "Mistral",
    "baseUrl": "https://api.mistral.ai/v1",
    "apiKey": "",
    "model": "mistral-large-latest",
    "models": [
      "mistral-large-latest",
      "mistral-small-latest",
      "open-mistral-nemo"
    ],
    "homepage": "https://mistral.ai/",
    "keyUrl": "https://console.mistral.ai/api-keys/",
    "kind": ""
  },
  {
    "id": "openrouter",
    "name": "OpenRouter",
    "baseUrl": "https://openrouter.ai/api/v1",
    "apiKey": "",
    "model": "openai/gpt-4o-mini",
    "models": [
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-sonnet",
      "google/gemini-flash-1.5"
    ],
    "homepage": "https://openrouter.ai/",
    "keyUrl": "https://openrouter.ai/keys",
    "kind": ""
  },
  {
    "id": "together",
    "name": "Together AI",
    "baseUrl": "https://api.together.xyz/v1",
    "apiKey": "",
    "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "models": [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo"
    ],
    "homepage": "https://www.together.ai/",
    "keyUrl": "https://api.together.xyz/settings/api-keys",
    "kind": ""
  },
  {
    "id": "tokenrhythm",
    "name": "基元律动（TokenRhythm）",
    "baseUrl": "https://tokenrhythm.studio/v1",
    "apiKey": "",
    "model": "deepseek-v4-flash-0731",
    "models": [
      "deepseek-v4-flash-0731",
      "deepseek-v4.1-flash-1017",
      "deepseek-v4-pro-0813",
      "glm-5.3",
      "glm-5.2",
      "qwen3.8-max",
      "qwen3.7-max",
      "kimi-k2.6",
      "minimax-m2.7",
      "mimo-v2.5-pro",
      "longcat-2.0",
      "seed-2.1-pro"
    ],
    "homepage": "https://tokenrhythm.studio/",
    "keyUrl": "https://tokenrhythm.studio/account",
    "kind": ""
  },
  {
    "id": "custom-ai",
    "name": "自定义（OpenAI 兼容）",
    "baseUrl": "",
    "apiKey": "",
    "model": "",
    "models": [],
    "homepage": "",
    "keyUrl": "",
    "kind": ""
  }
];

export const SEARCH_PRESETS: SearchPlatform[] = [
  {
    "id": "deepseek-search",
    "name": "DeepSeek 搜索（官方，推荐）",
    "kind": "deepseek-search",
    "baseUrl": "https://api.deepseek.com/v1/tools/search",
    "apiKey": "",
    "homepage": "https://api-docs.deepseek.com/guides/search/",
    "keyUrl": "https://platform.deepseek.com/api_keys",
    "reuseAiKey": "deepseek"
  },
  {
    "id": "tavily",
    "name": "Tavily",
    "kind": "tavily",
    "baseUrl": "https://api.tavily.com/search",
    "apiKey": "",
    "homepage": "https://tavily.com/",
    "keyUrl": "https://app.tavily.com/home",
    "reuseAiKey": ""
  },
  {
    "id": "bocha",
    "name": "博查 Bocha",
    "kind": "bocha",
    "baseUrl": "https://api.bochaai.com/v1/web-search",
    "apiKey": "",
    "homepage": "https://open.bochaai.com/",
    "keyUrl": "https://open.bochaai.com/",
    "reuseAiKey": ""
  },
  {
    "id": "serper",
    "name": "Serper（Google）",
    "kind": "serper",
    "baseUrl": "https://google.serper.dev/search",
    "apiKey": "",
    "homepage": "https://serper.dev/",
    "keyUrl": "https://serper.dev/api-key",
    "reuseAiKey": ""
  },
  {
    "id": "zhipu-web",
    "name": "智谱 Web 搜索（国内，推荐）",
    "kind": "zhipu",
    "baseUrl": "https://open.bigmodel.cn/api/paas/v4/web_search",
    "apiKey": "",
    "homepage": "https://open.bigmodel.cn/",
    "keyUrl": "https://open.bigmodel.cn/usercenter/apikeys",
    "reuseAiKey": ""
  },
  {
    "id": "metaso",
    "name": "秘塔搜索（国内）",
    "kind": "metaso",
    "baseUrl": "https://metaso.cn/api/v1/search",
    "apiKey": "",
    "homepage": "https://metaso.cn/",
    "keyUrl": "https://metaso.cn/settings/api",
    "reuseAiKey": ""
  },
  {
    "id": "baidu-ai-search",
    "name": "百度千帆 AI 搜索（国内）",
    "kind": "baidu",
    "baseUrl": "https://qianfan.baidubce.com/v2/ai_search/web_search",
    "apiKey": "",
    "homepage": "https://qianfan.cloud.baidu.com/",
    "keyUrl": "https://console.bce.baidu.com/iam/#/iam/apikey/list",
    "reuseAiKey": ""
  },
  {
    "id": "brave",
    "name": "Brave Search",
    "kind": "brave",
    "baseUrl": "https://api.search.brave.com/res/v1/web/search",
    "apiKey": "",
    "homepage": "https://brave.com/search/api/",
    "keyUrl": "https://api-dashboard.search.brave.com/app/keys",
    "reuseAiKey": ""
  },
  {
    "id": "exa",
    "name": "Exa（语义搜索）",
    "kind": "exa",
    "baseUrl": "https://api.exa.ai/search",
    "apiKey": "",
    "homepage": "https://exa.ai/",
    "keyUrl": "https://dashboard.exa.ai/api-keys",
    "reuseAiKey": ""
  },
  {
    "id": "jina-search",
    "name": "Jina 搜索 + 正文提取",
    "kind": "jina",
    "baseUrl": "https://s.jina.ai/",
    "apiKey": "",
    "homepage": "https://jina.ai/",
    "keyUrl": "https://jina.ai/api-dashboard/",
    "reuseAiKey": ""
  },
  {
    "id": "searxng",
    "name": "SearXNG（自建 / 免 Key）",
    "kind": "searxng",
    "baseUrl": "https://searx.be/search",
    "apiKey": "",
    "homepage": "https://docs.searxng.org/",
    "keyUrl": "",
    "reuseAiKey": ""
  },
  {
    "id": "custom-search",
    "name": "自定义搜索接口",
    "kind": "custom",
    "baseUrl": "",
    "apiKey": "",
    "homepage": "",
    "keyUrl": "",
    "reuseAiKey": ""
  }
];

export const ASR_PRESETS: AsrPlatform[] = [
  {
    "id": "siliconflow",
    "name": "硅基流动（SiliconFlow）",
    "baseUrl": "https://api.siliconflow.cn/v1",
    "apiKey": "",
    "model": "FunAudioLLM/SenseVoiceSmall",
    "models": [
      "XingChenAGI/XingChenASR-Diarize-V3.0",
      "FunAudioLLM/SenseVoiceSmall",
      "XingChenAGI/XingChenGSR-V1.0",
      "TeleAI/TeleSpeechASR"
    ],
    "homepage": "https://cloud.siliconflow.cn/",
    "keyUrl": "https://cloud.siliconflow.cn/account/ak",
    "transport": "multipart",
    "paramStyle": "minimal",
    "audioFormat": "m4a",
    "keyField": "file"
  },
  {
    "id": "groq",
    "name": "Groq",
    "baseUrl": "https://api.groq.com/openai/v1",
    "apiKey": "",
    "model": "whisper-large-v3-turbo",
    "models": [
      "whisper-large-v3-turbo",
      "whisper-large-v3",
      "distil-whisper-large-v3-en"
    ],
    "homepage": "https://groq.com/",
    "keyUrl": "https://console.groq.com/keys",
    "transport": "multipart",
    "paramStyle": "full",
    "audioFormat": "auto",
    "keyField": "file"
  },
  {
    "id": "custom-asr",
    "name": "自定义（OpenAI 兼容 /audio/transcriptions）",
    "baseUrl": "",
    "apiKey": "",
    "model": "",
    "models": [],
    "homepage": "",
    "keyUrl": "",
    "transport": "multipart",
    "paramStyle": "auto",
    "audioFormat": "auto",
    "keyField": "file"
  }
];
