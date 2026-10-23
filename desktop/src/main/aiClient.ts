import { session } from 'electron';
import type { AiPlatform } from '../shared/types';
import { needsApiKey } from './platformKey';

// ---------------------------------------------------------------------------
// AI 请求的公共层。
//
// 插件里 AI 平台既支持 OpenAI 兼容协议，也支持 Anthropic 原生协议
// （`/v1/messages` + `x-api-key`）。桌面端原来只有 OpenAI 兼容一条路径，
// 于是 Claude 只能靠第三方转发。这里把两种协议收进同一组函数，
// 上层（总结/对话/翻译/优化/章节/核对/测试连接）只关心「发消息、拿文本」。
// ---------------------------------------------------------------------------

export type AiRole = 'system' | 'user' | 'assistant';

export interface AiTextPart {
  type: 'text';
  text: string;
}

export interface AiImagePart {
  type: 'image';
  /** image/png、image/jpeg 等 */
  mime: string;
  /** base64，不含 data: 前缀 */
  data: string;
}

export type AiPart = AiTextPart | AiImagePart;

export interface AiMessage {
  role: AiRole;
  content: string | AiPart[];
}

export interface AiToolDef {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AiChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface AiChatResult {
  text: string;
  reasoning: string;
}

export const DEFAULT_AI_TIMEOUT_MS = 300000;

export function isAnthropicPlatform(
  platform: Pick<AiPlatform, 'baseUrl' | 'kind'>
): boolean {
  return platform.kind === 'anthropic' || /anthropic\.com/i.test(platform.baseUrl || '');
}

export function errorForStatus(status: number, body: string): string {
  if (status === 401 || status === 403) return 'API Key 无效或没有权限（401/403）';
  if (status === 404) return '地址或模型不存在（404）';
  if (status === 429) return '请求过于频繁或额度不足（429）';
  if (status >= 500) return `服务端错误（${status}）`;
  return `请求失败（HTTP ${status}）：${body.slice(0, 200)}`;
}

export function aiBaseUrl(platform: Pick<AiPlatform, 'baseUrl'>): string {
  return platform.baseUrl.replace(/\/+$/, '');
}

export function aiHeaders(platform: AiPlatform): Record<string, string> {
  const key = platform.apiKey.trim();
  if (isAnthropicPlatform(platform)) {
    return {
      'content-type': 'application/json',
      ...(key ? { 'x-api-key': key } : {}),
      'anthropic-version': '2023-06-01',
      // 浏览器/渲染进程里直连 Anthropic 需要这个头；主进程 fetch 不发也无害。
      'anthropic-dangerous-direct-browser-access': 'true'
    };
  }
  return {
    'content-type': 'application/json',
    ...(key ? { authorization: `Bearer ${key}` } : {})
  };
}

function textOf(content: string | AiPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is AiTextPart => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function splitDataUrl(url: string): { mime: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!match) return null;
  return { mime: match[1], data: match[2] };
}

function imagePart(src: string): AiImagePart | null {
  const parsed = splitDataUrl(src);
  if (parsed) return { type: 'image', mime: parsed.mime, data: parsed.data };
  return null;
}

function toOpenAiMessages(messages: AiMessage[]): any[] {
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return { role: message.role, content: message.content };
    }
    const content: any[] = [];
    for (const part of message.content) {
      if (part.type === 'text') {
        content.push({ type: 'text', text: part.text });
        continue;
      }
      const image = imagePart(part.data ? `data:${part.mime};base64,${part.data}` : '');
      if (!image) continue;
      content.push({
        type: 'image_url',
        image_url: { url: `data:${image.mime};base64,${image.data}` }
      });
    }
    return { role: message.role, content };
  });
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: any[];
}

function toAnthropicPayload(messages: AiMessage[]): {
  system: string;
  messages: AnthropicMessage[];
} {
  const system: string[] = [];
  const rows: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      const text = textOf(message.content).trim();
      if (text) system.push(text);
      continue;
    }
    const content: any[] = [];
    if (typeof message.content === 'string') {
      if (message.content.trim()) content.push({ type: 'text', text: message.content });
    } else {
      for (const part of message.content) {
        if (part.type === 'text') {
          if (part.text.trim()) content.push({ type: 'text', text: part.text });
        } else {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: part.mime || 'image/png',
              data: part.data
            }
          });
        }
      }
    }
    if (!content.length) continue;
    rows.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content });
  }
  return { system: system.join('\n\n'), messages: rows };
}

