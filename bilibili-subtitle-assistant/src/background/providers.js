// 平台适配层：AI 对话/总结、语音识别、联网检索。
// 默认 AI 平台 DeepSeek，默认语音识别平台 硅基流动（3.1）。

import { AppError, classifyHttp, classifyNetwork, httpError } from './errors.js';
import { readLines, timedFetch, fetchJson, joinUrl } from './net.js';
import { ensureHeaderRules } from './header-rules.js';
import * as TP from '../shared/time-range.js';

function isAnthropic(baseUrl) {
  return /anthropic\.com/i.test(String(baseUrl || ''));
}

// HTTP 头只能承载 ISO-8859-1 字符。如果 API Key 里混入了中文或其它非拉丁字符
// （常见于把说明文字、模型名或界面文案一起复制进来），
// fetch 会抛出极难理解的
//   Failed to read the 'headers' property from 'RequestInit':
//   String contains non ISO-8859-1 code point.
// 这里提前把它变成一句能照着修的提示。
function assertHeaderSafe(name, value) {
  const v = String(value == null ? '' : value);
  for (let i = 0; i < v.length; i += 1) {
    const code = v.charCodeAt(i);
    // 非 ISO-8859-1（> 0xff）：中文、全角符号、emoji 等
    const nonLatin = code > 0xff;
    // 控制字符（含 \r \n \t \0）：同样非法，且换行会造成头部注入
    const control = code < 0x20 || code === 0x7f;
    if (nonLatin || control) {
      const bad = nonLatin ? v[i] : `\\x${code.toString(16).padStart(2, '0')}`;
      const keyOnly = v.replace(/^Bearer\s+/i, '');
      throw new AppError(
        'badkey',
        `API Key 含非法字符「${bad}」`,
        `请求头 ${name} 的第 ${i + 1} 个字符是「${bad}」（非 ISO-8859-1 或控制字符）。\n` +
          `HTTP 头只能放单字节可见字符，中文/全角符号/换行都会让请求直接失败。\n` +
          `当前 Key：长度 ${keyOnly.length}，末四位 ${keyOnly.slice(-4)}。`,
        '请到 设置 → 对应平台，点「清除」后**只粘贴 Key 本身**（不要带中文说明、空格或换行），再「保存设置」。',
        { header: name }
      );
    }
  }
  return v;
}

// 统一构造请求头：所有值都过一遍 ISO-8859-1 校验
function safeHeaders(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (v === undefined || v === null) continue;
    out[k] = assertHeaderSafe(k, v);
  }
  return out;
}

// 错误分类需要的上下文：带上平台名与「当前真正用的 Key」的安全指纹
// （只用于生成提示文案，不会输出完整密钥）。
function platformCtx(platform) {
  const rawKey = String((platform && platform.apiKey) || '');
  const key = rawKey.trim();
  return {
    platformName: platform ? platform.name : '',
    baseUrl: platform ? platform.baseUrl : '',
    apiKey: key,
    // 去掉首尾空白后长度变了 → 说明粘贴时带了空白/换行
    rawKeyLength: rawKey.length !== key.length ? rawKey.length : key.length
  };
}

function authHeaders(platform) {
  const key = String(platform.apiKey || '').trim();
  if (isAnthropic(platform.baseUrl)) {
    return safeHeaders({
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    });
  }
  return safeHeaders({
    'content-type': 'application/json',
    authorization: `Bearer ${key}`
  });
}

// multipart 请求**绝不能**带 content-type: application/json。
// 之前 transcribeAttempt 直接复用 authHeaders()，于是发出
// 「Content-Type: application/json + multipart body（无 boundary）」的畸形请求，
// 服务端在解析 multipart 时就失败，返回**空响应体的 400**。
// 正确做法：只带鉴权头，让浏览器自己填 multipart/form-data; boundary=...
function authOnlyHeaders(platform) {
  if (isAnthropic(platform.baseUrl)) {
    const h = authHeaders(platform);
    delete h['content-type'];
    return h;
  }
  return safeHeaders({ authorization: `Bearer ${String(platform.apiKey || '').trim()}` });
}

// 明确的、可操作的「未配置」提示（3.3 / 稳定性 #11）
export function assertPlatformReady(platform, kind = 'AI') {
  if (!platform) {
    throw new AppError(
      'nokey',
      `没有可用的${kind}平台`,
      `当前${kind}平台不存在。`,
      '打开 设置 → 平台列表，添加或选择一个平台。'
    );
  }
  if (!String(platform.apiKey || '').trim()) {
    throw new AppError(
      'nokey',
      `${kind}平台还没填 API Key`,
      `平台「${platform.name}」的 API Key 为空。`,
      `打开 设置 → ${kind}平台 → ${platform.name}，粘贴 Key 后点「保存设置」。` +
        (platform.keyUrl ? `申请地址：${platform.keyUrl}` : '')
    );
  }
  if (!String(platform.baseUrl || '').trim()) {
    throw new AppError(
      'nobase',
      `${kind}平台缺少接口地址`,
      `平台「${platform.name}」的接口地址为空。`,
      `打开 设置 → ${kind}平台 → ${platform.name}，填写接口地址（OpenAI 兼容通常以 /v1 结尾）。`
    );
  }
  if (!String(platform.model || '').trim()) {
    throw new AppError(
      'nomodel',
      `${kind}平台还没选择模型`,
      `平台「${platform.name}」的模型为空。`,
      '在设置页点「探测模型」，然后点一个模型标签选中它。'
    );
  }
}

// ---------------------------------------------------------------------------
// 模型列表
// ---------------------------------------------------------------------------

export async function listModels(platform, opts = {}) {
  // kind 用于「测试连接」时的模型核对：ASR/检索平台没有对话模型，
  // 但同样需要 baseUrl + apiKey 才合法，所以这里不按 AI 校验。
  assertPlatformReady({ ...platform, model: platform.model || 'placeholder' }, opts.kind || 'AI');
  if (isAnthropic(platform.baseUrl)) {
    return String(platform.modelsCsv || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const url = joinUrl(platform.baseUrl, 'models');
  await ensureHeaderRules(platform, url);
  const data = await fetchJson(
    url,
    { method: 'GET', headers: authHeaders(platform) },
    {
      timeoutMs: opts.timeoutMs || 30000,
      externalSignal: opts.signal,
      ctx: platformCtx(platform)
    }
  );
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  return list
    .map((m) => (typeof m === 'string' ? m : m.id || m.name))
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b)));
}

