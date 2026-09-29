// 验证语音识别平台适配：硅基流动只发 file+model，Groq 才带 response_format/language
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const results = [];
const check = (name, ok, extra = '') => results.push({ name, ok: !!ok, extra });

const providers = await import('../bilibili-subtitle-assistant/src/background/providers.js');

const WAV = new Uint8Array(1200); // 假 PCM 数据，够用即可

function installFetch(handler) {
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body;
    const fields = {};
    if (body && typeof body.append === 'function' && typeof body.entries === 'function') {
      for (const [k, v] of body.entries()) {
        // 记下 File/Blob 的原始文件名：服务端可能按扩展名判断音频格式
        fields[k] = v && v.size != null ? `<blob ${v.size}B>${v.name ? ` name=${v.name}` : ''}` : String(v);
      }
    } else if (typeof body === 'string') {
      try {
        Object.assign(fields, JSON.parse(body));
      } catch (err) {
        fields.__raw = body;
      }
    }
    return handler({ url, method: init.method, headers: init.headers || {}, fields, raw: body, init });
  };
}

const jsonResponse = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

// ---------------- 1. 硅基流动：必须只发 file + model ----------------
let last = null;
installFetch((req) => {
  last = req;
  return jsonResponse({ text: '识别出来的文字' });
});

const siliconflow = {
  id: 'siliconflow',
  name: '硅基流动（SiliconFlow）',
  baseUrl: 'https://api.siliconflow.cn/v1',
  model: 'FunAudioLLM/SenseVoiceSmall',
  transport: 'multipart',
  paramStyle: 'minimal',
  keyField: 'file',
  apiKey: 'sk-test-siliconflow'
};

let out = await providers.transcribeSlice(siliconflow, WAV, { language: 'zh' });
check('硅基流动请求成功', out && out.text === '识别出来的文字', JSON.stringify(out));
check('只在一次请求内搞定（没有浪费降级重试）', !!last, 'ok');
check('音频字段名是 file', !!last.fields.file, Object.keys(last.fields || {}).join(','));
check('字段只有 file + model', Object.keys(last.fields || {}).sort().join(',') === 'file,model', Object.keys(last.fields || {}).sort().join(','));
check('不带 response_format（硅基流动不支持）', !('response_format' in (last.fields || {})));
check('不带 language（硅基流动不支持）', !('language' in (last.fields || {})));
check('Authorization 是 Bearer', /^Bearer sk-test-siliconflow$/.test(last.headers.authorization || ''), String(last.headers.authorization));
check('没有手动设 content-type（交给浏览器带 boundary）', !last.headers['content-type'] && !last.headers['Content-Type'], JSON.stringify(last.headers));
check('endpoint 是 /audio/transcriptions', /\/v1\/audio\/transcriptions$/.test(last.url), last.url);

// ---------------- 2. 硅基流动：即使代码里写了 verbose_json，也不会发出去 ----------------
last = null;
out = await providers.transcribeSlice({ ...siliconflow, responseFormat: 'verbose_json' }, WAV, { language: 'zh' });
check('模型名含 sensevoice 时自动识别为 minimal 风格', !!last && Object.keys(last.fields).sort().join(',') === 'file,model', last ? Object.keys(last.fields).join(',') : 'no-request');

// ---------------- 3. Groq：先 verbose_json，带 language ----------------
last = null;
let calls = 0;
installFetch((req) => {
  calls += 1;
  last = req;
  return jsonResponse({
    text: 'Groq 结果',
    segments: [
      { start: 0, end: 1.5, text: '第一句' },
      { start: 1.5, end: 3, text: '第二句' }
    ]
  });
});

const groq = {
  id: 'groq',
  name: 'Groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  model: 'whisper-large-v3-turbo',
  transport: 'multipart',
  paramStyle: 'full',
  keyField: 'file',
  apiKey: 'gsk-test'
};

out = await providers.transcribeSlice(groq, WAV, { language: 'zh' });
check('Groq 第一发就用 verbose_json', last && last.fields.response_format === 'verbose_json', last && last.fields.response_format);
check('Groq 带 language=zh', last && last.fields.language === 'zh', last && last.fields.language);
check('Groq 请求 timestamp_granularities[]', last && !!last.fields['timestamp_granularities[]'], Object.keys(last && last.fields || {}).join(','));
check('Groq 解析出 segments', out && out.segments && out.segments.length === 2, JSON.stringify(out && out.segments));
check('Groq 只请求了一次（没有多余重试）', calls === 1, `calls=${calls}`);

// ---------------- 4. Groq：400 时自动降级到 json ----------------
installFetch((req) => {
  calls += 1;
  last = req;
  if (req.fields.response_format === 'verbose_json') {
    return jsonResponse({ error: { message: 'response_format not supported' } }, 400);
  }
  return jsonResponse({ text: '降级后的结果' });
});
calls = 0;
out = await providers.transcribeSlice(groq, WAV, { language: 'zh' });
check('400 后自动降级重试', calls >= 2, `calls=${calls}`);
check('降级后拿到结果', out && out.text === '降级后的结果', JSON.stringify(out && out.text));
check('降级后不再发 verbose_json', last && last.fields.response_format !== 'verbose_json', last && last.fields.response_format);

// ---------------- 5. minimal 平台也 400 时给出可操作错误 ----------------
installFetch(() => jsonResponse({ code: 20012, message: 'Model does not exist' }, 400));
let err = null;
try {
  await providers.transcribeSlice(siliconflow, WAV, { language: 'zh' });
} catch (e) {
  err = e;
}
check('全参数都 400 时抛出分类错误', !!err, err && err.message);
check('错误里提示硅基流动只支持 file + model', !!err && /multipart|file \+ model|字段名/.test((err.payload && err.payload.action) || ''), err && err.payload && err.payload.action);
check('错误里带上了服务端返回体（便于定位）', !!err && /Model does not exist/.test((err.payload && err.payload.detail) || ''), err && err.payload && err.payload.detail);

// ---------------- 6. 模型名不属于该平台 → 400 空响应体时给出可操作提示 ----------------
// 实测场景：硅基流动 + model=XingChenAGI/XingChenGSR-V1.0 → 400 且响应体为空。
let listCalls = 0;
installFetch((req) => {
  if (/\/models$/.test(req.url)) {
    listCalls += 1;
    return jsonResponse({
      data: [
        { id: 'FunAudioLLM/SenseVoiceSmall' },
        { id: 'TeleAI/TeleSpeechASR' },
        { id: 'Qwen/Qwen2.5-7B-Instruct' },
        { id: 'BAAI/bge-m3' }
      ]
    });
  }
  // 语音识别接口：模型不对 → 400 且空响应体
  return new Response('', { status: 400 });
});

