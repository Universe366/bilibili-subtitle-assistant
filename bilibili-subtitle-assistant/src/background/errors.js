// 错误分类：把错误变成「标题 + 说明 + 下一步该点哪里」（稳定性 #11）。

export class AppError extends Error {
  constructor(kind, title, detail, action, extra = {}) {
    super(title);
    this.name = 'AppError';
    this.kind = kind;
    this.title = title;
    this.detail = detail || '';
    this.action = action || '';
    this.extra = extra;
    this.status = extra.status;
  }
  toJSON() {
    return {
      kind: this.kind,
      title: this.title,
      detail: this.detail,
      action: this.action,
      status: this.status,
      extra: this.extra
    };
  }
  // 与侧边栏里 err.payload 的用法保持一致（同一个错误对象两种读法都能用）
  get payload() {
    return this.toJSON();
  }
}

export function toErrorPayload(err) {
  if (err instanceof AppError) return err.toJSON();
  if (err && err.name === 'AbortError') {
    return {
      kind: 'aborted',
      title: '已终止',
      detail: '任务被手动终止。',
      action: '可以重新发起，或换用其它字幕轨。'
    };
  }
  if (err && err.name === 'TimeoutError') {
    return {
      kind: 'timeout',
      title: '请求超时',
      detail: err.message || '在规定时间内没有收到响应。',
      action: '检查网络后重试；若长期超时，请在设置中调大超时时间。'
    };
  }
  return {
    kind: 'unknown',
    title: '请求失败',
    detail: (err && err.message) || String(err),
    action: '可复制诊断信息（设置 → 诊断）后排查，或更换平台 / 接口地址重试。'
  };
}

// 有些聚合网关用自己的错误信封，而不是 OpenAI 的 { error: { message } }。
// 例如基元律动 TokenRhythm 统一返回：
//   { "code": "MAX_TOKENS_EXCEEDED", "message": "输出长度超过平台限制…", "traceId": "…" }
// 直接把这串 JSON 原样丢给用户既难读，又把 code 这个最关键的线索埋在一堆引号里。
// 这里把「带 message 或 code 的裸 JSON」压成一句人话；其它情况返回 null，交回原逻辑。
//
// 注意：只认**顶层** code/message，且遇到 OpenAI 标准的 error 字段就主动让路，
// 避免把正常的 { error: ... } 响应误判成信封。
export function errorEnvelope(bodyText) {
  const raw = String(bodyText || '').trim();
  if (!raw || raw[0] !== '{') return null;
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  if (json.error) return null;
  const message = typeof json.message === 'string' ? json.message.trim() : '';
  const code =
    typeof json.code === 'string'
      ? json.code.trim()
      : typeof json.code === 'number'
        ? String(json.code)
        : '';
  if (!message && !code) return null;
  const head = [code, message].filter(Boolean).join('：');
  const trace = typeof json.traceId === 'string' && json.traceId.trim() ? `（traceId ${json.traceId.trim()}）` : '';
  return head + trace;
}