// 诊断用：对「每一个可能的主机 × 传输方式」发一次极短请求，把状态码与响应摘要列成表。
// 目的是把「哪个地址能用、哪个不能用」变成一张可读的表，而不是让用户猜。
export async function probePlatformMatrix(platform, opts = {}) {
  const bases = [platform.baseUrl, ...alternateHosts(platform.baseUrl)].filter(Boolean);
  const rows = [];
  // 先探 /models：能通说明鉴权 OK
  for (const base of bases) {
    const line = { base, kind: 'GET /models', url: joinUrl(base, 'models'), status: null, ok: false, note: '' };
    try {
      const res = await timedFetch(
        line.url,
        { method: 'GET', headers: authHeaders(platform) },
        { timeoutMs: opts.timeoutMs || 12000, ctx: platformCtx(platform) }
      );
      line.status = res.status;
      line.ok = res.ok;
      if (res.ok) {
        try {
          const json = await res.json();
          const list = Array.isArray(json && json.data) ? json.data : Array.isArray(json && json.models) ? json.models : [];
          line.note = `${list.length} 个模型`;
        } catch (err) {
          line.note = '响应不是 JSON';
        }
      } else {
        let body = '';
        try {
          body = (await res.text()).slice(0, 160);
        } catch (err) {
          body = '';
        }
        line.note = body || '（空响应体）';
      }
    } catch (err) {
      line.note = `网络错误：${(err && err.message) || err}`;
    }
    rows.push(line);
  }
  // 再探两种转录传输方式（用两种长度的静音，便于判断 5xx 是否与样本有关）
  const wavShort = makeSilentWav(1.5, 16000);
  const wavLong = makeSilentWav(5, 16000);
  for (const base of bases) {
    for (const transport of ['multipart', 'chat-audio']) {
      for (const [label, wav] of [
        ['1.5s 静音', wavShort],
        ['5s 静音', wavLong]
      ]) {
        const plan = { transport, params: {}, baseUrl: base };
        const url = joinUrl(base, transport === 'chat-audio' ? 'chat/completions' : 'audio/transcriptions');
        const line = { base, kind: `${transport}（${label}）`, url, status: null, ok: false, note: '' };
        try {
          const res = await transcribeAttempt(
            platform,
            wav,
            { timeoutMs: opts.timeoutMs || 20000 },
            plan,
            platformCtx(platform)
          );
          line.status = res.status;
          line.ok = res.ok;
          let body = '';
          try {
            body = (await res.text()).slice(0, 200);
          } catch (err) {
            body = '';
          }
          line.note = body || (res.ok ? '成功' : '（空响应体）');
          if (res.status >= 500) {
            line.note +=
              `\n↑ 这是服务端内部错误（不是参数被拒）。说明鉴权与请求已经通过，是服务端在转录这一步出错 —— 通常和音频样本本身有关（内容/格式/时长）。`;
          }
        } catch (err) {
          line.note = `网络错误：${(err && err.message) || err}`;
        }
        rows.push(line);
      }
    }
  }
  return {
    rows,
    bases,
    keyLength: String(platform.apiKey || '').trim().length,
    keyTail: String(platform.apiKey || '').trim().slice(-4)
  };
}

// 语音识别请求是否值得重试。
// 5xx / 网络抖动多为瞬时故障，重试有意义；4xx（参数、模型名、鉴权）重试无意义。
export const ASR_RETRY_DELAYS_MS = [1200, 3000];

export function isRetriableAsrError(payload) {
  if (!payload) return false;
  const kind = String(payload.kind || '');
  const status = Number(payload.status) || 0;
  if (kind === 'server') return true;
  if (kind === 'network') return true;
  if (kind === 'timeout') return true;
  return status >= 500;
}

// 和 listModels 一样打 /models，但把「打到了哪个地址」也带回来。
// 用来区分「鉴权通过、只是没有这个模型」和「换了域名才通」。
export async function listModelsWithSource(platform, opts = {}) {
  const url = joinUrl(platform.baseUrl, 'models');
  const models = await listModels(platform, opts);
  return {
    models,
    url,
    baseUrl: platform.baseUrl,
    keyLength: String((platform && platform.apiKey) || '').trim().length
  };
}

// ---------------------------------------------------------------------------
// 对话 / 总结（流式）
// ---------------------------------------------------------------------------

export function buildAiUrl(platform) {
  if (isAnthropic(platform.baseUrl)) {
    const b = String(platform.baseUrl).replace(/\/+$/, '');
    return b.endsWith('/messages') ? b : `${b}/messages`;
  }
  return joinUrl(platform.baseUrl, 'chat/completions');
}

function aiBody(platform, messages, opts) {
  const temperature = opts.temperature == null ? 0.3 : opts.temperature;
  const maxTokens = opts.maxTokens || 4096;
  // MCP 工具（函数调用）。只有传了才带，避免不支持 tools 的平台直接报错。
  const tools = Array.isArray(opts.tools) && opts.tools.length ? opts.tools : null;
  if (isAnthropic(platform.baseUrl)) {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system');
    return {
      model: platform.model,
      system: system || undefined,
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
      temperature,
      stream: !!opts.stream,
      ...(tools ? { tools, tool_choice: { type: opts.toolChoice || 'auto' } } : {})
    };
  }
  const body = {
    model: platform.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: !!opts.stream
  };
  if (tools) {
    body.tools = tools;
    if (opts.toolChoice) body.tool_choice = opts.toolChoice;
  }
  return body;
}

// 统一流式入口。onDelta(text) 逐段回调；返回完整文本。
export async function chatStream(platform, messages, onDelta, opts = {}) {
  assertPlatformReady(platform, 'AI');
  const url = buildAiUrl(platform);
  await ensureHeaderRules(platform, url);
  const body = aiBody(platform, messages, { ...opts, stream: true });
  const res = await timedFetch(
    url,
    { method: 'POST', headers: authHeaders(platform), body: JSON.stringify(body) },
    {
      timeoutMs: opts.timeoutMs || 300000,
      externalSignal: opts.signal,
      ctx: platformCtx(platform)
    }
  );
  if (!res.ok) throw await httpError(res, platformCtx(platform));
  if (!res.body) {
    throw new AppError(
      'nobody',
      '服务端没有返回流式内容',
      '响应体为空。',
      '在设置里关闭「流式输出」或更换平台后重试。'
    );
  }

  let full = '';
  let reasoning = '';
  const anthropic = isAnthropic(platform.baseUrl);
  const onReasoning = typeof opts.onReasoning === 'function' ? opts.onReasoning : null;
  try {
    await readLines(
      res,
      async (line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith(':')) return; // SSE 注释/心跳
        let payload = trimmed;
        if (payload.startsWith('data:')) payload = payload.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        let json;
        try {
          json = JSON.parse(payload);
        } catch (err) {
          return;
        }
        if (json.error) {
          throw new AppError(
            'server',
            '模型返回错误',
            json.error.message || JSON.stringify(json.error),
            '换一个模型或平台后重试。'
          );
        }
        // 少数聚合网关（如基元律动 TokenRhythm）在**流已经建立**之后才抛错，
        // 用的是自家信封 { code, message, traceId }，没有 choices 字段。
        // 不拦的话这些块会被当成「没有正文的空增量」直接吞掉，
        // 用户拿到的就是一段静默截断的总结 —— 比报错糟糕得多。
        if (!json.choices && typeof json.code === 'string' && typeof json.message === 'string') {
          throw new AppError(
            'server',
            '模型返回错误',
            `${json.code}：${json.message}${json.traceId ? `（traceId ${json.traceId}）` : ''}`,
            '换一个模型或平台后重试；若持续失败，请把这段错误发给平台排查。'
          );
        }
        // 思维链与正文必须**分开**累计。
        //
        // 之前这一行是：
        //   piece = (c.delta && (c.delta.content || c.delta.reasoning_content)) || ...
        // 推理内容被当成正文拼进同一个 full —— 用户看到的就是
        // 「模型的心路历程 + 最终回答」混在一起、且无法折叠。
        //
        // 现在：reasoning 走 onReasoning，content 走 onDelta，两条互不干扰。
        let piece = '';
        let think = '';
        if (anthropic) {
          if (json.type === 'content_block_delta' && json.delta) {
            // Anthropic 扩展思考：thinking_delta 是思维链，text_delta 才是正文
            if (json.delta.type === 'thinking_delta' && json.delta.thinking) {
              think = json.delta.thinking;
            } else if (json.delta.thinking) {
              think = json.delta.thinking;
            } else if (json.delta.text) {
              piece = json.delta.text;
            }
          } else if (json.type === 'content_block_start' && json.content_block) {
            if (json.content_block.type === 'thinking' && json.content_block.thinking) {
              think = json.content_block.thinking;
            } else if (json.content_block.text) {
              piece = json.content_block.text;
            }
          }
        } else if (Array.isArray(json.choices)) {
          const c = json.choices[0] || {};
          const d = c.delta || {};
          // 各家字段名不同：DeepSeek/Moonshot 用 reasoning_content，
          // 部分网关用 reasoning，Anthropic 兼容层用 thinking
          think = d.reasoning_content || d.reasoning || (typeof d.thinking === 'string' ? d.thinking : '') || '';
          piece = d.content || '';
          // 少数平台把推理塞在 message 里（非流式回包混入流）
          if (!think && c.message && typeof c.message.reasoning_content === 'string') {
            think = c.message.reasoning_content;
          }
          if (!piece && c.message && typeof c.message.content === 'string') piece = c.message.content;
          if (!piece && !think && typeof c.text === 'string') piece = c.text;
        } else if (typeof json.response === 'string') {
          piece = json.response; // 少数 Ollama 风格
        }
        if (think) {
          reasoning += think;
          if (onReasoning) onReasoning(think);
        }
        if (piece) {
          full += piece;
          onDelta(piece);
        }
      },
      { externalSignal: opts.signal }
    );
  } catch (err) {
    if (full) {
      // 已产出部分内容：不整体失败，返回已有文本，让 UI 提示「已中断」
      if (err && err.name === 'AbortError') throw err;
    }
    throw classifyNetwork(err, platformCtx(platform));
  }
  return full;
}