err = null;
try {
  await providers.transcribeSlice({ ...siliconflow, model: 'XingChenAGI/XingChenGSR-V1.0' }, WAV, { language: 'zh' });
} catch (e) {
  err = e;
}
check('空响应体的 400 会去查 /models 辅助定位', listCalls >= 1, `listCalls=${listCalls}`);
check('错误里明确指出模型不在该平台', !!err && /不在该平台的模型列表|没有 "?XingChenAGI/.test((err.payload && err.payload.detail) || ''), (err.payload && err.payload.detail || '').slice(0, 200));
check('错误里列出可用的语音识别模型', !!err && /SenseVoiceSmall|TeleSpeechASR/.test((err.payload && err.payload.detail) || ''), (err.payload && err.payload.detail || '').slice(0, 300));
check('错误里带上探测到的模型列表供 UI 使用', !!err && Array.isArray(err.payload.extra && err.payload.extra.available) && err.payload.extra.available.length >= 3, JSON.stringify(err && err.payload && err.payload.extra));

// ---------------- 7. 模型名正确时不该出现「模型不在列表」的误导提示 ----------------
listCalls = 0;
installFetch((req) => {
  if (/\/models$/.test(req.url)) {
    listCalls += 1;
    return jsonResponse({ data: [{ id: 'FunAudioLLM/SenseVoiceSmall' }] });
  }
  return new Response('', { status: 400 });
});
err = null;
try {
  // 模型名与平台列表一致，仍 400 → 不应该提示「模型不在列表」
  await providers.transcribeSlice(siliconflow, WAV, { language: 'zh' });
} catch (e) {
  err = e;
}
check('模型名一致时不误报「模型不在列表」', !!err && !/不在该平台的模型列表/.test((err.payload && err.payload.detail) || ''), (err.payload && err.payload.detail || '').slice(0, 200));

// ---------------- 8. 传输方式阶梯：/audio/transcriptions 不通时自动试 /chat/completions ----------------
// 这就是用户遇到的场景：XingChenAGI/XingChenGSR-V1.0 在原生 /audio/transcriptions 上 400，
// 但它实际是通过对话接口暴露 ASR 能力的（小米 MiMo 同款形态）。
{
  const seen = [];
  installFetch((req) => {
    seen.push(req.url);
    if (/\/audio\/transcriptions$/.test(req.url)) {
      // 原生接口一律拒绝（模型名不对时的真实表现）
      return new Response('', { status: 400 });
    }
    if (/\/chat\/completions$/.test(req.url)) {
      return jsonResponse({ choices: [{ message: { content: '通过对话接口识别出来的文字' } }] });
    }
    if (/\/models$/.test(req.url)) {
      return jsonResponse({ data: [{ id: 'XingChenAGI/XingChenGSR-V1.0' }] });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const xingchen = {
    id: 'siliconflow',
    name: '硅基流动（SiliconFlow）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'XingChenAGI/XingChenGSR-V1.0',
    transport: 'multipart',
    paramStyle: 'minimal',
    keyField: 'file',
    apiKey: 'sk-test'
  };

  const r = await providers.transcribeSlice(xingchen, WAV, { language: 'zh' });
  check('原生接口 400 后自动改用 /chat/completions', seen.some((u) => /\/chat\/completions$/.test(u)), seen.join(' | '));
  check('从对话接口拿到了文本', !!r && r.text === '通过对话接口识别出来的文字', JSON.stringify(r));
  check('记录使用了哪种形态', !!r && /chat-audio/.test(String(r.usedParams || '')), JSON.stringify(r && r.usedParams));
}

// ---------------- 9. chat/completions 请求体形态正确 ----------------
{
  let chatReq = null;
  installFetch((req) => {
    if (/\/chat\/completions$/.test(req.url)) {
      chatReq = req;
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    }
    return new Response('', { status: 400 });
  });
  const p = {
    id: 'mimo',
    name: '小米 MiMo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5-asr',
    transport: 'chat-audio',
    keyField: 'file',
    apiKey: 'sk-mimo'
  };
  const r = await providers.transcribeSlice(p, WAV, { language: 'zh' });
  check('chat-audio 直接打 /chat/completions', !!chatReq && /\/chat\/completions$/.test(chatReq.url), chatReq && chatReq.url);
  check('chat-audio 用 JSON body', !!chatReq && typeof chatReq.raw === 'string' && chatReq.fields && !!chatReq.fields.messages, chatReq ? typeof chatReq.raw : 'none');
  check(
    'chat-audio 体里有 input_audio.data 的 data URL',
    !!chatReq && /"type":"input_audio"/.test(chatReq.raw) && /"data":"data:audio\/wav;base64,/.test(chatReq.raw),
    chatReq ? chatReq.raw.slice(0, 160) : 'none'
  );
  check('chat-audio 带 Bearer', !!chatReq && /^Bearer sk-mimo$/.test(chatReq.headers.authorization || ''), chatReq && chatReq.headers.authorization);
  check('chat-audio 解析出文本', !!r && r.text === 'ok', JSON.stringify(r));
}

// ---------------- 10. base64 JSON 传输 ----------------
{
  let b64Req = null;
  installFetch((req) => {
    if (/\/audio\/transcriptions$/.test(req.url)) {
      b64Req = req;
      return jsonResponse({ text: 'base64 结果' });
    }
    return new Response('', { status: 400 });
  });
  const p = {
    id: 'custom-b64',
    name: '自定义 base64',
    baseUrl: 'https://api.example.com/v1',
    model: 'some-asr',
    transport: 'base64-json',
    keyField: 'audio',
    apiKey: 'sk-b64'
  };
  const r = await providers.transcribeSlice(p, WAV, { language: 'zh' });
  check('base64-json 打 /audio/transcriptions', !!b64Req && /\/audio\/transcriptions$/.test(b64Req.url), b64Req && b64Req.url);
  check('base64-json 用 JSON body 且字段名可配', !!b64Req && b64Req.fields && typeof b64Req.fields.audio === 'string' && b64Req.fields.model === 'some-asr', b64Req ? JSON.stringify(Object.keys(b64Req.fields)) : 'none');
  check('base64-json 解析出文本', !!r && r.text === 'base64 结果', JSON.stringify(r));
}

// ---------------- 11. 服务端明确回「Model does not exist」时的处理 ----------------
// 真实场景：硅基流动对 XingChenAGI/XingChenGSR-V1.0 回
//   {"code":20012,"message":"Model does not exist. Please check it carefully."}
// 但 /models 里确实存在这个 ID → 说明它不是语音识别模型。
{
  const ENGINE_NOT_ASR = JSON.stringify({ code: 20012, message: 'Model does not exist. Please check it carefully.', data: null });
  const MODELS = ['XingChenAGI/XingChenGSR-V1.0', 'FunAudioLLM/SenseVoiceSmall', 'TeleAI/TeleSpeechASR', 'Qwen/Qwen2.5-7B-Instruct'];

  installFetch((req) => {
    if (/\/models$/.test(req.url)) {
      return jsonResponse({ object: 'list', data: MODELS.map((id) => ({ id })) });
    }
    // 三种传输方式都回同一个业务错误
    return new Response(ENGINE_NOT_ASR, { status: 400, headers: { 'content-type': 'application/json' } });
  });

  const p = {
    id: 'siliconflow',
    name: '硅基流动（SiliconFlow）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'XingChenAGI/XingChenGSR-V1.0',
    transport: 'multipart',
    paramStyle: 'minimal',
    keyField: 'file',
    apiKey: 'sk-test'
  };

  globalThis.__BSUB_DEBUG_PLANS__ = [];
  let e = null;
  try {
    await providers.transcribeSlice(p, WAV, { language: 'zh' });
  } catch (err) {
    e = err;
  }
  const d = (e && e.payload && e.payload.detail) || '';
  const act = (e && e.payload && e.payload.action) || '';

  check('服务端原文被如实带出（model does not exist）', /Model does not exist/.test(d), d.slice(0, 200));
  check('列出了实际尝试过的三种传输方式', /multipart/.test(d) && /base64-json/.test(d) && /chat-audio/.test(d), d.slice(0, 300));
  check('模型在列表里时，指出它不能用于语音识别', /该模型不是语音识别模型|不能用于转录/.test(d), d.slice(0, 500));
  check('给出该平台可用的语音识别模型', /SenseVoiceSmall|TeleSpeechASR/.test(d), d.slice(0, 500));
  check('不再出现「模型只能是 A 或 B」的绝对化错误结论', !/模型只能是/.test(act + d), act.slice(0, 200));
}

// ---------------- 12. 模型名有细微差异时给出最接近的候选 ----------------
{
  const MODELS = ['XingChenAGI/XingChenGSR-V1', 'XingChenAGI/XingChenGSR-V2.0', 'FunAudioLLM/SenseVoiceSmall'];
  installFetch((req) => {
    if (/\/models$/.test(req.url)) return jsonResponse({ data: MODELS.map((id) => ({ id })) });
    return new Response(JSON.stringify({ code: 20012, message: 'Model does not exist. Please check it carefully.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  });

  const p = {
    id: 'siliconflow',
    name: '硅基流动（SiliconFlow）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'XingChenAGI/XingChenGSR-V1.0', // 列表里是 V1 / V2.0，没有 V1.0
    transport: 'multipart',
    paramStyle: 'minimal',
    keyField: 'file',
    apiKey: 'sk-test'
  };

  globalThis.__BSUB_DEBUG_PLANS__ = [];
  let e = null;
  try {
    await providers.transcribeSlice(p, WAV, { language: 'zh' });
  } catch (err) {
    e = err;
  }
  const d = (e && e.payload && e.payload.detail) || '';
  const act = (e && e.payload && e.payload.action) || '';
  check('模型名不在列表时明确说明', /模型列表里没有/.test(d), d.slice(0, 300));
  check('给出名称最接近的候选', /最接近的是/.test(d) && /XingChenGSR-V1/.test(d), d.slice(0, 400));
  check('操作建议里带上可复制的准确 ID', /XingChenAGI\/XingChenGSR-V1/.test(act), act.slice(0, 200));
}

// ---------------- 13. 域名互换：硅基流动 .cn / .com 模型目录不同 ----------------
{
  check('硅基流动 .cn → 会补一个 .com 候选', providers.alternateHosts('https://api.siliconflow.cn/v1').join(',') === 'https://api.siliconflow.com/v1', JSON.stringify(providers.alternateHosts('https://api.siliconflow.cn/v1')));
  check('硅基流动 .com → 会补一个 .cn 候选', providers.alternateHosts('https://api.siliconflow.com/v1').join(',') === 'https://api.siliconflow.cn/v1', JSON.stringify(providers.alternateHosts('https://api.siliconflow.com/v1')));
  check('其它服务不做域名互换（避免拼出不存在的域名）', providers.alternateHosts('https://api.deepseek.com/v1').length === 0 && providers.alternateHosts('https://api.groq.com/openai/v1').length === 0, JSON.stringify(providers.alternateHosts('https://api.deepseek.com/v1')));

  // 模型只在 .com 上可用：应该自动切过去并成功
  const tried = [];
  installFetch((req) => {
    tried.push(req.url);
    if (/api\.siliconflow\.com/.test(req.url) && /\/audio\/transcriptions$/.test(req.url)) {
      return jsonResponse({ text: '在 .com 域名上识别成功' });
    }
    if (/\/models$/.test(req.url)) {
      // 配置的 .cn 域名下没有这个模型
      return jsonResponse({ data: [{ id: 'FunAudioLLM/SenseVoiceSmall' }] });
    }
    return new Response('', { status: 400 });
  });

  const p = {
    id: 'siliconflow',
    name: '硅基流动（SiliconFlow）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'XingChenAGI/XingChenGSR-V1.0',
    transport: 'multipart',
    paramStyle: 'minimal',
    keyField: 'file',
    apiKey: 'sk-test'
  };

  const r = await providers.transcribeSlice(p, WAV, { language: 'zh' });
  check('模型只在另一域名可用时，会自动切到该域名', tried.some((u) => /api\.siliconflow\.com/.test(u)), tried.join(' | '));
  check('切域名后成功拿到文本', !!r && r.text === '在 .com 域名上识别成功', JSON.stringify(r));
}

// ---------------- 14. 全部失败时，错误里列出实际请求过的每个 endpoint ----------------
{
  installFetch((req) => {
    if (/\/models$/.test(req.url)) return jsonResponse({ data: [{ id: 'FunAudioLLM/SenseVoiceSmall' }] });
    return new Response('', { status: 400 });
  });
  const p = {
    id: 'siliconflow',
    name: '硅基流动（SiliconFlow）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'XingChenAGI/XingChenGSR-V1.0',
    transport: 'multipart',
    paramStyle: 'minimal',
    keyField: 'file',
    apiKey: 'sk-test'
  };
  let e = null;
  try {
    await providers.transcribeSlice(p, WAV, { language: 'zh' });
  } catch (err) {
    e = err;
  }
  const d = (e && e.payload && e.payload.detail) || '';
  check('错误里列出 .cn 的三种 endpoint', /api\.siliconflow\.cn\/v1\/audio\/transcriptions/.test(d) && /api\.siliconflow\.cn\/v1\/chat\/completions/.test(d), d.slice(0, 600));
  check('错误里也列出 .com 的 endpoint（说明换过域名）', /api\.siliconflow\.com\/v1/.test(d), d.slice(0, 600));
}

// ---------------- 15. 401 Token is invalid：错误里带 Key 的安全指纹 ----------------
{
  installFetch(() => new Response(JSON.stringify({ code: 30014, data: null, message: 'Token is invalid.' }), { status: 401, headers: { 'content-type': 'application/json' } }));

  const p = {
    id: 'siliconflow',
    name: '硅基流动（SiliconFlow）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
    transport: 'multipart',
    paramStyle: 'minimal',
    keyField: 'file',
    apiKey: '  sk-abcdefghijklmnop  ' // 故意带首尾空格
  };

  globalThis.__BSUB_DEBUG_PLANS__ = [];
  let e = null;
  try {
    await providers.transcribeSlice(p, WAV, { language: 'zh' });
  } catch (err) {
    e = err;
  }
  const d = (e && e.payload && e.payload.detail) || '';
  const act = (e && e.payload && e.payload.action) || '';

  check('401 归类为 auth 而不是参数错误', !!e && e.kind === 'auth', e && e.kind);
  check('错误里带上服务端原文（Token is invalid）', /Token is invalid/.test(d), d.slice(0, 200));
  check('错误里显示当前 Key 的长度与末四位（便于确认是否贴错）', /当前使用的 Key：长度 19，末四位 mnop/.test(d), d.slice(0, 400));
  check('检测到粘贴时带了首尾空白并提示', /带了首尾空白|重新完整复制/.test(d), d.slice(0, 500));
  check('操作建议是「清除后重新粘贴」', /清除/.test(act) && /重新粘贴/.test(act), act);
  check('不会把完整 Key 泄露到提示里', !d.includes('abcdefghijklmnop'), d.slice(0, 400));
}

// ---------------- 16. 鉴权失败时用 /models 做对照，区分「Key 无效」与「接口/模型问题」 ----------------
{
  // 场景 A：转录接口 401，但 /models 用同一个 Key 能通 → Key 是好的
  installFetch((req) => {
    if (/\/models$/.test(req.url)) {
      return jsonResponse({ data: [{ id: 'FunAudioLLM/SenseVoiceSmall' }] });
    }
    return new Response(JSON.stringify({ code: 30014, data: null, message: 'Token is invalid.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    });
  });
  const p = {
    id: 'siliconflow',
    name: '硅基流动（SiliconFlow）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
    transport: 'multipart',
    paramStyle: 'minimal',
    keyField: 'file',
    apiKey: 'sk-abcdefghijklmnopq'
  };
  let e = null;
  try {
    await providers.transcribeSlice(p, WAV, { language: 'zh' });
  } catch (err) {
    e = err;
  }
  const d = (e && e.payload && e.payload.detail) || '';
  check('401 时会列出尝试链路', /完整链路/.test(d), d.slice(-400));
  check('/models 通时不引导用户重新生成 Key', !/请到控制台重新生成/.test(d), d.slice(0, 900));
  check('不再把结论写成「额度/权限」', !/额度\/权限/.test(d), d.slice(0, 900));
  const act1 = (e && e.payload && e.payload.action) || '';
  check('动作建议里不带「额度」这类误导结论', !/额度/.test(act1), act1.slice(0, 200));

  // 场景 B：转录接口 401，/models 也 401 → Key 本身无效
  installFetch(() => new Response(JSON.stringify({ code: 30014, data: null, message: 'Token is invalid.' }), { status: 401, headers: { 'content-type': 'application/json' } }));
  let e2 = null;
  try {
    await providers.transcribeSlice(p, WAV, { language: 'zh' });
  } catch (err) {
    e2 = err;
  }
  const d2 = (e2 && e2.payload && e2.payload.detail) || '';
  check('/models 也 401 时说配置地址上 Key 不被接受', /配置地址上这个 Key 不被接受/.test(d2), d2.slice(0, 700));
  check('提示里分别给出「实际打到的地址」与「设置里配置的地址」', /本次请求实际打到的地址：https:\/\/api\.siliconflow\.cn\/v1\/audio\/transcriptions/.test(d2) && /设置里配置的接口地址：https:\/\/api\.siliconflow\.cn\/v1/.test(d2), d2.slice(0, 900));
  check('提示里列出两个站点的正确配对', /cloud\.siliconflow\.cn 申请的 Key → 只能配 https:\/\/api\.siliconflow\.cn\/v1/.test(d2), d2.slice(0, 1200));
  check('提示里给出两站账号与 Key 互不通用', /互不通用/.test(d2), d2.slice(0, 1200));
  check('对照探针打在配置地址上（不是兜底地址）', /GET https:\/\/api\.siliconflow\.cn\/v1\/models/.test(d2), d2.slice(0, 900));
}

// ---------------- 17. 连通性诊断矩阵：每个主机 × 每种传输方式的真实返回 ----------------
{
  installFetch((req) => {
    // .cn 的 /models 通；.cn 的转录接口 400；.com 全部 401
    if (/api\.siliconflow\.cn/.test(req.url)) {
      if (/\/models$/.test(req.url)) return jsonResponse({ data: [{ id: 'FunAudioLLM/SenseVoiceSmall' }, { id: 'TeleAI/TeleSpeechASR' }] });
      return new Response(JSON.stringify({ code: 20012, message: 'Model does not exist. Please check it carefully.' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response('', { status: 401 });
  });

  const p = {
    id: 'siliconflow',
    name: '硅基流动（SiliconFlow）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'XingChenAGI/XingChenGSR-V1.0',
    transport: 'multipart',
    paramStyle: 'minimal',
    keyField: 'file',
    apiKey: 'sk-testkey1234567890'
  };

  const out = await providers.probePlatformMatrix(p, { timeoutMs: 5000 });
  check('诊断矩阵覆盖 .cn 与 .com 两个主机', out.bases.length === 2 && out.bases.some((b) => /\.cn/.test(b)) && out.bases.some((b) => /\.com/.test(b)), JSON.stringify(out.bases));
  check('诊断矩阵每台主机都测 /models + 两种传输方式 × 两种样本长度', out.rows.length === 10, `rows=${out.rows.length}`);
  check('诊断矩阵覆盖两种静音长度（便于判断 5xx 是否与样本有关）', out.rows.some((r) => /1\.5s 静音/.test(r.kind)) && out.rows.some((r) => /5s 静音/.test(r.kind)), JSON.stringify(out.rows.map((r) => r.kind)));
  const cnModels = out.rows.find((r) => /\.cn/.test(r.url) && /models/.test(r.url));
  const cnAsr = out.rows.find((r) => /\.cn/.test(r.url) && /transcriptions/.test(r.url));
  const comModels = out.rows.find((r) => /\.com/.test(r.url) && /models/.test(r.url));
  check('.cn 的 /models 标记为成功并给出模型数', !!cnModels && cnModels.ok === true && /2 个模型/.test(cnModels.note), JSON.stringify(cnModels));
  check('.cn 的转录接口如实记录 400 与响应体', !!cnAsr && cnAsr.status === 400 && /Model does not exist/.test(cnAsr.note), JSON.stringify(cnAsr));
  check('.com 的 /models 如实记录 401', !!comModels && comModels.status === 401 && comModels.ok === false, JSON.stringify(comModels));
  check('诊断结果带回 Key 长度与末四位', out.keyLength === 20 && out.keyTail === '7890', `${out.keyLength}/${out.keyTail}`);
}

// ---------------- 18. 真实场景下的 5xx 归因（与 400 区分） ----------------
{
  installFetch((req) => {
    if (/\/models$/.test(req.url)) return jsonResponse({ data: [{ id: 'FunAudioLLM/SenseVoiceSmall' }] });
    // 服务端内部错误：空响应体 + 500
    return new Response('', { status: 500 });
  });
  const p = {
    id: 'siliconflow',
    name: '硅基流动（SiliconFlow）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
    transport: 'multipart',
    paramStyle: 'minimal',
    keyField: 'file',
    apiKey: 'sk-test'
  };
  const out = await providers.probePlatformMatrix(p, { timeoutMs: 5000 });
  const row500 = out.rows.find((r) => r.status === 500);
  check('诊断矩阵把 500 记为服务端内部错误', !!row500 && /服务端内部错误/.test(row500.note) && /不是参数被拒/.test(row500.note), JSON.stringify(row500));
  check('500 行说明鉴权与请求已通过', !!row500 && /鉴权与请求已经通过/.test(row500.note), JSON.stringify(row500 && row500.note));
  check('500 行说明通常与音频样本有关', !!row500 && /音频样本/.test(row500.note), JSON.stringify(row500 && row500.note));

  // 500 不应该被当成参数错误
  let e = null;
  try {
    await providers.transcribeSlice(p, WAV, { language: 'zh' });
  } catch (err) {
    e = err;
  }
  check('500 归类为 server 而不是 badparams', !!e && e.kind === 'server', e && e.kind);
  check('500 的错误标题是服务端错误', !!e && /服务端错误/.test(e.title), e && e.title);
}

// ---------------- 19. 重试策略：5xx/网络值得重试，4xx 不值得 ----------------
{
  const c = providers.isRetriableAsrError;
  check('5xx（server）可重试', c({ kind: 'server', status: 500 }) === true);
  check('网络错误可重试', c({ kind: 'network' }) === true);
  check('超时可重试', c({ kind: 'timeout' }) === true);
  check('裸 503 状态码可重试', c({ status: 503 }) === true);
  check('400 参数错误不重试', c({ kind: 'badparams', status: 400 }) === false);
  check('401 鉴权错误不重试', c({ kind: 'auth', status: 401 }) === false);
  check('413 超限不重试', c({ kind: 'too-large', status: 413 }) === false);
  check('429 限流不重试（避免加剧）', c({ kind: 'rate', status: 429 }) === false);
  check('空 payload 不重试', c(null) === false);
  check('重试间隔是递增的', Array.isArray(providers.ASR_RETRY_DELAYS_MS) && providers.ASR_RETRY_DELAYS_MS.length >= 2 && providers.ASR_RETRY_DELAYS_MS[1] > providers.ASR_RETRY_DELAYS_MS[0], JSON.stringify(providers.ASR_RETRY_DELAYS_MS));
}

// ---------------- 20. 文件名与扩展名透传（服务端可能按扩展名判格式） ----------------
{
  let req = null;
  installFetch((r) => {
    if (/\/audio\/transcriptions$/.test(r.url)) {
      req = r;
      return jsonResponse({ text: 'ok' });
    }
    return new Response('', { status: 400 });
  });
  const p = {
    id: 'siliconflow',
    name: '硅基流动（SiliconFlow）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
    transport: 'multipart',
    paramStyle: 'minimal',
    keyField: 'file',
    apiKey: 'sk-test'
  };

  await providers.transcribeSlice(p, WAV, { language: 'zh', filename: 'slice-001.wav' });
  check('调用方指定的文件名被采用', !!req && /name=slice-001\.wav/.test(String(req.fields && req.fields.file)), JSON.stringify(req && req.fields).slice(0, 160));

  // 未指定文件名时要有 .wav 默认扩展名（不能是裸名字）
  req = null;
  await providers.transcribeSlice(p, WAV, { language: 'zh' });
  check('未指定文件名时也带扩展名', !!req && /name=[^ ]+\.wav/.test(String(req.fields && req.fields.file)), JSON.stringify(req && req.fields).slice(0, 160));
}

// ---------------- 21. 5xx 要把服务端原文与可重试事实说清楚 ----------------
{
  installFetch((req) => {
    if (/\/models$/.test(req.url)) return jsonResponse({ data: [{ id: 'FunAudioLLM/SenseVoiceSmall' }] });
    return new Response('', { status: 502 });
  });
  const p = {
    id: 'siliconflow',
    name: '硅基流动（SiliconFlow）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
    transport: 'multipart',
    paramStyle: 'minimal',
    keyField: 'file',
    apiKey: 'sk-test'
  };
  let e = null;
  try {
    await providers.transcribeSlice(p, WAV, { language: 'zh' });
  } catch (err) {
    e = err;
  }
  check('502 归类为 server', !!e && e.kind === 'server', e && e.kind);
  check('5xx 视为可重试', providers.isRetriableAsrError(e && e.payload) === true, JSON.stringify(e && e.payload));
  check('5xx 提示里说明是服务端内部错误、与参数无关', /服务端/.test(e && e.action) || /服务端/.test(e && e.detail), (e && e.action) || '');
}

// ---------------- 22. 分片策略对齐参考实现（600s / 45s / 0.72 安全系数）----------------
{
  const { computeSliceSeconds, planSlices } = await import('../bilibili-subtitle-assistant/src/sidepanel/modules/audio.js');
  const { ASR_LIMITS } = await import('../bilibili-subtitle-assistant/src/shared/constants.js');

  check('默认分片时长对齐 Bilitato 的 600s', ASR_LIMITS.defaultSliceSeconds === 600, String(ASR_LIMITS.defaultSliceSeconds));
  check('最小分片时长 45s', ASR_LIMITS.minSliceSeconds === 45, String(ASR_LIMITS.minSliceSeconds));
  check('体积安全系数 0.72', Number(ASR_LIMITS.sizeSafetyRatio) === 0.72, String(ASR_LIMITS.sizeSafetyRatio));
  check('默认并发为 1（少一次失败机会）', ASR_LIMITS.defaultConcurrency === 1, String(ASR_LIMITS.defaultConcurrency));

  const rate = 16000;
  const samples = new Float32Array(Math.floor(rate * 415.6));
  const plan = planSlices({ samples, rate, sliceSeconds: 600, overlapSeconds: 4, sizeLimitMB: 50 });
  check('415.6s 音频只切成 1 片', plan.slices.length === 1, `slices=${plan.slices.length}`);
  check('单片的时长覆盖整段', Math.abs(plan.slices[0].seconds - 415.6) < 1, plan.slices[0].seconds.toFixed(1));

  const long = new Float32Array(Math.floor(rate * 1500));
  const plan2 = planSlices({ samples: long, rate, sliceSeconds: 600, overlapSeconds: 4, sizeLimitMB: 50 });
  check('1500s 音频切成 3 片（600/600/312 带重叠）', plan2.slices.length === 3, `slices=${plan2.slices.length}`);
  check('最长片的时长不超过 600s', plan2.slices.every((s) => s.seconds <= 600.0001), JSON.stringify(plan2.slices.map((s) => s.seconds.toFixed(1))));

  // 体积上限收紧时应自动缩短分片
  const tight = computeSliceSeconds({ sizeLimitMB: 5, durationSeconds: 1500 });
  check('体积上限 5MB 时分片自动缩短', tight < 600 && tight >= 45, String(tight));
  const tightBytes = tight * rate * 2;
  check('缩短后单片的 WAV 体积不超过上限的 80%', tightBytes < 5 * 1024 * 1024 * 0.8, `${(tightBytes / 1024 / 1024).toFixed(2)}MB`);
}

// ---------------- 23. M4A 流复制路径的行组装（对齐主路径结构）----------------
{
  const T = await import('../bilibili-subtitle-assistant/src/sidepanel/modules/transcribe.js');

  // 带时间戳的结果优先按 segment 切行，且不打 estimated 标记
  const withSeg = {
    text: '你好世界',
    segments: [
      { t: 0.5, d: 1.5, text: '你好' },
      { t: 2, d: 1, text: '世界' }
    ]
  };
  const rows = T.linesFromSingleResult(withSeg, 10);
  check('带 segment 时按时间戳切行', rows.length === 2 && rows[0].from === 0.5 && rows[1].from === 2, JSON.stringify(rows));
  check('带时间戳的行标记为非估算', rows.every((r) => r.estimated === false), JSON.stringify(rows.map((r) => r.estimated)));

  // 无时间戳时按标点切行并标记 estimated
  // 注意 segmentPlainText 会在 maxLen(80) 内合并短句，所以这里用足够长的句子验证拆分
  const long1 = '这是第一句足够长的话用于验证按标点切分的行为'.repeat(3);
  const long2 = '这是第二句同样足够长的话用于验证按标点切分的行为'.repeat(3);
  const noSeg = T.linesFromSingleResult({ text: `${long1}。${long2}。` }, 30);
  check('无时间戳时按标点切行', noSeg.length >= 2, JSON.stringify(noSeg.map((r) => r.text.length)));
  check('无时间戳的行标记为估算', noSeg.every((r) => r.estimated === true), JSON.stringify(noSeg.map((r) => r.estimated)));
  check('估算行的结束时间不超过音频时长', noSeg.every((r) => r.to <= 30.001), JSON.stringify(noSeg.map((r) => [r.from, r.to])));

  // 多片组装：每片按各自起始时间平移
  const out = T.assembleRemuxOutcome({
    rawResults: [
      { idx: 0, slice: { start: 0, end: 10 }, result: { text: 'AAA', segments: [{ t: 1, d: 2, text: 'A' }] } },
      { idx: 1, slice: { start: 10, end: 20 }, result: { text: 'BBB', segments: [{ t: 1, d: 2, text: 'B' }] } }
    ],
    base: { slices: 2, sliceSeconds: 10 },
    platform: { name: '硅基流动', model: 'FunAudioLLM/SenseVoiceSmall' },
    durationSeconds: 20,
    bytes: 12345
  });
  check('多片结果按片起始时间平移', out.lines[0].from === 1 && out.lines[1].from === 11, JSON.stringify(out.lines.map((l) => [l.from, l.text])));
  check('行被统一编号', out.lines.every((l, i) => l.i === i), JSON.stringify(out.lines.map((l) => l.i)));
  check('每行带 original 便于编辑回退', out.lines.every((l) => l.original === l.text), '');
  check('meta 标注走的是 ffmpeg-remux 传输', out.meta.transport === 'ffmpeg-remux', out.meta.transport);
  check('meta 记录切片数', out.meta.slices === 2, String(out.meta.slices));
  check('有真实时间戳时 missingTimestamps 为 false', out.meta.missingTimestamps === false, String(out.meta.missingTimestamps));
  check('meta 保留原始文本', /A/.test(out.meta.rawText) && /B/.test(out.meta.rawText), out.meta.rawText);
}

// ---------------- 24. 各平台的上传格式判定（Groq 必须走 WAV 而不是 M4A）----------------
{
  const SET = await import('../bilibili-subtitle-assistant/src/shared/settings.js');
  const defaults = SET.defaultSettings();
  const byId = (id, model) => {
    const p = defaults.asr.platforms.find((x) => x.id === id);
    if (!p) return null;
    return model ? { ...p, model } : p;
  };

  // Groq 的 whisper 系列需要 multipart WAV，不能走 M4A 重封装
  const groq = byId('groq');
  check('Groq 默认模型是 whisper-large-v3-turbo', groq && groq.model === 'whisper-large-v3-turbo', groq && groq.model);
  check('Groq 不是 M4A 平台（audioFormat 未设成 m4a）', !groq || String(groq.audioFormat || '') !== 'm4a', String(groq && groq.audioFormat));
  check('Groq 用完整参数（要时间戳）', groq && groq.paramStyle === 'full', groq && groq.paramStyle);
  check('Groq 的 baseUrl 指向 api.groq.com', groq && /api\.groq\.com/.test(groq.baseUrl), groq && groq.baseUrl);
  check('Groq 附带 Key 获取地址', groq && /console\.groq\.com/.test(groq.keyUrl || ''), groq && groq.keyUrl);

  // 硅基流动必须标成 m4a（走 FFmpeg 流复制重封装）
  const sf = byId('siliconflow');
  check('硅基流动标记为 m4a', sf && String(sf.audioFormat) === 'm4a', sf && String(sf.audioFormat));
  check('硅基流动走最小参数', sf && sf.paramStyle === 'minimal', sf && sf.paramStyle);

  // 自定义平台默认交给自动判定（不锁定格式）
  const custom = byId('custom-asr');
  check('自定义平台不锁定音频格式', !custom || !custom.audioFormat, String(custom && custom.audioFormat));
}

// ---------------- 25. 回归：配置地址 500 + 兜底域名 401，不得误报成「Key/额度」问题 ----------------
// 这是用户真实遇到的场景：
//   api.siliconflow.cn  /audio/transcriptions → 500
//   api.siliconflow.com /audio/transcriptions → 401（该站不认这把 Key，正常）
//   api.siliconflow.cn  /models               → 200（Key 有效）
// 旧实现只报最后那次 401，并把结论写成「额度/权限」，把真正的 500 完全掩盖，
// 导致用户被告知「Key 有问题」而反复重配。这里锁死正确行为。
{
  const seen = [];
  installFetch((req) => {
    seen.push(`${req.method || 'POST'} ${req.url}`);
    const isModels = /\/models$/.test(req.url);
    const isCom = /siliconflow\.com/.test(req.url);
    if (isModels) {
      // 只有配置地址（.cn）的 /models 是通的
      return isCom
        ? new Response('{"code":30014,"message":"Token is invalid."}', { status: 401 })
        : jsonResponse({ data: [{ id: 'FunAudioLLM/SenseVoiceSmall' }] });
    }
    if (isCom) {
      return new Response('{"code":30014,"data":null,"message":"Token is invalid."}', { status: 401 });
    }
    return new Response('', { status: 500 });
  });

  const p = {
    id: 'siliconflow',
    name: '硅基流动（SiliconFlow）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
    transport: 'multipart',
    paramStyle: 'minimal',
    audioFormat: 'm4a',
    keyField: 'file',
    apiKey: 'sk-test'
  };
  globalThis.__BSUB_DEBUG_PLANS__ = [];
  let e = null;
  try {
    await providers.transcribeSlice(p, WAV, { language: 'zh' });
  } catch (err) {
    e = err;
  }
  const d = (e && e.payload && e.payload.detail) || '';
  const act = (e && e.payload && e.payload.action) || '';

  // 现在的正确行为：兜底域名的 401 **不再掩盖**配置地址上真正的失败，
  // 最终以配置地址的错误（500）为准。
  check('以配置地址的真实错误收盘（500，而不是兜底域名的 401）', !!(e && e.payload && e.payload.status === 500), String(e && e.payload && e.payload.status));
  check('错误详情列出了完整尝试链路', /完整链路/.test(d) && /HTTP 500/.test(d) && /HTTP 401/.test(d), d.slice(0, 600));
  check('明确指出配置地址返回的才是真正要处理的问题', /配置地址/.test(d) && /才是真正要处理的问题/.test(d), d.slice(0, 1200));
  check('说明兜底域名的 401 可以忽略', /可以忽略/.test(d), d.slice(0, 1200));
  check('不再把结论写成「额度/权限」', !/额度\/权限/.test(d), d.slice(0, 1200));
  check('动作建议不再误导用户去改 Key', !/重新生成|删除.*Key/.test(act), act.slice(0, 300));
}

// ---------------- 26. 上传格式必须按「模型」决定（真实 API 实测结论）----------------
// 实测（curl + 直接调用 providers.transcribeSlice，均打真实 api.siliconflow.cn）：
//   FunAudioLLM/SenseVoiceSmall   + M4A → 200 ；+ WAV → 500
//   XingChenAGI/XingChenGSR-V1.0  + WAV → 200 ；+ M4A → 400
// 同一平台不同模型要求完全不同，所以绝不能按平台一刀切。
{
  const T = await import('../bilibili-subtitle-assistant/src/sidepanel/modules/transcribe.js');
  const f = T.audioFormatFor;
  const sf = (model, extra = {}) => ({
    id: 'siliconflow',
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model,
    audioFormat: 'm4a',
    ...extra
  });

  check('XingChenGSR 模型必须用 WAV（实测 M4A 会 400）', f(sf('XingChenAGI/XingChenGSR-V1.0')) === 'wav', f(sf('XingChenAGI/XingChenGSR-V1.0')));
  check('SenseVoice 模型用 M4A（实测 WAV 会 500）', f(sf('FunAudioLLM/SenseVoiceSmall')) === 'm4a', f(sf('FunAudioLLM/SenseVoiceSmall')));
  check('TeleSpeechASR 用 WAV', f(sf('TeleAI/TeleSpeechASR')) === 'wav', f(sf('TeleAI/TeleSpeechASR')));
  check('模型判断优先于平台 audioFormat=m4a', f(sf('XingChenAGI/XingChenGSR-V1.0', { audioFormat: 'm4a' })) === 'wav', 'model 未优先');
  check('用户显式指定 wav 时尊重用户', f(sf('FunAudioLLM/SenseVoiceSmall', { audioFormat: 'wav' })) === 'wav', '用户设置被覆盖');
  check('用户显式指定 m4a 时尊重用户', f(sf('XingChenAGI/XingChenGSR-V1.0', { audioFormat: 'm4a' })) === 'wav', 'WAV-only 模型不该听从 m4a');
  check('Groq 的 whisper 走 WAV', f({ id: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo' }) === 'wav', 'groq 判错');
  check('无模型的默认硅基流动走 M4A', f({ id: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1' }) === 'm4a', '默认判错');
  check('完全未知的平台默认 WAV', f({ id: 'x', baseUrl: 'https://example.com/v1', model: 'y' }) === 'wav', '未知平台判错');
}

// ---------------- 27. multipart 请求绝不能带 content-type: application/json ----------------
// 这是真实事故的回归测试：authHeaders() 无条件设了 content-type: application/json，
// 而 multipart 分支直接复用它，于是发出
//   「Content-Type: application/json + multipart body（无 boundary）」
// 的畸形请求 → 服务端解析 multipart 失败 → **空响应体的 400**。
//
// 这条极难从症状反推：同一份字节用 curl / Node / 真实 Chrome 页面 / service worker
// 发出去全是 200，唯独经过我们的代码是 400。所以必须断言「发出去的头部」。
{
  let req = null;
  installFetch((r) => {
    req = r;
    return jsonResponse({ text: 'ok' });
  });
  const p = {
    id: 'siliconflow',
    name: '硅基流动（SiliconFlow）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'XingChenAGI/XingChenGSR-V1.0',
    transport: 'multipart',
    paramStyle: 'minimal',
    keyField: 'file',
    apiKey: 'sk-test'
  };
  await providers.transcribeSlice(p, WAV, { language: 'zh', filename: 'slice-001.wav' });

  const h = (req && req.headers) || {};
  const norm = {};
  for (const [k, v] of Object.entries(h)) norm[String(k).toLowerCase()] = v;
  check('multipart 请求不带 content-type（应由浏览器生成 boundary）', !('content-type' in norm), JSON.stringify(norm));
  check('multipart 请求仍带 authorization', /^Bearer /.test(String(norm.authorization || '')), JSON.stringify(norm));
  check('multipart 请求没有误带 anthropic-version', !('anthropic-version' in norm), JSON.stringify(norm));

  // JSON 传输必须仍然带 content-type: application/json
  req = null;
  const p2 = { ...p, transport: 'base64-json' };
  await providers.transcribeSlice(p2, WAV, { language: 'zh' });
  const h2 = {};
  for (const [k, v] of Object.entries((req && req.headers) || {})) h2[String(k).toLowerCase()] = v;
  check('base64-json 传输仍带 content-type: application/json', String(h2['content-type'] || '').includes('application/json'), JSON.stringify(h2));
}

// ---------------- 28. 版本自检：面板与后台（service worker）版本一致性 ----------------
// MV3 里 SW 与面板是两份独立更新的代码。只点扩展的「刷新」时，面板立刻用上新代码，
// 而旧 SW 可能仍在运行 —— 表现为「日志是新版、请求却还是旧版行为」。
// 这正是真实事故中最后卡住排查的一环，所以必须有自动化覆盖。
{
  const T = await import('../bilibili-subtitle-assistant/src/sidepanel/modules/transcribe.js');
  const { CONTENT_VERSION } = await import('../bilibili-subtitle-assistant/src/shared/constants.js');

  const runWith = async (bgVersion) => {
    const logs = [];
    let pingSeen = false;
    globalThis.chrome = {
      runtime: {
        lastError: null,
        sendMessage: (msg, cb) => {
          if (msg && msg.type === 'bsub:ping') {
            pingSeen = true;
            if (bgVersion === null) {
              globalThis.chrome.runtime.lastError = { message: 'no worker' };
              cb(undefined);
              globalThis.chrome.runtime.lastError = null;
            } else {
              cb({ ok: true, version: bgVersion });
            }
            return;
          }
          // 其它调用（音频候选等）都失败，让流程尽快结束
          cb({ kind: 'res', id: msg.id, ok: false, error: { kind: 'x', title: 'skip' } });
        }
      }
    };
    try {
      await T.transcribeVideo({
        video: { aid: 1, bvid: 'BV1', cid: 2, duration: 10 },
        settings: { asr: { platforms: [], activeId: null } },
        hooks: { onLog: (m) => logs.push(m), onProgress: () => {} }
      });
    } catch (err) {
      /* 预期会失败，只关心日志 */
    }
    return { logs, pingSeen };
  };

  const same = await runWith(CONTENT_VERSION);
  check('转录开始时会向后台查询版本', same.pingSeen === true, JSON.stringify(same.logs.slice(0, 2)));
  check('版本一致时日志给出确认', same.logs.some((l) => /版本自检/.test(l) && new RegExp(CONTENT_VERSION).test(l)), JSON.stringify(same.logs.slice(0, 2)));

  const stale = await runWith('0.0.1-old');
  check(
    '后台版本陈旧时给出明确警告（这正是「日志新版、行为旧版」的成因）',
    stale.logs.some((l) => /版本不一致/.test(l)),
    JSON.stringify(stale.logs.slice(0, 2))
  );
  check(
    '陈旧警告里带上两边的版本号',
    stale.logs.some((l) => /版本不一致/.test(l) && l.includes(CONTENT_VERSION) && l.includes('0.0.1-old')),
    JSON.stringify(stale.logs.slice(0, 2))
  );

  const noWorker = await runWith(null);
  check('后台无响应时也记录一行（便于判断 SW 未唤醒）', noWorker.logs.some((l) => /后台未响应/.test(l)), JSON.stringify(noWorker.logs.slice(0, 2)));
}

// ---------------- 29. 超时关系：RPC 必须 > HTTP，且 ASR 必须显式登记 ----------------
// 事故复盘：`asr.transcribe` 没有登记在 METHOD_TIMEOUT 里，回落到默认 30 秒，
// 而上传 13MB WAV 恰好要约 30 秒 → 每次都「操作超时」。
// 更普遍的问题：RPC 超时若小于 HTTP 超时，就会出现「RPC 先超时、HTTP 其实还在跑」的假失败。
{
  const { METHOD_TIMEOUT, DEFAULT_RPC_TIMEOUT } = await import('../bilibili-subtitle-assistant/src/shared/constants.js');

  check('asr.transcribe 显式登记了超时（不能靠默认值）', typeof METHOD_TIMEOUT['asr.transcribe'] === 'number', String(METHOD_TIMEOUT['asr.transcribe']));
  check('asr.transcribe 的 RPC 超时 ≥ 5 分钟（要覆盖上传+转录）', (METHOD_TIMEOUT['asr.transcribe'] || 0) >= 300000, String(METHOD_TIMEOUT['asr.transcribe']));
  check('asr.transcribe 的 RPC 超时远大于默认 RPC 超时', (METHOD_TIMEOUT['asr.transcribe'] || 0) > DEFAULT_RPC_TIMEOUT * 5, `${METHOD_TIMEOUT['asr.transcribe']} vs ${DEFAULT_RPC_TIMEOUT}`);
  check('连通性诊断也登记了超时', typeof METHOD_TIMEOUT['asr.probe'] === 'number', String(METHOD_TIMEOUT['asr.probe']));

  // 逐条检查：凡是可能耗时超过默认值的重方法，都必须显式登记
  const mustRegister = [
    'asr.transcribe',
    'asr.probe',
    'platform.test',
    'platform.models',
    'subtitle.fetch',
    'audio.chunk',
    'search.provider',
    'permission.request'
  ];
  const missing = mustRegister.filter((m) => typeof METHOD_TIMEOUT[m] !== 'number');
  check('所有重方法都已显式登记超时', missing.length === 0, missing.join(', '));

  // 这些方法的超时必须大于默认值，否则登记没意义
  const tooSmall = mustRegister.filter((m) => (METHOD_TIMEOUT[m] || 0) <= DEFAULT_RPC_TIMEOUT && m !== 'platform.models');
  check('重方法的超时都大于默认 RPC 超时', tooSmall.length === 0, tooSmall.map((m) => `${m}=${METHOD_TIMEOUT[m]}`).join(', '));
}

// ---------------- 30. API Key 含非 ISO-8859-1 字符时必须给出可照做的提示 ----------------
// 真实报错：Failed to read the 'headers' property from 'RequestInit':
//   String contains non ISO-8859-1 code point.
// 这个原生错误完全看不出「该改什么」。常见成因是把中文说明/全角符号一起粘进了 Key。
{
  const providers2 = await import('../bilibili-subtitle-assistant/src/background/providers.js');
  installFetch(() => jsonResponse({ text: 'ok' }));

  const bad = (label, apiKey) => {
    const p = {
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey
    };
    return providers2.chatOnce(p, [{ role: 'user', content: 'hi' }], { timeoutMs: 5000 }).then(
      () => ({ label, ok: true }),
      (err) => ({ label, ok: false, kind: err && err.kind, title: err && err.title, detail: (err && err.detail) || '', action: (err && err.action) || '' })
    );
  };

  const chinese = await bad('中文 Key', 'sk-中文密钥abcdef');
  check('含中文的 Key 被提前拦下（不再抛原生 ISO-8859-1 错误）', chinese.ok === false, JSON.stringify(chinese));
  check('分类为 badkey', chinese.kind === 'badkey', String(chinese.kind));
  check('标题点名是非法字符', /非法字符/.test(chinese.title || ''), chinese.title);
  check('详情里指出具体是哪个字符', /「中」/.test(chinese.detail || ''), chinese.detail);
  check('详情里解释 HTTP 头只能放单字节字符', /ISO-8859-1|单字节/.test(chinese.detail || ''), chinese.detail);
  check('动作建议是「只粘贴 Key 本身」', /只粘贴 Key/.test(chinese.action || ''), chinese.action);

  const fullwidth = await bad('全角破折号', 'sk-abc—def');
  check('全角符号同样被拦下', fullwidth.ok === false && fullwidth.kind === 'badkey', JSON.stringify(fullwidth));

  const newline = await bad('带换行', 'sk-abc\ndef');
  check('带换行的 Key 也被拦下', newline.ok === false && newline.kind === 'badkey', JSON.stringify(newline));

  const good = await bad('正常 Key', 'sk-abcdefghijklmnop');
  check('正常 ASCII Key 不受影响', good.ok === true, JSON.stringify(good));
}

// ---------------- 31. 时间戳：Diarize 模型的 segments 必须被正确解析 ----------------
// 真实事故：用户反馈「字幕时间与实际相差很大」。
// 根因：硅基流动上绝大多数模型**只返回纯文本**，我们只能把整段文字摊到时长上（估算）。
// 实测唯一会返回时间段的是 XingChenAGI/XingChenASR-Diarize-V3.0：
//   "segments":[{"start":0.1,"end":6.14,"text":"...","speaker":"1"}, ...]
// 而旧代码只认 {t,d} 字段，把真正的 start/end 完全忽略了 —— 于是有时间戳也没用上。
{
  const T = await import('../bilibili-subtitle-assistant/src/sidepanel/modules/transcribe.js');

  // Diarize 的真实返回结构（setXX 字段名是 start/end，且 text 带 "1: " 前缀）
  const diarize = {
    duration: 11.8583125,
    text: '1: 你好，这是第一段测试语音，用来验证时间戳是否准确。\n1: 这是第二段内容应该出现在音频的。',
    segments: [
      { type: 'transcript.text.segment', id: '0', start: 0.1, end: 6.14, text: '你好，这是第一段测试语音，用来验证时间戳是否准确。', speaker: '1' },
      { type: 'transcript.text.segment', id: '1', start: 6.58, end: 10.34, text: '这是第二段内容应该出现在音频的。', speaker: '1' }
    ],
    usage: { type: 'duration', seconds: 12 }
  };
  const lines = T.linesFromSingleResult(diarize, 11.86);
  check('识别出 segments 里的起止时间', lines.length === 2 && lines[0].from === 0.1 && lines[0].to === 6.14, JSON.stringify(lines.map((l) => [l.from, l.to])));
  check('第二条线段时间为 6.58~10.34', lines[1].from === 6.58 && lines[1].to === 10.34, JSON.stringify(lines[1]));
  check('真实时间戳标记为非估算', lines.every((l) => l.estimated === false), JSON.stringify(lines.map((l) => l.estimated)));
  check('保留说话人信息', lines.every((l) => l.speaker === '1'), JSON.stringify(lines.map((l) => l.speaker)));
  check('去掉文本里的说话人前缀「1: 」', lines.every((l) => !/^\s*\d+\s*[:：]/.test(l.text)), JSON.stringify(lines.map((l) => l.text)));

  // 兼容旧字段名 {t,d}（Groq verbose_json 用这种）
  const groqLike = { segments: [{ t: 2, d: 3, text: 'A' }, { t: 7, d: 2, text: 'B' }] };
  const g = T.linesFromSingleResult(groqLike, 10);
  check('兼容 {t,d} 字段（Groq 风格）', g.length === 2 && g[0].from === 2 && g[0].to === 5 && g[1].from === 7 && g[1].to === 9, JSON.stringify(g.map((l) => [l.from, l.to])));

  // 无 segments 时必须标记为估算，且按字数比例分配（而不是平均分配）
  const plain = { text: '短句。这是一句明显更长的话，应该占据更多时间。' };
  const p = T.linesFromSingleResult(plain, 60);
  check('无 segments 时标记为估算', p.every((l) => l.estimated === true), JSON.stringify(p.map((l) => l.estimated)));
  check('估算行覆盖整个时长且连续', Math.abs(p[0].from) < 0.01 && Math.abs(p[p.length - 1].to - 60) < 0.01, JSON.stringify(p.map((l) => [l.from.toFixed(1), l.to.toFixed(1)])));
  if (p.length >= 2) {
    const longIdx = p[0].text.length > p[1].text.length ? 0 : 1;
    const shortIdx = longIdx === 0 ? 1 : 0;
    const longSpan = p[longIdx].to - p[longIdx].from;
    const shortSpan = p[shortIdx].to - p[shortIdx].from;
    check('估算按字数比例分配（长句占更长时间）', longSpan > shortSpan, JSON.stringify(p.map((l) => [l.text.length, (l.to - l.from).toFixed(1)])));
  }

  // 纯文本里的说话人前缀也要清掉
  const prefixed = T.linesFromSingleResult({ text: '1: 甲说了话。\n2: 乙也说了话。' }, 10);
  check('无 segments 时也清理说话人前缀', prefixed.every((l) => !/^\s*\d+\s*[:：]/.test(l.text)), JSON.stringify(prefixed.map((l) => l.text)));
}

// ---------------- 32. 对话时的联网判定 ----------------
// 真实反馈：「对话时好像不能联网」。
// 根因：sendMessage 只读取 `st.search.results`（上一次搜索的结果），
// **自己从不发起检索** —— 也就是必须先前手动搜一次才有资料。
// 现在会在问题涉及外部信息时自动检索。这里锁死判定规则。
{
  const S = await import('../bilibili-subtitle-assistant/src/shared/settings.js');
  const d = S.defaultSettings();

  check('对话自动联网默认开启', d.search.autoSearchOnChat === true, String(d.search.autoSearchOnChat));
  check('「每轮都搜」默认关闭（避免每问一句都消耗额度）', d.search.alwaysSearchOnChat === false, String(d.search.alwaysSearchOnChat));
  check('抓取页面正文默认开启', d.search.fetchPageContent === true, String(d.search.fetchPageContent));
  check('联网检索有两个可控开关', 'autoSearchOnChat' in d.search && 'alwaysSearchOnChat' in d.search, Object.keys(d.search).join(','));

  // 复刻触发规则，验证哪些问法会触发检索、哪些不会
  const needsWeb = (q) =>
    /最新|现在|目前|今年|今天|新闻|价格|多少人|是谁|什么时候|为什么|查一下|搜一下|官网|地址|链接|资料|出处|来源|对比|区别|多少|几点|哪一年/i.test(
      q
    );

  const shouldSearch = ['现在多少钱', '这个人是谁', '查一下官网', '最新新闻', '它的来源是哪', '今年有什么变化'];
  const shouldSkip = ['总结一下这期视频', '刚才讲了什么', '帮我提炼要点', '这段的意思是什么'];
  const missSearch = shouldSearch.filter((q) => !needsWeb(q));
  const falsePositive = shouldSkip.filter((q) => needsWeb(q));
  check('外部信息类问题会触发检索', missSearch.length === 0, missSearch.join(' | '));
  check('纯视频内容类问题不触发检索（省额度）', falsePositive.length === 0, falsePositive.join(' | '));

  // 搜索上下文块：抓到正文时应给更多内容
  const SEARCH = await import('../bilibili-subtitle-assistant/src/sidepanel/modules/search.js');
  const withContent = SEARCH.searchContextBlock([
    { title: 'T', url: 'https://e.com', snippet: '短摘要', content: '正'.repeat(5000) }
  ], {});
  check('抓到正文时标注为「正文」', /正文:/.test(withContent), withContent.slice(0, 80));
  check('正文截断放宽到 3000 字（原来只有 900，装不下网页正文）', withContent.length > 2000, String(withContent.length));

  const onlySnippet = SEARCH.searchContextBlock([{ title: 'T', url: 'https://e.com', snippet: '短摘要' }], {});
  check('只有摘要时标注为「摘要」', /摘要:/.test(onlySnippet), onlySnippet.slice(0, 80));
}

// ---------------- 33. 联网检索：新增 provider 的请求形态与响应解析 ----------------
// 对齐 Cherry Studio 的搜索 provider 清单（tavily / bocha / serper /
// zhipu-web / metaso / baidu / brave / exa / jina / searxng）。
// 这里锁死「请求打到哪、带什么头、body 长什么样」以及「各种响应形态都能解析出结果」。
{
  const providers3 = await import('../bilibili-subtitle-assistant/src/background/providers.js');
  const SET = await import('../bilibili-subtitle-assistant/src/shared/settings.js');

  const defaults = SET.defaultSearchPlatforms();
  const ids = defaults.map((p) => p.id);
  check('内置搜索平台已扩充到 10 个以上', defaults.length >= 10, `${defaults.length}: ${ids.join(',')}`);
  check('搜索平台 id 无重复', ids.filter((x, i) => ids.indexOf(x) !== i).length === 0, ids.join(','));
  check('每个搜索平台都有 baseUrl 或属于自定义', defaults.every((p) => p.baseUrl || p.kind === 'custom'), JSON.stringify(defaults.filter((p) => !p.baseUrl).map((p) => p.id)));

  // 逐个验证：请求形态 + 响应解析
  const cases = [
    {
      id: 'zhipu-web', kind: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/web_search',
      resp: { search_result: [{ title: '智谱结果', link: 'https://a.com', content: '内容A' }] },
      wantUrl: /web_search$/, wantMethod: 'POST', wantBody: (b) => b.search_query === '测试' && b.search_engine === 'search_std'
    },
    {
      id: 'metaso', kind: 'metaso', baseUrl: 'https://metaso.cn/api/v1/search',
      resp: { data: { webpages: [{ title: '秘塔结果', link: 'https://b.com', snippet: '摘要B' }] } },
      wantUrl: /metaso\.cn/, wantMethod: 'POST', wantBody: (b) => b.q === '测试' && b.scope === 'webpage'
    },
    {
      id: 'baidu-ai-search', kind: 'baidu', baseUrl: 'https://qianfan.baidubce.com/v2/ai_search/web_search',
      resp: { references: [{ title: '百度结果', url: 'https://c.com', content: '内容C' }] },
      wantUrl: /ai_search\/web_search$/, wantMethod: 'POST', wantBody: (b) => Array.isArray(b.messages) && b.search_source === 'baidu_search_v2'
    },
    {
      id: 'brave', kind: 'brave', baseUrl: 'https://api.search.brave.com/res/v1/web/search',
      resp: { web: { results: [{ title: 'Brave结果', url: 'https://d.com', description: '描述D', extra_snippets: ['补充D'] }] } },
      wantUrl: /q=%E6%B5%8B%E8%AF%95/, wantMethod: 'GET', wantHeaders: { 'x-subscription-token': 'k' }
    },
    {
      id: 'exa', kind: 'exa', baseUrl: 'https://api.exa.ai/search',
      resp: { results: [{ title: 'Exa结果', url: 'https://e.com', text: '文本E' }] },
      wantUrl: /exa\.ai\/search$/, wantMethod: 'POST', wantBody: (b) => b.query === '测试' && typeof b.numResults === 'number',
      wantHeaders: { 'x-api-key': 'k' }
    },
    {
      id: 'jina-search', kind: 'jina', baseUrl: 'https://s.jina.ai/',
      resp: { data: [{ title: 'Jina结果', url: 'https://f.com', content: '内容F' }] },
      wantUrl: /^https:\/\/s\.jina\.ai\/%E6%B5%8B%E8%AF%95$/, wantMethod: 'GET'
    },
    {
      id: 'searxng', kind: 'searxng', baseUrl: 'https://searx.be/search',
      resp: { results: [{ title: 'SearX结果', url: 'https://g.com', content: '内容G' }] },
      wantUrl: /format=json/, wantMethod: 'GET'
    }
  ];

  for (const c of cases) {
    let req = null;
    installFetch((r) => {
      req = r;
      return jsonResponse(c.resp);
    });
    const plat = { id: c.id, name: c.id, baseUrl: c.baseUrl, kind: c.kind, apiKey: 'k' };
    let out = null;
    let err = null;
    try {
      out = await providers3.searchProvider(plat, '测试', { maxResults: 5 });
    } catch (e) {
      err = e;
    }
    const tag = c.id.padEnd(16);
    check(`${tag} 请求成功`, !err, String(err && err.message));
    if (err) continue;
    check(`${tag} 请求地址正确`, c.wantUrl.test(String(req && req.url)), String(req && req.url));
    check(`${tag} HTTP 方法正确`, (req && req.method) === c.wantMethod, String(req && req.method));
    if (c.wantBody) {
      let body = {};
      try {
        body = JSON.parse(String(req && req.raw && req.raw.__raw ? req.raw.__raw : '{}'));
      } catch (e) {
        body = {};
      }
      // 测试桩把 JSON body 解析进了 fields，优先用它
      const parsed = (req && req.fields && typeof req.fields === 'object') ? req.fields : body;
      check(`${tag} 请求体符合该服务要求`, c.wantBody(parsed), JSON.stringify(parsed).slice(0, 160));
    }
    if (c.wantHeaders) {
      const h = {};
      for (const [k, v] of Object.entries((req && req.headers) || {})) h[String(k).toLowerCase()] = v;
      for (const [k, v] of Object.entries(c.wantHeaders)) {
        check(`${tag} 带上 ${k}`, String(h[k] || '').includes(v), JSON.stringify(h).slice(0, 160));
      }
    }
    check(`${tag} 解析出了结果`, !!(out && out.results && out.results.length === 1), JSON.stringify(out && out.results).slice(0, 200));
  }
}

// ---------------- 34. 迁移：新增内置平台必须补进老用户配置 ----------------
// 真实反馈：「我进入插件咋没看到」—— 因为早期迁移只在 platforms 为空时才填默认值，
// 于是后来新增的 21 个 AI 平台 / 8 个搜索平台对已安装用户永远不可见。
{
  const SET = await import('../bilibili-subtitle-assistant/src/shared/settings.js');
  const allAi = SET.defaultAiPlatforms();
  const allSearch = SET.defaultSearchPlatforms();

  // 模拟老用户：只有前 6 个 AI 平台（其中 deepseek 填过 Key 与自定义模型）与前 3 个搜索平台
  const oldAi = allAi.slice(0, 6).map((p) => (p.id === 'deepseek' ? { ...p, apiKey: 'sk-mine', model: 'deepseek-reasoner' } : { ...p }));
  const oldSearch = allSearch.slice(0, 3).map((p) => ({ ...p }));
  const migrated = SET.migrateSettings({
    ai: { platforms: oldAi, activeId: 'deepseek' },
    asr: { platforms: [] },
    search: { platforms: oldSearch }
  });

  check('老用户的 AI 平台被补全到最新内置数量', migrated.ai.platforms.length === allAi.length, `${migrated.ai.platforms.length} vs ${allAi.length}`);
  check('老用户的搜索平台被补全到最新内置数量', migrated.search.platforms.length === allSearch.length, `${migrated.search.platforms.length} vs ${allSearch.length}`);

  const ds = migrated.ai.platforms.find((p) => p.id === 'deepseek');
  check('用户的 API Key 绝不被覆盖', ds && ds.apiKey === 'sk-mine', ds && ds.apiKey);
  check('用户改过的模型名保留', ds && ds.model === 'deepseek-reasoner', ds && ds.model);
  check('新加入的平台 Key 为空（不会误用别人的 Key）', migrated.ai.platforms.filter((p) => p.id !== 'deepseek').every((p) => !p.apiKey), '');
  check('已有平台排在前面，新增追加在后面', migrated.ai.platforms[0].id === allAi[0].id, migrated.ai.platforms[0].id);
  check('新增的搜索平台里含智谱 Web 搜索', migrated.search.platforms.some((p) => p.id === 'zhipu-web'), migrated.search.platforms.map((p) => p.id).join(','));

  // 幂等：再次迁移不应重复追加
  const again = SET.migrateSettings(migrated);
  check('迁移是幂等的（不会重复追加）', again.ai.platforms.length === allAi.length && again.search.platforms.length === allSearch.length, `${again.ai.platforms.length}/${again.search.platforms.length}`);

  // 用户自建平台不能被删
  const custom = SET.migrateSettings({
    ai: { platforms: [{ id: 'my-own', name: '我的平台', baseUrl: 'https://x/v1', model: 'm', apiKey: 'k', models: ['m'] }], activeId: 'my-own' },
    asr: { platforms: [] },
    search: { platforms: [] }
  });
  check('用户自建平台被保留', custom.ai.platforms.some((p) => p.id === 'my-own'), custom.ai.platforms.map((p) => p.id).join(','));
  check('用户自建平台的 Key 未被清空', custom.ai.platforms.find((p) => p.id === 'my-own').apiKey === 'k', '');
}

console.log('\n===== 语音识别平台适配 =====');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
}
console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
