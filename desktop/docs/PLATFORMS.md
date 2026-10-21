# 平台目录与字段

> 与插件 `settings.js` 的默认平台目录对齐；密钥一律为空，由用户填写。

- AI：**27 家**（均为 OpenAI 兼容协议；Anthropic 原生协议暂未接入，未列入）
- 检索：**12 家**
- ASR：**3 家**

## AI 平台

| ID | 名称 | 默认模型 | 内置模型 |
|---|---|---|---|
| `deepseek` | DeepSeek | `deepseek-chat` | deepseek-chat, deepseek-reasoner |
| `siliconflow-ai` | 硅基流动（AI） | `Qwen/Qwen3-8B` | Qwen/Qwen3-8B, deepseek-ai/DeepSeek-V3 |
| `openai` | OpenAI | `gpt-4o-mini` | gpt-4o-mini, gpt-4o |
| `groq` | Groq | `llama-3.3-70b-versatile` | llama-3.3-70b-versatile, llama-3.1-8b-instant |
| `dashscope` | 阿里云百炼（DashScope） | `qwen-plus` | qwen-plus, qwen-max, qwen-turbo, qwen3-max |
| `moonshot` | Moonshot（Kimi） | `moonshot-v1-8k` | moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k |
| `zhipu` | 智谱 GLM | `glm-4-flash` | glm-4-flash, glm-4-plus, glm-4-air |
| `zai` | Z.ai（智谱国际站） | `glm-4.5` | glm-4.5, glm-4.5-air |
| `hunyuan` | 腾讯混元 | `hunyuan-turbos-latest` | hunyuan-turbos-latest, hunyuan-large, hunyuan-standard |
| `tencent-lkeap` | 腾讯云 TI（LKEAP） | `deepseek-v3` | deepseek-v3, deepseek-r1 |
| `doubao` | 字节豆包（火山方舟） | `doubao-pro-32k` | doubao-pro-32k, doubao-pro-128k, doubao-lite-32k |
| `baichuan` | 百川智能 | `Baichuan4` | Baichuan4, Baichuan3-Turbo, Baichuan3-Turbo-128k |
| `stepfun` | 阶跃星辰 StepFun | `step-1-8k` | step-1-8k, step-1-32k, step-1-flash |
| `minimax` | MiniMax | `abab6.5s-chat` | abab6.5s-chat, abab6.5-chat |
| `baidu-qianfan` | 百度千帆 | `ernie-4.0-turbo-8k` | ernie-4.0-turbo-8k, ernie-4.0-8k, ernie-speed-128k |
| `infini` | 无问芯穹 Infini | `deepseek-v3` | deepseek-v3, deepseek-r1 |
| `ppio` | PPIO 派欧云 | `deepseek/deepseek-v3` | deepseek/deepseek-v3, deepseek/deepseek-r1 |
| `modelscope` | 魔搭 ModelScope | `Qwen/Qwen2.5-7B-Instruct` | Qwen/Qwen2.5-7B-Instruct, deepseek-ai/DeepSeek-V3 |
| `longcat` | LongCat（美团） | `LongCat-Flash-Chat` | LongCat-Flash-Chat, LongCat-Flash-Thinking |
| `mimo` | 小米 MiMo | `mimo-7b-rl` | mimo-7b-rl |
| `xai` | xAI Grok | `grok-2-latest` | grok-2-latest, grok-beta |
| `gemini` | Google Gemini（OpenAI 兼容） | `gemini-2.0-flash` | gemini-2.0-flash, gemini-1.5-flash, gemini-1.5-pro |
| `mistral` | Mistral | `mistral-large-latest` | mistral-large-latest, mistral-small-latest, open-mistral-nemo |
| `openrouter` | OpenRouter | `openai/gpt-4o-mini` | openai/gpt-4o-mini, anthropic/claude-3.5-sonnet, google/gemini-flash-1.5 |
| `together` | Together AI | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | meta-llama/Llama-3.3-70B-Instruct-Turbo |
| `tokenrhythm` | 基元律动（TokenRhythm） | `deepseek-v4-flash-0731` | deepseek-v4-flash-0731, deepseek-v4.1-flash-1017, deepseek-v4-pro-0813, glm-5.3, glm-5.2, qwen3.8-max, qwen3.7-max, kimi-k2.6, minimax-m2.7, mimo-v2.5-pro, longcat-2.0, seed-2.1-pro |
| `custom-ai` | 自定义（OpenAI 兼容） | `` | — |

每个平台可配置：名称、Base URL、模型（内置下拉 + 手填）、API Key、官网、获取 Key 链接。

## 检索平台

| ID | 名称 | 协议 | 默认地址 | 复用 AI Key |
|---|---|---|---|---|
| `deepseek-search` | DeepSeek 搜索（官方，推荐） | `deepseek-search` | https://api.deepseek.com/v1/tools/search | deepseek |
| `tavily` | Tavily | `tavily` | https://api.tavily.com/search | — |
| `bocha` | 博查 Bocha | `bocha` | https://api.bochaai.com/v1/web-search | — |
| `serper` | Serper（Google） | `serper` | https://google.serper.dev/search | — |
| `zhipu-web` | 智谱 Web 搜索（国内，推荐） | `zhipu` | https://open.bigmodel.cn/api/paas/v4/web_search | — |
| `metaso` | 秘塔搜索（国内） | `metaso` | https://metaso.cn/api/v1/search | — |
| `baidu-ai-search` | 百度千帆 AI 搜索（国内） | `baidu` | https://qianfan.baidubce.com/v2/ai_search/web_search | — |
| `brave` | Brave Search | `brave` | https://api.search.brave.com/res/v1/web/search | — |
| `exa` | Exa（语义搜索） | `exa` | https://api.exa.ai/search | — |
| `jina-search` | Jina 搜索 + 正文提取 | `jina` | https://s.jina.ai/ | — |
| `searxng` | SearXNG（自建 / 免 Key） | `searxng` | https://searx.be/search | — |
| `custom-search` | 自定义搜索接口 | `custom` | — | — |

每个平台可配置：名称、协议、接口地址、API Key、官网、获取 Key、复用 AI Key。

## ASR 平台

| ID | 名称 | 默认模型 | 内置模型 | 传输 | 参数风格 | 音频格式 |
|---|---|---|---|---|---|---|
| `siliconflow` | 硅基流动（SiliconFlow） | `FunAudioLLM/SenseVoiceSmall` | XingChenAGI/XingChenASR-Diarize-V3.0, FunAudioLLM/SenseVoiceSmall, XingChenAGI/XingChenGSR-V1.0, TeleAI/TeleSpeechASR | `multipart` | `minimal` | `m4a` |
| `groq` | Groq | `whisper-large-v3-turbo` | whisper-large-v3-turbo, whisper-large-v3, distil-whisper-large-v3-en | `multipart` | `full` | `` |
| `custom-asr` | 自定义（OpenAI 兼容 /audio/transcriptions） | `` | — | `multipart` | `auto` | `` |

每个平台可配置：名称、Base URL、模型（下拉 + 手填）、API Key、官网、获取 Key；传输/参数风格/音频格式使用平台默认值，可在全局覆盖。