export function classifyHttp(status, bodyText, ctx = {}) {
  const rawBody = String(bodyText || '');
  // 展示给用户用可读版（信封 → 人话），但关键词判定仍用原文，
  // 否则信封里的中文 message 会让 quota/balance 这类英文关键词匹配不到。
  const envelope = errorEnvelope(rawBody);
  const snippet = envelope || rawBody.slice(0, 600);
  const lower = rawBody.slice(0, 600).toLowerCase();
  const where = ctx.platformName ? `平台「${ctx.platformName}」` : '服务端';

  // 网关自家信封已经点名原因时，直接给出对应动作，
  // 不必让用户对着「确认接口地址、模型名与 Key 是否匹配」去猜。
  if (envelope && /MAX_TOKENS_EXCEEDED/i.test(envelope)) {
    return new AppError(
      'output-limit',
      '输出长度超过平台上限',
      `${where} 返回 ${status}：${snippet}`,
      '在 设置 → AI 模型 里把「最大输出长度（max tokens）」调小后重试（该平台对每个模型有固定的输出上限）。',
      { status }
    );
  }

  if (status === 401 || status === 403) {
    if (lower.includes('quota') || lower.includes('balance') || lower.includes('insufficient')) {
      return new AppError(
        'quota',
        '账户额度不足',
        `${where} 返回：${snippet}`,
        '前往平台控制台充值或更换可用的 API Key（设置 → 对应平台 → 申请 Key 链接）。',
        { status }
      );
    }
    // 带上「当前用的到底是什么 Key」的安全指纹，便于判断是不是贴错/被截断的 Key。
    // 只输出长度与末四位，不会泄露完整密钥。
    const key = String((ctx && ctx.apiKey) || '').trim();
    const fingerprint = key
      ? `当前使用的 Key：长度 ${key.length}，末四位 ${key.slice(-4)}${
          /^sk-/i.test(key) ? '' : '（注意：副本通常以 sk- 开头，请确认没有漏掉前缀）'
        }`
      : '当前没有可用的 Key（为空）。';
    const hasWhitespaceIssue = !!(ctx && ctx.rawKeyLength != null && ctx.rawKeyLength !== key.length);
    // 站点配对检查：硅基流动国内站(.cn)与国际站(.com)是两套账号，Key 互不通用。
    const baseHost = (() => {
      try {
        return new URL(String((ctx && ctx.baseUrl) || '')).hostname;
      } catch (err) {
        return '';
      }
    })();
    const otherTld = /\.cn$/i.test(baseHost) ? 'com' : 'cn';
    const siteHint = /api\.siliconflow\.(cn|com)$/i.test(baseHost)
      ? `\n⚠ 当前接口地址是「${baseHost}」。硅基流动国内站与国际站是两套独立账号、Key 互不通用：` +
        `\n· cloud.siliconflow.cn 申请的 Key → 必须配 https://api.siliconflow.cn/v1` +
        `\n· cloud.siliconflow.com 申请的 Key → 必须配 https://api.siliconflow.com/v1` +
        `\n设置页的「接口地址」旁边有一键切换按钮（改用 api.siliconflow.${otherTld}），先确认 Key 与地址属于同一个站。`
      : '';
    return new AppError(
      'auth',
      'API Key 无效或没有权限',
      [
        `${where} 返回 ${status}：${snippet}`,
        fingerprint,
        hasWhitespaceIssue ? '⚠ 粘贴时带了首尾空白/换行，已自动去掉；若仍失败请重新完整复制 Key。' : '',
        siteHint,
        '常见原因：① 接口地址配成了另一个站点（国内站 / 国际站）；② Key 已删除/重置；③ 复制时漏了或多了字符。'
      ]
        .filter(Boolean)
        .join('\n'),
      '打开 设置 → 对应平台，先确认「接口地址」与 Key 属于同一个站（可点一键切换）；必要时点「清除」后重新粘贴 Key，再「保存设置」→「测试连接」。',
      { status, keyLength: key.length, keyTail: key.slice(-4), baseHost }
    );
  }
  if (status === 402) {
    return new AppError(
      'quota',
      '账户额度不足',
      `${where} 返回 402：${snippet}`,
      '前往平台控制台充值，或切换到其它平台（设置 → 平台列表）。',
      { status }
    );
  }
  if (status === 404) {
    return new AppError(
      'model',
      '接口或模型不存在',
      `${where} 返回 404：${snippet}`,
      '检查接口地址是否少了 /v1，或点「探测模型」重新选择模型。',
      { status }
    );
  }
  if (status === 429) {
    return new AppError(
      'rate',
      '触发限流（请求太频繁）',
      `${where} 返回 429：${snippet}`,
      '降低「并发切片数」（设置 → 语音识别），或稍等几十秒后重试。',
      { status }
    );
  }
  if (status === 413) {
    return new AppError(
      'too-large',
      '提交的音频分片超过平台上限',
      `${where} 返回 413：${snippet}`,
      '在 设置 → 语音识别 里把「平台单文件上限(MB)」调小，或调小「切片时长」。',
      { status }
    );
  }
  if (status >= 500) {
    // 5xx 说明请求已经通过鉴权与参数校验，服务端在处理音频时出错。
    // 注意：不要再把 5xx 归因于音频格式/容器。实测已确认：
    //   · WAV、MediaRecorder 的 fragmented MP4、FFmpeg 流复制的**普通 MP4** 全部 500
    //   · 300s 分 2 片时第 1 片曾成功、600s 单片则首片即失败
    //   · 同一份音频、同一个 Key，/models 正常返回 200
    // 因此这是服务端侧问题，文案应如实说明，避免让用户继续在客户端找原因。
    const host = (() => {
      try {
        return new URL(String((ctx && ctx.baseUrl) || '')).hostname;
      } catch (err) {
        return '';
      }
    })();
    const isSilicon = /siliconflow/i.test(host);
    const altHint = isSilicon
      ? '\n\n本扩展已排除客户端原因：音频用 FFmpeg 以「流复制」重封装成普通 MP4' +
        '（与参考实现 Bilitato 发出的格式一致，无转码、无 fragmented MP4），' +
        '且已用 WAV / 分片 MP4 / 普通 MP4 三种形态各试过，服务端均返回 500。' +
        '同一把 Key 访问 /models 正常，说明凭证有效。\n' +
        '该接口目前对此账号不可用。建议：① 在「设置 → 语音识别」换用 Groq（whisper-large-v3-turbo，' +
        '带时间戳、有免费额度）；② 或换模型 TeleAI/TeleSpeechASR 再试；③ 或稍后再试。'
      : '';
    return new AppError(
      'server',
      '服务端错误（非本扩展问题）',
      `${where} 返回 ${status}${snippet ? `：${snippet}` : '（响应体为空，服务端没有给出原因）'}\n` +
        `鉴权与参数校验均已通过（否则会是 401/400），是服务端在处理音频时出错。已自动重试仍失败。${altHint}`,
      isSilicon
        ? '这个错误来自硅基流动服务端，客户端无法绕过。请换用 Groq 或其它平台（设置 → 语音识别）。'
        : '稍后重试；若持续失败，换一个模型或平台。',
      { status, baseHost: host }
    );
  }
  return new AppError(
    'http',
    '请求失败',
    `${where} 返回 ${status}：${snippet}`,
    '确认接口地址、模型名与 Key 是否匹配（设置 → 对应平台）。',
    { status }
  );
}

export function classifyNetwork(err, ctx = {}) {
  if (err instanceof AppError) return err;
  if (err && err.name === 'AbortError') {
    return new AppError('aborted', '已终止', '任务被手动终止。', '可重新发起。');
  }
  if (err && err.name === 'TimeoutError') return err;
  const msg = (err && err.message) || String(err);
  if (/Failed to fetch|NetworkError|ERR_/i.test(msg)) {
    return new AppError(
      'network',
      '网络不通或域名未授权',
      msg,
      '检查网络；若接口地址是自定义域名，请在设置 → 对应平台点「申请域名权限」，并在弹出的浏览器提示中点允许。'
    );
  }
  return new AppError('unknown', '请求失败', msg, '可复制诊断信息后排查。');
}

// 从 fetch Response 里取错误
export async function httpError(res, ctx) {
  let body = '';
  try {
    body = await res.text();
  } catch (err) {
    body = '';
  }
  return classifyHttp(res.status, body, ctx);
}