export async function chatOnce(platform, messages, opts = {}) {
  assertPlatformReady(platform, 'AI');
  const url = buildAiUrl(platform);
  await ensureHeaderRules(platform, url);
  const body = aiBody(platform, messages, { ...opts, stream: false });
  const data = await fetchJson(
    url,
    { method: 'POST', headers: authHeaders(platform), body: JSON.stringify(body) },
    {
      timeoutMs: opts.timeoutMs || 300000,
      externalSignal: opts.signal,
      ctx: platformCtx(platform)
    }
  );
  const anthropic = isAnthropic(platform.baseUrl);
  if (anthropic) {
    const blocks = Array.isArray(data.content) ? data.content : [];
    const text = blocks
      .filter((b) => b && (b.type === 'text' || b.text))
      .map((b) => b.text || '')
      .join('');
    // 带上完整 message，供「函数调用」循环读取 tool_use 块
    return Object.assign(text, { text, message: { role: 'assistant', content: blocks }, raw: data });
  }
  const choice = (data.choices || [])[0] || {};
  const message = choice.message || {};
  const text = message.content || choice.text || '';
  return Object.assign(text, { text, message, raw: data });
}

// ---------------------------------------------------------------------------
// 语音识别
// ---------------------------------------------------------------------------

export function bytesToBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const sub = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, sub);
  }
  return btoa(binary);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

// 识别结果归一化：把各平台返回结构统一成 { text, segments:[{t,text,d?}], raw }
export function normalizeAsrResult(json) {
  if (!json) return { text: '', segments: [] };
  if (typeof json === 'string') return { text: json, segments: [] };

  // chat/completions 形态（小米 MiMo、部分以对话接口暴露 ASR 的模型）
  //   返回 { choices: [{ message: { content: "文本" | [{type,text}] } }] }
  const choiceContent = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (choiceContent != null) {
    let text = '';
    if (typeof choiceContent === 'string') text = choiceContent;
    else if (Array.isArray(choiceContent)) {
      text = choiceContent
        .map((item) => (typeof item === 'string' ? item : String((item && (item.text || (item.input_audio && item.input_audio.text))) || '')))
        .join('');
    }
    text = String(text || '').trim();
    if (text) return { text, segments: [] };
  }

  // OpenAI / Groq / 硅基流动 verbose_json
  if (Array.isArray(json.segments) && json.segments.length) {
    const segments = json.segments.map((s) => ({
      t: Number(s.start) || 0,
      d: Number(s.end) - Number(s.start) > 0 ? Number(s.end) - Number(s.start) : undefined,
      text: String(s.text || '').trim()
    }));
    return {
      text: String(json.text || segments.map((s) => s.text).join(' ')).trim(),
      segments: segments.filter((s) => s.text)
    };
  }
  if (Array.isArray(json.words) && json.words.length) {
    const segments = [];
    let cur = null;
    for (const w of json.words) {
      const start = Number(w.start) || 0;
      if (!cur) cur = { t: start, text: w.word || w.text || '' };
      else cur.text += w.word || w.text || '';
      if (/[。！？!?.,，；;]$/.test(String(w.word || ''))) {
        segments.push({ t: cur.t, text: cur.text.trim() });
        cur = null;
      }
    }
    if (cur) segments.push({ t: cur.t, text: cur.text.trim() });
    return { text: String(json.text || '').trim(), segments };
  }
  if (typeof json.text === 'string') return { text: json.text.trim(), segments: [] };
  // 硅基流动部分模型返回 { text: ... }；SenseVoice 可能包在 data 里
  if (json.data && typeof json.data.text === 'string') {
    return { text: json.data.text.trim(), segments: [] };
  }
  if (Array.isArray(json.results)) {
    const segments = json.results
      .map((r) => ({
        t: Number(r.start_time || r.start || 0),
        text: String(r.text || r.sentence || '').trim()
      }))
      .filter((s) => s.text);
    return { text: segments.map((s) => s.text).join(''), segments };
  }
  return { text: '', segments: [] };
}

// 语音识别的请求形态。不同平台/模型对「怎么把音频发过去」的要求不一样：
//   multipart    → POST /audio/transcriptions，FormData(file + model)   ← OpenAI / Groq / 硅基流动
//   base64-json  → POST /audio/transcriptions，JSON { model, audio: <base64> }
//   chat-audio   → POST /chat/completions，messages[].content[].input_audio.data = data URL
//                  （小米 MiMo、部分「以对话接口暴露 ASR 能力」的模型走这种，如 XingChen*）
// 都失败时按阶梯自动降级，这样用户不需要先猜对平台用的是哪一种。
function asrMode(platform) {
  const explicit = platform.paramStyle;
  if (explicit === 'full' || explicit === 'minimal') return explicit;
  const host = String(platform.baseUrl || '').toLowerCase();
  const model = String(platform.model || '').toLowerCase();
  if (host.includes('siliconflow') || model.includes('sensevoice') || model.includes('telespeech')) {
    return 'minimal';
  }
  return 'full';
}

// 用户显式选的传输方式；没选就按平台猜（默认 multipart，因为最常见）
function baseTransport(platform) {
  const t = String(platform.transport || '').trim();
  if (t === 'base64-json' || t === 'chat-audio' || t === 'multipart') return t;
  return 'multipart';
}

function bytesToDataUrl(wavBytes, mime = 'audio/wav') {
  return `data:${mime};base64,${bytesToBase64(wavBytes)}`;
}

// 只有确实存在 .cn / .com 双域名的服务才做域名互换，避免把
// api.deepseek.com 这种拼成不存在的 api.deepseek.cn。
const DUAL_TLD_HOSTS = [/^api\.siliconflow\.(cn|com)$/i];

// 硅基流动有国内（.cn）与国际（.com）两个域名，模型目录并不相同。
// 用户从别处抄来的模型 ID 很可能只在其中一个域名下存在，
// 所以把另一个域名也纳入尝试范围，并据此给出明确提示。
export function alternateHosts(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) return [];
  try {
    const u = new URL(raw);
    const host = u.hostname;
    if (!DUAL_TLD_HOSTS.some((re) => re.test(host))) return [];
    const alt = /\.cn$/i.test(host) ? host.replace(/\.cn$/i, '.com') : host.replace(/\.com$/i, '.cn');
    return [`${u.protocol}//${alt}${u.pathname.replace(/\/+$/, '')}`];
  } catch (err) {
    return [];
  }
}