function toAnthropicTools(tools: AiToolDef[]): any[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: (tool.description || '').slice(0, 1024),
    input_schema:
      (tool.parameters as Record<string, unknown>) || {
        type: 'object',
        properties: {}
      }
  }));
}

function toOpenAiTools(tools: AiToolDef[]): any[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: (tool.description || '').slice(0, 1024),
      parameters:
        (tool.parameters as Record<string, unknown>) || {
          type: 'object',
          properties: {}
        }
    }
  }));
}

function buildBody(
  platform: AiPlatform,
  messages: AiMessage[],
  options: AiChatOptions & { stream?: boolean; tools?: AiToolDef[] }
): Record<string, unknown> {
  const maxTokens = Math.max(1, options.maxTokens || 8192);
  if (isAnthropicPlatform(platform)) {
    const payload = toAnthropicPayload(messages);
    return {
      model: platform.model.trim(),
      max_tokens: maxTokens,
      temperature: options.temperature,
      stream: options.stream === true,
      ...(payload.system ? { system: payload.system } : {}),
      messages: payload.messages,
      ...(options.tools && options.tools.length
        ? { tools: toAnthropicTools(options.tools), tool_choice: { type: 'auto' } }
        : {})
    };
  }
  return {
    model: platform.model.trim(),
    max_tokens: maxTokens,
    temperature: options.temperature,
    stream: options.stream === true,
    messages: toOpenAiMessages(messages),
    ...(options.tools && options.tools.length
      ? { tools: toOpenAiTools(options.tools), tool_choice: 'auto' }
      : {})
  };
}

function endpoints(platform: AiPlatform): string[] {
  return isAnthropicPlatform(platform)
    ? [`${aiBaseUrl(platform)}/messages`]
    : [`${aiBaseUrl(platform)}/chat/completions`];
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  options: AiChatOptions
): Promise<Response> {
  if (options.signal?.aborted) throw new Error('已终止');
  const controller = new AbortController();
  const timeoutMs = Math.max(5000, options.timeoutMs || DEFAULT_AI_TIMEOUT_MS);
  const timer = setTimeout(
    () => controller.abort(new Error(`AI 请求超时（${Math.round(timeoutMs / 1000)} 秒）`)),
    timeoutMs
  );
  const forward = () => controller.abort();
  options.signal?.addEventListener('abort', forward, { once: true });
  // 监听器注册前可能已经被取消；addEventListener 不会补发 abort 事件。
  if (options.signal?.aborted) forward();
  try {
    return await session.defaultSession.fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forward);
  }
}

function parseOpenAiText(json: any): AiChatResult {
  const message = json?.choices?.[0]?.message;
  const raw = message?.content;
  const text =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw
            .map((part: any) => String(part?.text ?? part?.content ?? ''))
            .join('')
        : '';
  const reasoning = String(message?.reasoning_content ?? message?.reasoning ?? '');
  return { text, reasoning };
}

function parseAnthropicText(json: any): AiChatResult {
  const blocks = Array.isArray(json?.content) ? json.content : [];
  const text = blocks
    .filter((block: any) => block?.type === 'text')
    .map((block: any) => String(block.text || ''))
    .join('');
  const reasoning = blocks
    .filter((block: any) => block?.type === 'thinking')
    .map((block: any) => String(block.thinking || ''))
    .join('');
  return { text, reasoning };
}

function parseChunk(platform: AiPlatform, data: any): { text: string; reasoning: string } {
  if (isAnthropicPlatform(platform)) {
    const type = String(data?.type || '');
    if (type === 'content_block_delta') {
      const delta = data?.delta || {};
      if (delta.type === 'text_delta') return { text: String(delta.text || ''), reasoning: '' };
      if (delta.type === 'thinking_delta') {
        return { text: '', reasoning: String(delta.thinking || '') };
      }
      return { text: '', reasoning: '' };
    }
    if (type === 'content_block_start') {
      const block = data?.content_block || {};
      if (block.type === 'text') return { text: String(block.text || ''), reasoning: '' };
      if (block.type === 'thinking') {
        return { text: '', reasoning: String(block.thinking || '') };
      }
    }
    return { text: '', reasoning: '' };
  }
  const choice = data?.choices?.[0];
  const delta = choice?.delta?.content ?? choice?.text ?? '';
  const think = choice?.delta?.reasoning_content ?? '';
  return {
    text: typeof delta === 'string' ? delta : '',
    reasoning: typeof think === 'string' ? think : ''
  };
}