// 一次识别尝试。params 控制额外字段，transport 控制音频怎么放。
async function transcribeAttempt(platform, wavBytes, opts, { transport, params, baseUrl }, ctx) {
  const timeoutMs = opts.timeoutMs || 180000;
  const base = baseUrl || platform.baseUrl;
  const auth = isAnthropic(base)
    ? authHeaders(platform)
    : safeHeaders({ authorization: `Bearer ${String(platform.apiKey || '').trim()}` });

  if (transport === 'chat-audio') {
    const url = joinUrl(base, 'chat/completions');
    const payload = {
      model: platform.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: { data: bytesToDataUrl(wavBytes) }
            }
          ]
        }
      ],
      ...params
    };
    return timedFetch(
      url,
      { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(payload) },
      { timeoutMs, externalSignal: opts.signal, ctx }
    );
  }

  const url = joinUrl(base, 'audio/transcriptions');
  if (transport === 'base64-json') {
    const payload = {
      model: platform.model,
      [platform.keyField || 'audio']: bytesToBase64(wavBytes),
      ...params
    };
    return timedFetch(
      url,
      { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(payload) },
      { timeoutMs, externalSignal: opts.signal, ctx }
    );
  }

  // multipart
  const form = new FormData();
  // 用 File 而不是 Blob：Chrome 在 Service Worker 里对 Blob 构造的 FormData 曾出现
  // "Illegal invocation"，File 更稳；同时带上带扩展名的文件名，
  // 因为部分服务端会按扩展名判断音频格式（硅基流动对 WAV 曾直接 500）。
  const requested = String(opts.filename || '').trim();
  const ext = /\.(wav|mp3|m4a|mp4|ogg|opus|webm|flac)$/i.test(requested) ? requested.slice(requested.lastIndexOf('.')) : '.wav';
  const fileName = requested || `slice-${Date.now().toString(36)}${ext}`;
  const mime = /\.mp3$/i.test(fileName)
    ? 'audio/mpeg'
    : /\.(m4a|mp4)$/i.test(fileName)
      ? 'audio/mp4'
      : /\.(ogg|opus)$/i.test(fileName)
        ? 'audio/ogg'
        : /\.webm$/i.test(fileName)
          ? 'audio/webm'
          : 'audio/wav';
  let audioPart;
  try {
    audioPart = new File([wavBytes], fileName, { type: mime });
  } catch (err) {
    audioPart = new Blob([wavBytes], { type: mime });
  }
  form.append(platform.keyField || 'file', audioPart, fileName);
  form.append('model', platform.model);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x) => form.append(`${k}[]`, String(x)));
    else form.append(k, String(v));
  }
  // 注意：这里**只**带鉴权头，不要带 content-type —— multipart 的
  // Content-Type（含 boundary）必须由浏览器自动生成。
  const headers = authOnlyHeaders(platform);
  // 运行时硬防线：曾经因为误带 content-type: application/json，
  // 发出「JSON 头 + multipart body（无 boundary）」的畸形请求，
  // 服务端返回**空响应体的 400**，排查了很多轮才定位。
  // 这里直接拦下，避免同类错误再次静默发生。
  const badHeader = Object.keys(headers).find((k) => /^content-type$/i.test(k));
  if (badHeader) {
    throw new AppError(
      'badparams',
      '内部错误：multipart 请求不能预设 Content-Type',
      `检测到请求头带了 ${badHeader}=${headers[badHeader]}。multipart 的边界必须由浏览器生成。`,
      '这是扩展的内部错误，请反馈。'
    );
  }
  return timedFetch(url, { method: 'POST', headers, body: form }, { timeoutMs, externalSignal: opts.signal, ctx });
}