async function postJson(
  platform: AiPlatform,
  body: Record<string, unknown>,
  options: AiChatOptions
): Promise<Response> {
  const url = endpoints(platform)[0];
  const send = (payload: Record<string, unknown>) =>
    fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: aiHeaders(platform),
        body: JSON.stringify(payload)
      },
      options
    );

  const response = await send(body);
  if (response.ok || response.status !== 400) return response;

  // Anthropic 的 max_tokens 是硬上限：桌面端默认 64000，某些 Claude 型号
  // （如 3.5 Haiku）只接受 8192。这里按服务端报错回退一次，而不是让用户手改。
  const probe = await response.clone().text().catch(() => '');
  const maxTokens = Number(body.max_tokens) || 0;
  if (/max_tokens/i.test(probe) && maxTokens > 8192) {
    return send({ ...body, max_tokens: 8192 });
  }
  return response;
}

/** 非流式调用：返回完整文本。用于 JSON 类任务（翻译/优化/章节/核对/测试）。 */
export async function chatOnce(
  platform: AiPlatform,
  messages: AiMessage[],
  options: AiChatOptions = {}
): Promise<AiChatResult> {
  const response = await postJson(
    platform,
    buildBody(platform, messages, { ...options, stream: false }),
    options
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(errorForStatus(response.status, body));
  }
  const json: any = await response.json();
  return isAnthropicPlatform(platform) ? parseAnthropicText(json) : parseOpenAiText(json);
}

/** 流式调用：边读边回调；不支持的平台/协议回落到一次性返回。 */
export async function chatStream(
  platform: AiPlatform,
  messages: AiMessage[],
  options: AiChatOptions & {
    onDelta?: (delta: string) => void;
    onReasoning?: (delta: string) => void;
  } = {}
): Promise<AiChatResult> {
  const response = await postJson(
    platform,
    buildBody(platform, messages, { ...options, stream: true }),
    options
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(errorForStatus(response.status, body));
  }

  const contentType = response.headers.get('content-type') || '';
  if (!response.body || !contentType.includes('text/event-stream')) {
    const json: any = await response.json();
    const result = isAnthropicPlatform(platform)
      ? parseAnthropicText(json)
      : parseOpenAiText(json);
    if (result.text) options.onDelta?.(result.text);
    if (result.reasoning) options.onReasoning?.(result.reasoning);
    return result;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let reasoning = '';
  let finished = false;

  const handleLine = (line: string): boolean => {
    const trimmed = line.replace(/\r$/, '');
    if (!trimmed.startsWith('data:')) return false;
    const data = trimmed.slice(5).trim();
    if (!data) return false;
    if (data === '[DONE]') return true;
    try {
      const json = JSON.parse(data);
      const delta = parseChunk(platform, json);
      if (delta.text) {
        text += delta.text;
        options.onDelta?.(delta.text);
      }
      if (delta.reasoning) {
        reasoning += delta.reasoning;
        options.onReasoning?.(delta.reasoning);
      }
    } catch {
      // 忽略非 JSON 的 data 行
    }
    return false;
  };

  while (!finished) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (handleLine(line)) {
        finished = true;
        break;
      }
    }
  }
  if (!finished && buffer.trim() && handleLine(buffer)) finished = true;
  if (!text.trim()) throw new Error('AI 返回为空');
  return { text, reasoning };
}

// ---------------------------------------------------------------------------
// 工具循环（MCP）：OpenAI 的 tool_calls 与 Anthropic 的 tool_use 结构完全不同，
// 上层只提供一个「执行工具」的回调。
// ---------------------------------------------------------------------------

export interface AiToolResult {
  id: string;
  name: string;
  content: string;
}

export async function chatToolLoop(
  platform: AiPlatform,
  messages: AiMessage[],
  tools: AiToolDef[],
  options: AiChatOptions & { maxRounds?: number },
  runTool: (call: AiToolCall) => Promise<string>
): Promise<AiChatResult> {
  const anthropic = isAnthropicPlatform(platform);
  const maxRounds = Math.max(1, options.maxRounds || 6);
  const convo: any[] = anthropic
    ? toAnthropicPayload(messages).messages
    : toOpenAiMessages(messages);
  const system = anthropic ? toAnthropicPayload(messages).system : '';

  for (let round = 0; round < maxRounds; round += 1) {
    if (options.signal?.aborted) throw new Error('已终止');
    const body: Record<string, unknown> = anthropic
      ? {
          model: platform.model.trim(),
          max_tokens: Math.max(1, options.maxTokens || 8192),
          temperature: options.temperature,
          stream: false,
          messages: convo,
          tools: toAnthropicTools(tools),
          ...(system ? { system } : {})
        }
      : {
          model: platform.model.trim(),
          max_tokens: Math.max(1, options.maxTokens || 8192),
          temperature: options.temperature,
          stream: false,
          messages: convo,
          tools: toOpenAiTools(tools),
          tool_choice: 'auto'
        };

    const response = await postJson(platform, body, options);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(errorForStatus(response.status, text));
    }
    const json: any = await response.json();

    if (anthropic) {
      const blocks = Array.isArray(json?.content) ? json.content : [];
      const toolUses = blocks.filter((block: any) => block?.type === 'tool_use');
      if (!toolUses.length) {
        const result = parseAnthropicText(json);
        if (!result.text.trim()) throw new Error('AI 返回为空');
        return result;
      }
      convo.push({ role: 'assistant', content: blocks });
      const results: any[] = [];
      for (const block of toolUses) {
        let content = '';
        try {
          content = await runTool({
            id: String(block.id || ''),
            name: String(block.name || ''),
            arguments: JSON.stringify(block.input ?? {})
          });
        } catch (error) {
          content = `工具调用失败：${(error as Error).message}`;
        }
        results.push({
          type: 'tool_result',
          tool_use_id: String(block.id || ''),
          content: String(content || '').slice(0, 4000)
        });
      }
      convo.push({ role: 'user', content: results });
      continue;
    }

    const message = json?.choices?.[0]?.message;
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    if (calls.length) {
      convo.push({
        role: 'assistant',
        content: message?.content ?? null,
        tool_calls: calls
      });
      for (const call of calls) {
        let content = '';
        try {
          content = await runTool({
            id: String(call?.id || ''),
            name: String(call?.function?.name || ''),
            arguments: String(call?.function?.arguments || '{}')
          });
        } catch (error) {
          content = `工具调用失败：${(error as Error).message}`;
        }
        convo.push({
          role: 'tool',
          tool_call_id: String(call?.id || ''),
          name: String(call?.function?.name || ''),
          content: String(content || '').slice(0, 4000)
        });
      }
      continue;
    }

    const result = parseOpenAiText(json);
    if (!result.text.trim()) throw new Error('AI 返回为空');
    return result;
  }

  throw new Error(`工具调用轮数过多（超过 ${maxRounds} 轮）`);
}

export async function listAiModels(
  platform: AiPlatform
): Promise<{ models: string[]; url: string }> {
  const url = `${aiBaseUrl(platform)}/models`;
  const headers = aiHeaders(platform);
  delete headers['content-type'];
  const response = await fetchWithTimeout(
    url,
    { method: 'GET', headers },
    { timeoutMs: 30000 }
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`模型列表 HTTP ${response.status}：${text.slice(0, 160)}`);
  }
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('模型列表不是 JSON');
  }
  const rows = Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.models)
      ? json.models
      : Array.isArray(json?.result)
        ? json.result
        : [];
  const models = rows
    .map((item: any) => String(item?.id || item?.name || item))
    .filter(Boolean);
  return { models, url };
}

export async function testAiConnection(
  platform: AiPlatform
): Promise<{ latencyMs: number; message: string }> {
  if (!platform.baseUrl.trim()) throw new Error('请填写 Base URL');
  if (!platform.model.trim()) throw new Error('请填写模型名');
  if (needsApiKey(platform) && !platform.apiKey.trim()) throw new Error('请填写 API Key');
  const started = Date.now();
  await chatOnce(
    platform,
    [{ role: 'user', content: 'ping' }],
    { maxTokens: 4, temperature: 0, timeoutMs: 30000 }
  );
  return { latencyMs: Date.now() - started, message: '连接成功' };
}