export async function transcribeSlice(platform, wavBytes, opts = {}) {
  assertPlatformReady(platform, '语音识别');
  const ctx = platformCtx(platform);
  const language = opts.language || 'zh';
  const chosen = baseTransport(platform);
  const mode = asrMode(platform);

  // 构造尝试阶梯：
  //   minimal 风格（硅基流动 / SenseVoice 等）只发 file + model，多传参数会被判 400；
  //   其它风格先带 verbose_json + language（要时间戳），不行再退回最小体。
  //   然后补上「换一种传输方式」的兜底，覆盖平台其实不支持所选传输方式的情况。
  //   最后补上「换另一个域名」的兜底：硅基流动有 .cn / .com 两套目录，模型不一定都在。
  const extraTransports = ['multipart', 'base64-json', 'chat-audio'].filter((t) => t !== chosen);
  const plans = [];
  if (mode === 'minimal') {
    plans.push({ transport: chosen, params: {}, label: '最小参数（file + model）' });
  } else {
    plans.push({
      transport: chosen,
      params: { response_format: 'verbose_json', language, timestamp_granularities: ['segment'] },
      label: 'verbose_json'
    });
    plans.push({ transport: chosen, params: { response_format: 'json', language }, label: 'json' });
    plans.push({ transport: chosen, params: {}, label: '最小参数' });
  }
  for (const t of extraTransports) {
    plans.push({ transport: t, params: {}, label: `改用 ${t} 传输` });
  }
  const altHosts = alternateHosts(platform.baseUrl);
  for (const host of altHosts) {
    plans.push({ transport: 'multipart', params: {}, baseUrl: host, label: `换域名 ${host}`, alt: true });
    plans.push({ transport: 'chat-audio', params: {}, baseUrl: host, label: `换域名 ${host}（对话接口）`, alt: true });
  }
  // 把每个计划实际会请求的 URL 预先算出来，报错时可以直接展示
  for (const plan of plans) {
    const base = plan.baseUrl || platform.baseUrl;
    plan.url = joinUrl(base, plan.transport === 'chat-audio' ? 'chat/completions' : 'audio/transcriptions');
  }

  let res = null;
  let lastErr = null;
  let usedLabel = '';
  // 记录每一次尝试的「打到哪 + 结果」，最后如实展示完整链路。
  // 这一点很关键：曾经因为只报最后一次（兜底域名）的 401，
  // 把真正的 500 完全掩盖掉，导致排查方向被带偏。
  const attempts = [];
  if (typeof globalThis !== 'undefined' && globalThis.__BSUB_DEBUG_PLANS__) {
    globalThis.__BSUB_DEBUG_PLANS__.push(
      `plans(${plans.length}): ` + plans.map((p) => `${p.label}@${p.url}`).join(' | ')
    );
  }
  for (const plan of plans) {
    try {
      res = await transcribeAttempt(platform, wavBytes, opts, plan, ctx);
    } catch (err) {
      // 网络/超时：直接抛出，没必要换形态重试
      throw err;
    }
    attempts.push({
      label: plan.label,
      url: plan.url || joinUrl(plan.baseUrl || platform.baseUrl, 'audio/transcriptions'),
      status: res.ok ? 200 : res.status
    });
    if (res.ok) {
      usedLabel = plan.label;
      break;
    }
    // 先原样取回响应体（后面不论走哪条分支都要用），避免 httpError 消费掉 body
    let body = '';
    try {
      body = await res.text();
    } catch (err) {
      body = '';
    }
    // 记进 attempts，供「以配置地址的错误为准」时取用
    attempts[attempts.length - 1].body = body.slice(0, 800);
    // 只有 400/415/422（参数/格式不合法）才值得降级重试；其它错误直接归类抛出
    if (res.status !== 400 && res.status !== 415 && res.status !== 422) {
      // 5xx 是服务端内部错误。不同域名是**彼此独立的服务**，
      // 所以值得先试完「换域名」兜底再放弃 —— 之前这里直接抛出，
      // 导致 .cn 报 500 时根本不会去试 .com（而 .com 的 401 又会把 500 掩盖）。
      const hasAltLeft = plans.some((pl) => pl.alt && !attempts.some((a) => a.url === pl.url));
      if (res.status >= 500 && hasAltLeft) {
        lastErr = {
          status: res.status,
          body: body.slice(0, 400),
          label: plan.label,
          model: platform.model,
          transport: plan.transport,
          baseUrl: plan.baseUrl || platform.baseUrl,
          url: plan.url
        };
        res = null;
        continue;
      }
      // 鉴权失败时，用同一个 Key 打一次 /models 作为对照。
      // 注意：这里必须明确区分「本次请求实际打到的地址」和「设置里配置的地址」，
      // 两者在走了「换域名」兜底时会不一样，混在一起会得出错误结论。
      if (res.status === 401 || res.status === 403) {
        const attemptedBase = plan.baseUrl || platform.baseUrl;
        const configuredBase = platform.baseUrl;
        const isAltAttempt = attemptedBase !== configuredBase;

        // 发生在**兜底域名**上的 401 必须让位给「配置地址上真正的失败原因」。
        // 否则用户看到的是一句「Key 无效」，而真正的问题（例如 .cn 返回 400）
        // 被完全掩盖 —— 这正是此前反复误导排查的原因。
        const configuredAttempt = attempts.find((a) => {
          const u = String(a.url || '');
          const base = String(configuredBase || '');
          if (base && u.startsWith(base)) return true;
          try {
            const host = new URL(base).hostname;
            return host && u.includes(host);
          } catch (err) {
            return false;
          }
        });
        if (isAltAttempt && configuredAttempt && configuredAttempt.status >= 400 && configuredAttempt.status !== 401 && configuredAttempt.status !== 403) {
          const chainText =
            `\n\n本次总共尝试了 ${attempts.length} 次，完整链路：\n` +
            attempts.map((a, i) => `  ${i + 1}. ${a.url} → HTTP ${a.status}（${a.label}）`).join('\n');
          // 以配置地址上的真实错误为准来分类（例如 400 → 参数/格式类）
          const primary = classifyHttp(
            configuredAttempt.status,
            configuredAttempt.body || '',
            ctx
          );
          primary.title = `${primary.title}（配置地址 ${configuredAttempt.status}）`;
          primary.detail =
            `${primary.detail}` +
            `\n\n★ 配置地址「${configuredBase}」返回的才是真正要处理的问题：**HTTP ${configuredAttempt.status}**。` +
            `\n★ 上面那条 ${res.status} 来自兜底域名「${attemptedBase}」，那个站点本来就不认这把 Key（国内站/国际站是两套账号），可以忽略。` +
            (configuredAttempt.body && String(configuredAttempt.body).trim()
              ? `\n\n配置地址返回的原始响应体：\n${String(configuredAttempt.body).slice(0, 500)}`
              : '\n\n（配置地址返回的响应体为空，服务端没有给出原因。）') +
            chainText;
          throw primary;
        }
        const fail = classifyHttp(res.status, body, ctx);
        // 之前是否在**配置地址**上失败过？如果失败过，这次 401 只是兜底域名的结果，
        // 不能代表「配置地址上被拒」，更不该把结论写成额度/权限问题。
        // 注意：这里必须容错 —— configuredBase 畸形时 new URL() 会抛错，
        // 那个异常会直接从 .find() 里逃出去，绕过下面所有的分类逻辑，
        // 导致错误文案退化成「裸 401」，既没有对照探测也没有尝试链路。
        // （configuredAttempt / configuredHost 已在上面算好，这里直接复用。）
        const configuredFailed = !!(configuredAttempt && configuredAttempt.status >= 400);
        const chain =
          '\n\n本次总共尝试了 ' +
          attempts.length +
          ' 次，完整链路：\n' +
          attempts
            .map((a, i) => `  ${i + 1}. ${a.url} → HTTP ${a.status}${a.status === 200 ? ' ✅' : ' ❌'}（${a.label}）`)
            .join('\n');
        let probe = '';
        let configuredOk = null;
        try {
          // 对照用「设置里配置的地址」查一次 /models（这是判断 Key 本身是否有效的地方），
          // 而不是用失败的那个兜底地址 —— 后者是别的站点，401 很正常，会得出错误结论。
          const probeUrl = joinUrl(configuredBase, 'models');
          const probeRes = await timedFetch(
            probeUrl,
            { method: 'GET', headers: authHeaders(platform) },
            { timeoutMs: 15000, ctx }
          );
          configuredOk = probeRes.ok;
          let attemptedHost = '';
          try {
            attemptedHost = new URL(joinUrl(attemptedBase, 'audio/transcriptions')).hostname;
          } catch (err) {
            attemptedHost = '';
          }
          probe =
            `\n\n★ 本次请求实际打到的地址：${plan.url || joinUrl(attemptedBase, 'audio/transcriptions')}（${plan.label}）` +
            `\n★ 设置里配置的接口地址：${configuredBase}` +
            (attemptedBase !== configuredBase
              ? `\n（本次走了「换域名」兜底：先按配置地址试过但没成功，才轮到 ${attemptedHost}）`
              : '');
          if (probeRes.ok) {
            if (configuredFailed) {
              // 关键分支：配置地址自己就失败过（通常是 500），这次 401 只是兜底域名的结果。
              // 绝不能说成「额度/权限」—— 那会把排查方向带偏。
              probe +=
                `\n\n⚠ 注意：配置地址「${configuredBase}」这一次的返回是 **HTTP ${configuredAttempt.status}**，` +
                `并不是 401。上面那条 401 来自**兜底域名**「${attemptedHost}」，而那个域名本来就不认这把 Key` +
                `（国内站 / 国际站是两套账号）。\n` +
                `也就是说：**真正要处理的是配置地址返回的 ${configuredAttempt.status}，不是这个 401。**`;
            } else {
              probe +=
                `\n这说明真正的问题是**配置地址上的请求被拒**（例如该模型的额度/权限），而不是 Key 失效。`;
            }
          } else {
            probe +=
              `\n\n❌ 用同一个 Key 访问 GET ${probeUrl} 也返回 ${probeRes.status} → 配置地址上这个 Key 不被接受。`;
          }
          if (/api\.siliconflow\.(cn|com)$/i.test(attemptedHost)) {
            probe +=
              `\n\n硅基流动国内站与国际站是两套独立账号、Key 互不通用：` +
              `\n· cloud.siliconflow.cn 申请的 Key → 只能配 https://api.siliconflow.cn/v1` +
              `\n· cloud.siliconflow.com 申请的 Key → 只能配 https://api.siliconflow.com/v1`;
          }
        } catch (probeErr) {
          probe = `\n\n（对照请求 ${joinUrl(configuredBase, 'models')} 失败：${(probeErr && probeErr.message) || probeErr}）`;
        }
        fail.detail = ` ${fail.detail}${chain}${probe}`;
        if (configuredOk === true && configuredFailed) {
          const st = configuredAttempt.status;
          // 400/415/422 是**参数或音频格式**被拒，最可能是「模型与上传格式不匹配」。
          // 这一点已实测确认：同一个硅基流动账号下，
          //   SenseVoiceSmall 只吃 M4A，XingChenGSR 只吃 WAV。
          // 所以 400 时必须提示换模型/换格式，绝不能说「与音频格式无关」。
          if (st === 400 || st === 415 || st === 422) {
            fail.action =
              `不要改 Key —— 它在配置地址上是有效的。HTTP ${st} 表示**参数或音频格式被拒**，` +
              `最常见的原因是「模型与上传格式不匹配」（实测：SenseVoiceSmall 只接受 M4A，XingChenGSR 只接受 WAV）。` +
              `请到 设置 → 语音识别 换一个模型，或手动指定「上传音频格式」。`;
          } else {
            fail.action =
              `不要改 Key —— 它在配置地址上是有效的。真正的问题是配置地址返回了 HTTP ${st}，` +
              `与 Key、与站点选择都无关。建议换用其它平台或稍后再试。`;
          }
        } else if (configuredOk === true) {
          // 配置地址上 Key 是好的 → 不要引导用户去重新生成 Key，那会误导
          fail.action =
            'Key 本身有效（配置地址上 /models 返回 200）。请确认「接口地址」与 Key 属于同一个站（设置页有一键切换）。';
        }
        throw fail;
      }
      // 5xx 是服务端内部错误。不同域名是**彼此独立的服务**，
      // 所以值得先试完「换域名」兜底再放弃 —— 之前这里直接抛出，
      // 导致 .cn 报 500 时根本不会去试 .com（而 .com 的 401 又会把 500 掩盖）。
      if (res.status >= 500) {
        const altLeft = plans.some((pl) => pl.alt && !attempts.some((a) => a.url === pl.url));
        if (altLeft) continue;
      }
      throw classifyHttp(res.status, body, ctx);
    }
    lastErr = {
      status: res.status,
      body: body.slice(0, 400),
      label: plan.label,
      model: platform.model,
      transport: plan.transport,
      baseUrl: plan.baseUrl || platform.baseUrl,
      url: plan.url
    };
    res = null;
  }

  if (!res) {
    // 只有 400 家族会走到这里，并且我们已经知道「所有传输方式都被拒」。
    // 服务端的原始消息往往已经说清楚原因（例如 {"code":20012,"message":"Model does not exist"}），
    // 所以优先用它，其次才靠 /models 兜底推断。
    const rawBody = String((lastErr && lastErr.body) || '');
    const bodyIsEmpty = !rawBody.trim();
    const modelMissing = /model\s*(does\s*not\s*exist|not\s*found|invalid)|模型不存在|不存在的模型/i.test(rawBody);
    const noSpeech = /no\s*speech|empty|silence|no\s*valid|audio\s*is\s*(empty|too\s*short)|未检测到|语音为空/i.test(rawBody);

    let modelHint = '';
    let available = null;
    let probeError = '';
    let suggestion = null;

    if (!bodyIsEmpty && !modelMissing) {
      // 服务端已经给了明确原因，照搬即可，不要再叠加猜测
      modelHint = '';
    } else {
      try {
        const all = await listModels(platform, { kind: '语音识别', timeoutMs: 15000 });
        if (Array.isArray(all) && all.length) {
          available = all.slice(0, 40);
          const wanted = String(platform.model || '').trim();
          const exact = all.find((m) => m === wanted);
          // 归一化后找最接近的候选：处理大小写、分隔符、版本号后缀等细微差异
          const norm = (s) => String(s || '').toLowerCase().replace(/[\s._-]+/g, '');
          const wantedNorm = norm(wanted);
          const near = all.filter((m) => {
            const n = norm(m);
            return n && (n === wantedNorm || (wantedNorm.length > 6 && (n.startsWith(wantedNorm) || wantedNorm.startsWith(n) || n.includes(wantedNorm))));
          });

          if (exact) {
            // 服务器说模型不存在，但 /models 里确实有 → 多半是「这个模型不能用于语音识别」，
            // 或者端点/传输方式它不认。
            modelHint = `\n\nℹ "${wanted}" 在该平台的模型列表里存在，但语音识别接口回「模型不存在」。`;
            modelHint += `\n这通常表示该模型不是语音识别模型（例如它是对话/向量模型），不能用于转录。`;
            const speech = all.filter((m) => /audio|asr|whisper|sensevoice|speech|voice|gsr/i.test(m));
            if (speech.length) modelHint += `\n该平台可用于语音识别的模型：${speech.slice(0, 8).join('、')}`;
          } else {
            modelHint = `\n\n⚠ 平台「${platform.name}」的模型列表里没有 "${wanted}"。`;
            if (near.length) {
              suggestion = near[0];
              modelHint += `\n名称最接近的是：${near.slice(0, 5).join('、')}`;
              modelHint += `\n如果上面某一个才是你要用的，请到 设置 → 语音识别 → 模型 里改成**完整准确**的 ID（区分大小写与后缀）。`;
            } else {
              const speech = all.filter((m) => /audio|asr|whisper|sensevoice|speech|voice|gsr/i.test(m));
              if (speech.length) modelHint += `\n可用的语音识别模型：${speech.slice(0, 8).join('、')}`;
              else modelHint += `\n该平台的模型（前 40）：${all.slice(0, 40).join('、')}`;
            }
            modelHint += `\n设置里点「选择模型」可以直接从平台返回的列表里挑，避免手抄出错。`;
          }
        }
      } catch (err) {
        probeError = `\n（顺带查 /models 也失败了：${(err && err.message) || String(err)}）`;
      }

      if (noSpeech) {
        // 服务端只是说这段音频没内容 → 鉴权与参数其实都通了
        modelHint = '\n\nℹ 服务端提示的是「音频没有语音内容」，说明鉴权与请求格式都没问题。测试连接用的是极短静音，属于正常。';
      }
    }

    // 去重列出「实际请求过的每一个 endpoint」，让用户能看到究竟打到了哪里
    const triedList = [];
    for (const plan of plans) {
      const base = plan.baseUrl || platform.baseUrl;
      const url = joinUrl(base, plan.transport === 'chat-audio' ? 'chat/completions' : 'audio/transcriptions');
      const key = `${plan.transport}@${url}`;
      if (!triedList.some((t) => t.key === key)) triedList.push({ key, transport: plan.transport, url });
    }
    const triedText = triedList.map((t) => `· ${t.transport} → POST ${t.url}`).join('\n');

    const sent = [
      `实际发送：\nmodel=${platform.model}\n${triedText}`,
      lastErr ? `最后一次（${lastErr.label}，${lastErr.transport}）服务端返回：${lastErr.body || '（空响应体）'}` : '',
      modelHint,
      probeError
    ]
      .filter(Boolean)
      .join('\n');
    const e = new AppError(
      'badparams',
      `语音识别接口拒绝了请求（HTTP ${lastErr ? lastErr.status : '400'}）`,
      sent,
      suggestion
        ? `把「模型」改成平台返回的准确 ID：${suggestion}（设置 → 语音识别 → 模型）。`
        : '检查 设置 → 语音识别：模型是否属于该平台、接口地址是否以 /v1 结尾、请求方式与音频字段名是否正确。' +
          '不确定时点「选择模型」从平台返回的列表里挑，或点「核对模型」确认 ID 完全一致（区分大小写与后缀）。',
      { status: lastErr ? lastErr.status : 400, body: lastErr && lastErr.body, model: lastErr && lastErr.model, available, suggestion }
    );
    throw e;
  }

  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new AppError(
      'parse',
      '识别结果不是合法 JSON',
      (err && err.message) || '',
      '确认接口地址指向 OpenAI 兼容的 /audio/transcriptions。'
    );
  }
  const out = normalizeAsrResult(json);
  out.usedParams = usedLabel;
  return out;
}

// ---------------------------------------------------------------------------
// 测试连接（3.2）
// ---------------------------------------------------------------------------

export async function testAiPlatform(platform, opts = {}) {
  assertPlatformReady(platform, 'AI');
  const started = Date.now();
  const text = await chatOnce(
    platform,
    [{ role: 'user', content: '回复两个字：可用' }],
    { maxTokens: 16, temperature: 0, timeoutMs: opts.timeoutMs || 30000, signal: opts.signal }
  );
  return { ok: true, ms: Date.now() - started, sample: String(text || '').slice(0, 80) };
}

export async function testAsrPlatform(platform, opts = {}) {
  assertPlatformReady(platform, '语音识别');
  const started = Date.now();
  // 用 1.5 秒静音探活：太短（<1s）的音频会被部分平台直接判 400，
  // 那会把「参数没问题、只是探测样本太短」误报成配置错误。
  // 另外把「语音内容为空」这类服务端提示识别出来，不当成配置错误。
  const probeSeconds = [1.5, 3];
  let lastErr = null;
  for (const seconds of probeSeconds) {
    const wav = makeSilentWav(seconds, 16000);
    try {
      const out = await transcribeSlice(platform, wav, {
        timeoutMs: opts.timeoutMs || 60000,
        signal: opts.signal
      });
      return {
        ok: true,
        ms: Date.now() - started,
        probeSeconds: seconds,
        sample: (out.text || '').slice(0, 80) || '（静音输入，返回空文本即视为可用）'
      };
    } catch (err) {
      lastErr = err;
      const body = (err && err.payload && err.payload.detail) || '';
      const emptyAudio = /no\s*speech|empty|silence|no\s*valid|audio\s*is\s*(empty|too\s*short)|未检测到|没有检测到|语音为空/i.test(
        String(body)
      );
      // 服务端只是说「这段音频没内容」→ 说明鉴权与参数都通了
      if (err.kind === 'badparams' && emptyAudio) {
        return {
          ok: true,
          ms: Date.now() - started,
          probeSeconds: seconds,
          sample: '接口可达且鉴权通过（探测样本是静音，服务端提示未检测到语音，属正常）'
        };
      }
      // 参数类错误：换更长的样本再试一次；非参数类错误直接抛
      if (err.kind !== 'badparams') throw err;
    }
  }
  throw lastErr;
}

export function makeSilentWav(seconds, rate) {
  const samples = Math.max(1, Math.floor(seconds * rate));
  const dataSize = samples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  return new Uint8Array(buf);
}

export async function testSearchPlatform(platform, opts = {}) {
  if (!platform) throw new AppError('nokey', '没有可用的检索平台', '', '在设置 → 联网检索中选择平台。');
  if (!String(platform.apiKey || '').trim()) {
    throw new AppError(
      'nokey',
      '检索平台还没填 API Key',
      `平台「${platform.name}」的 Key 为空。`,
      '打开 设置 → 联网检索，粘贴 Key 后点「测试连接」。'
    );
  }
  const started = Date.now();
  const out = await searchProvider(platform, 'B站 字幕', { maxResults: 2, timeoutMs: 20000, signal: opts.signal });
  return { ok: true, ms: Date.now() - started, sample: `${out.results.length} 条结果` };
}

// ---------------------------------------------------------------------------
// 联网检索（服务商检索，结果作为 AI 依据，消耗额度）
// ---------------------------------------------------------------------------

export async function searchProvider(platform, query, opts = {}) {
  const max = opts.maxResults || 6;
  const timeoutMs = opts.timeoutMs || 45000;
  const ctx = platformCtx(platform);
  const kind = platform.kind || 'tavily';
  const base = String(platform.baseUrl || '').trim();
  if (!base) {
    throw new AppError('nobase', '检索接口地址为空', '', '在设置 → 联网检索中填写接口地址。');
  }

  let url = base;
  let init = { method: 'POST', headers: { 'content-type': 'application/json' } };

  // 时间过滤：各家参数名不同，统一由 shared/time-range.js 换算。
  // 不支持时间过滤的引擎，这里返回 {}，调用方会如实提示「可能包含较早内容」。
  const tp = TP.timeParamsFor(kind, opts.timeRange);

  if (kind === 'deepseek-search') {
    // DeepSeek 官方搜索：POST /v1/tools/search
    //   count 1~50；need_content=true 时直接返回正文，省掉面板里逐条抓取；
    //   时间过滤用查询语法 after:YYYY-MM-DD（官方支持的 query operator）。
    const deepseekBase = String(platform.baseUrl || '').replace(/\/+$/, '');
    url = /\/v1$/.test(deepseekBase) ? `${deepseekBase}/tools/search` : deepseekBase;
    let deepseekQuery = String(query || '').trim();
    if (!deepseekQuery) {
      throw new AppError('badargs', '检索词为空', '', '请先输入要查的问题。');
    }
    // 查询上限 128 字符；after: 必须完整保留，不能被截断。
    const afterSuffix = tp.after ? ` after:${tp.after}` : '';
    deepseekQuery = `${deepseekQuery.slice(0, Math.max(1, 128 - afterSuffix.length))}${afterSuffix}`.trim();
    init = {
      method: 'POST',
      headers: safeHeaders({
        'content-type': 'application/json',
        authorization: `Bearer ${platform.apiKey}`
      }),
      body: JSON.stringify({
        query: deepseekQuery,
        count: Math.max(1, Math.min(50, max)),
        ...(opts.oriQuestion ? { ori_question: String(opts.oriQuestion).trim().slice(0, 128) } : {}),
        need_content: !!opts.fetchPageContent
      })
    };
  } else if (kind === 'tavily') {
    init = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: platform.apiKey,
        query,
        max_results: max,
        search_depth: 'basic',
        include_answer: false,
        include_raw_content: !!opts.fetchPageContent,
        ...(tp.time_range ? { time_range: tp.time_range } : {})
      })
    };
  } else if (kind === 'bocha') {
    init = {
      method: 'POST',
      headers: safeHeaders({ 'content-type': 'application/json', authorization: `Bearer ${platform.apiKey}` }),
      body: JSON.stringify({
        query,
        count: max,
        summary: !!opts.fetchPageContent,
        ...(tp.freshness ? { freshness: tp.freshness } : {})
      })
    };
  } else if (kind === 'serper') {
    init = {
      method: 'POST',
      headers: safeHeaders({ 'content-type': 'application/json', 'x-api-key': platform.apiKey }),
      body: JSON.stringify({ q: query, num: max, ...(tp.tbs ? { tbs: tp.tbs } : {}) })
    };
  } else if (kind === 'zhipu') {
    // 智谱 Web 搜索：POST {search_query}，返回 search_result 数组
    init = {
      method: 'POST',
      headers: safeHeaders({ 'content-type': 'application/json', authorization: `Bearer ${platform.apiKey}` }),
      body: JSON.stringify({
        search_engine: 'search_std',
        search_query: query,
        count: Math.min(50, max),
        content_size: opts.fetchPageContent ? 'high' : 'medium',
        ...(tp.search_recency_filter ? { search_recency_filter: tp.search_recency_filter } : {})
      })
    };
  } else if (kind === 'metaso') {
    // 秘塔搜索：POST {q, scope, includeSummary}
    init = {
      method: 'POST',
      headers: safeHeaders({ 'content-type': 'application/json', authorization: `Bearer ${platform.apiKey}` }),
      body: JSON.stringify({
        q: query,
        scope: 'webpage',
        includeSummary: !!opts.fetchPageContent,
        size: String(Math.min(50, max)),
        ...(tp.timeRange ? { timeRange: tp.timeRange } : {})
      })
    };
  } else if (kind === 'baidu') {
    // 百度千帆 AI 搜索
    init = {
      method: 'POST',
      headers: safeHeaders({ 'content-type': 'application/json', authorization: `Bearer ${platform.apiKey}` }),
      body: JSON.stringify({
        messages: [{ role: 'user', content: query }],
        search_source: 'baidu_search_v2',
        resource_type_filter: [{ type: 'web', top_k: Math.min(50, max) }],
        ...(tp.search_recency_filter ? { search_recency_filter: tp.search_recency_filter } : {})
      })
    };
  } else if (kind === 'brave') {
    // Brave Search：GET ?q=，带 X-Subscription-Token；时效用 freshness
    url = `${base}?q=${encodeURIComponent(query)}&count=${Math.min(20, max)}${tp.freshness ? `&freshness=${tp.freshness}` : ''}`;
    init = {
      method: 'GET',
      headers: safeHeaders({ accept: 'application/json', 'x-subscription-token': platform.apiKey })
    };
  } else if (kind === 'exa') {
    // Exa：POST {query, numResults, contents}；时效用 startPublishedDate
    init = {
      method: 'POST',
      headers: safeHeaders({ 'content-type': 'application/json', 'x-api-key': platform.apiKey }),
      body: JSON.stringify({
        query,
        numResults: Math.min(25, max),
        ...(opts.fetchPageContent ? { contents: { text: { maxCharacters: 4000 } } } : {}),
        ...(tp.startPublishedDate ? { startPublishedDate: tp.startPublishedDate } : {})
      })
    };
  } else if (kind === 'jina') {
    // Jina 搜索：GET https://s.jina.ai/<query>，可选抓正文
    url = `${base.replace(/\/+$/, '')}/${encodeURIComponent(query)}`;
    init = {
      method: 'GET',
      headers: safeHeaders({
        accept: 'application/json',
        ...(platform.apiKey ? { authorization: `Bearer ${platform.apiKey}` } : {}),
        ...(opts.fetchPageContent ? { 'x-respond-with': ' markdown' } : {})
      })
    };
  } else if (kind === 'searxng') {
    // SearXNG：GET /search?q=&format=json（自建实例通常无需 Key，但可带 Token）
    url = `${base}?q=${encodeURIComponent(query)}&format=json${tp.time_range ? `&time_range=${tp.time_range}` : ''}`;
    init = {
      method: 'GET',
      headers: safeHeaders({
        accept: 'application/json',
        ...(platform.apiKey ? { authorization: `Bearer ${platform.apiKey}` } : {})
      })
    };
  } else {
    // 通用：GET ?q= / POST {query}
    url = base.includes('?') ? `${base}&q=${encodeURIComponent(query)}` : `${base}?q=${encodeURIComponent(query)}`;
    init = { method: 'GET', headers: safeHeaders({ authorization: `Bearer ${platform.apiKey}` }) };
  }

  const data = await fetchJson(url, init, { timeoutMs, externalSignal: opts.signal, ctx });

  const results = [];
  const push = (title, link, snippet, content, extra = {}) => {
    if (!link) return;
    results.push({
      title: String(title || link).slice(0, 200),
      url: String(link),
      snippet: String(snippet || '').slice(0, 800),
      content: content ? String(content).slice(0, 4000) : '',
      ...extra
    });
  };

  if (kind === 'deepseek-search') {
    // DeepSeek 的结果字段最全：summary（600~800 字）才是给模型看的，
    // snippet 只有 100~200 字只适合 UI。这里两者都保留，
    // 并带上 rerank_score / authority / date / site_name 供排序与展示。
    for (const r of data.results || []) {
      if (!r || !r.url) continue;
      const summary = String(r.summary || '').slice(0, 1200);
      results.push({
        title: String(r.title || r.url).slice(0, 200),
        url: String(r.url),
        snippet: summary || String(r.snippet || '').slice(0, 800),
        summary,
        content: String(r.content || '').slice(0, 6000),
        site: String(r.site_name || '').slice(0, 120),
        publishedAt: String(r.date || '').slice(0, 40),
        score: Number(r.rerank_score) || 0,
        authority: Number.isFinite(Number(r.authority)) ? Number(r.authority) : -1
      });
    }
    // 官方已按 rerank_score 排过；这里再显式排一次，避免未来响应顺序变化
    results.sort((a, b) => (b.score - a.score) || (b.authority - a.authority));
  } else if (Array.isArray(data.results)) {
    for (const r of data.results) {
      push(r.title, r.url, r.content || r.snippet, r.raw_content, {
        summary: String(r.summary || '').slice(0, 1200),
        publishedAt: String(r.published_date || r.date || '').slice(0, 40),
        score: Number(r.score) || 0
      });
    }
  } else if (data.webPages && Array.isArray(data.webPages.value)) {
    for (const r of data.webPages.value) push(r.name, r.url, r.snippet, r.summary);
  } else if (Array.isArray(data.organic)) {
    for (const r of data.organic) push(r.title, r.link, r.snippet, r.snippet);
  } else if (data.data && Array.isArray(data.data.webPages?.value)) {
    for (const r of data.data.webPages.value) push(r.name, r.url, r.snippet, r.summary);
  } else if (Array.isArray(data.data)) {
    for (const r of data.data) push(r.title || r.name, r.url || r.link, r.snippet || r.content, r.content);
  } else if (Array.isArray(data.items)) {
    for (const r of data.items) push(r.title, r.link || r.url, r.snippet, r.snippet);
  }

  // ---- 以下为新增 provider 的响应形态 ----
  // 智谱：{ search_result: [{ title, link, content, media, publish_date }] }
  if (!results.length && Array.isArray(data.search_result)) {
    for (const r of data.search_result) push(r.title, r.link || r.url, r.content || r.snippet, r.content);
  }
  // 秘塔：{ data: { webpages: [...] } } 或 { webpages: [...] }
  const metasoList = (data.data && Array.isArray(data.data.webpages) && data.data.webpages) ||
    (Array.isArray(data.webpages) && data.webpages) || null;
  if (!results.length && metasoList) {
    for (const r of metasoList) push(r.title, r.link || r.url, r.snippet || r.summary, r.content || r.rawContent);
  }
  // Brave：{ web: { results: [{ title, url, description, extra_snippets }] } }
  if (!results.length && data.web && Array.isArray(data.web.results)) {
    for (const r of data.web.results) {
      const snip = [r.description, ...(Array.isArray(r.extra_snippets) ? r.extra_snippets : [])].filter(Boolean).join(' ');
      push(r.title, r.url, snip, '');
    }
  }
  // Exa：{ results: [{ title, url, text, summary }] }（已在上面处理），另有 { data: [...] }
  // Jina：{ data: [{ title, url, content, description }] }
  if (!results.length && Array.isArray(data.data) && data.data.some((x) => x && (x.url || x.link))) {
    for (const r of data.data) push(r.title, r.url || r.link, r.description || r.content, r.content);
  }
  // SearXNG：{ results: [{ title, url, content, engine }] }（已在上面处理）
  // 百度千帆：{ references: [{ title, url, content }] } 或 { search_results: [...] }
  const baiduList = (Array.isArray(data.references) && data.references) ||
    (Array.isArray(data.search_results) && data.search_results) || null;
  if (!results.length && baiduList) {
    for (const r of baiduList) push(r.title, r.url || r.link, r.content || r.snippet, r.content);
  }

  // 同一 URL 只保留一条（有些引擎的聚合页/重复结果会占掉名额）
  const deduped = [];
  const seenUrls = new Set();
  for (const r of results) {
    const key = String(r.url || '').replace(/#.*$/, '').replace(/\/+$/, '');
    if (!key || seenUrls.has(key)) continue;
    seenUrls.add(key);
    deduped.push(r);
  }

  return { results: deduped.slice(0, max), query, raw: opts.keepRaw ? data : undefined };
}

// DeepSeek 官方抓取：POST /v1/tools/fetch，返回 Markdown 正文。
// 比通用 fetchPageText 的「正则去标签」干净得多，用于 DeepSeek 搜索的正文补抓。
export async function deepseekFetch(url, apiKey, opts = {}) {
  const data = await fetchJson(
    'https://api.deepseek.com/v1/tools/fetch',
    {
      method: 'POST',
      headers: safeHeaders({
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      }),
      body: JSON.stringify({ url: String(url) })
    },
    { timeoutMs: opts.timeoutMs || 30000, externalSignal: opts.signal || null, ctx: {} }
  );
  return {
    title: String((data && data.title) || '').slice(0, 200),
    content: String((data && data.content) || '').slice(0, 12000)
  };
}

// 抓取页面正文（可选，仅供参考）
export async function fetchPageText(url, opts = {}) {
  const res = await timedFetch(
    url,
    { method: 'GET', headers: { accept: 'text/html,application/xhtml+xml' } },
    { timeoutMs: opts.timeoutMs || 30000, externalSignal: opts.signal, ctx: {} }
  );
  if (!res.ok) {
    throw new AppError('http', '抓取页面失败', `HTTP ${res.status}`, '可关闭「抓取页面正文」后重试。', {
      status: res.status
    });
  }
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 6000);
}

// ---------------------------------------------------------------------------
// 自定义域名权限（3.2）：必须在用户点击时触发
// ---------------------------------------------------------------------------

export function originPatternOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch (err) {
    return null;
  }
}

export async function ensureOriginPermission(url) {
  const pattern = originPatternOf(url);
  if (!pattern) {
    throw new AppError(
      'badurl',
      '接口地址不合法',
      String(url || ''),
      '请填写完整地址，例如 https://api.example.com/v1。'
    );
  }
  const has = await chrome.permissions.contains({ origins: [pattern] });
  if (has) return { granted: true, pattern, already: true };
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [pattern] });
  } catch (err) {
    granted = false;
  }
  if (!granted) {
    throw new AppError(
      'permission',
      '缺少域名访问权限',
      `未授权访问 ${pattern}。`,
      '再点一次「申请域名权限」，并在浏览器弹出的提示中选择「允许」。'
    );
  }
  return { granted: true, pattern, already: false };
}
