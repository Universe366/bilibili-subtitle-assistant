import { session } from 'electron';
import type { AiPlatform, AppSettings, ChatMessage, PageInfo, SubtitleLine } from '../shared/types';
import { activePlatform, loadSettings } from './settings';
import { buildTranscript } from './ai';
import { glossaryTerms } from './correction';
import { searchWeb } from './search';
import { listMcpTools, callMcpTool } from './mcp';
import type { McpServer, McpTool } from '../shared/types';
import { skillPrompt } from './skills';

const MAX_HISTORY = 16;
const REQUEST_TIMEOUT_MS = 300000;

export interface ChatOptions {
  info: PageInfo;
  lines: SubtitleLine[];
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
}

function errorForStatus(status: number, body: string): string {
  if (status === 401 || status === 403) return 'API Key 无效或没有权限（401/403）';
  if (status === 404) return '地址或模型不存在（404）';
  if (status === 429) return '请求过于频繁或额度不足（429）';
  if (status >= 500) return `服务端错误（${status}）`;
  return `请求失败（HTTP ${status}）：${body.slice(0, 200)}`;
}

export async function chat(
  options: ChatOptions
): Promise<{ text: string; model: string; reasoning: string }> {
  const settings = loadSettings();
  const platform = activePlatform(settings);
  if (!platform || !platform.baseUrl.trim()) throw new Error('请先在设置里选择一个 AI 平台');
  if (!platform.model.trim()) throw new Error('请先在设置里填写模型名');
  if (!platform.apiKey.trim()) throw new Error('请先在设置里填写 API Key');

  const transcript = buildTranscript(options.info, options.lines);
  if (!transcript.trim()) throw new Error('没有可用的字幕内容');

  const glossary = glossaryTerms(settings);
  const glossaryBlock = glossary.length
    ? `\n\n术语表（回答时统一使用以下写法）：\n${glossary
        .slice(0, 80)
        .map((term) => `- ${term.from} → ${term.to}${term.note ? `（${term.note}）` : ''}`)
        .join('\n')}`
    : '';

  let webBlock = '';
  const lastUser = [...options.messages].reverse().find((message) => message.role === 'user');
  const question = String(lastUser?.content || '').trim();
  const wantsSearch =
    settings.search.enabled &&
    question &&
    (settings.search.alwaysSearchOnChat ||
      (settings.search.autoSearchOnChat &&
        /最新|今天|现在|谁|多少|价格|新闻|发布|核实|查一下|搜索|什么时候|latest|news|price|who|when/i.test(
          question
        )));
  if (wantsSearch) {
    try {
      const refs = await searchWeb(settings, question.slice(0, 80));
      if (refs.length) {
        webBlock = `联网参考（回答外部事实时可使用；与字幕冲突时以字幕为准）：\n${refs
          .slice(0, 5)
          .map((ref, index) => `${index + 1}. ${ref.title}｜${ref.url}\n${ref.snippet.slice(0, 300)}`)
          .join('\n')}`;
      }
    } catch (error) {
      console.warn('[chat] 联网检索失败', (error as Error).message);
    }
  }

  const system = [
    settings.prompt.chat,
    glossaryBlock,
    skillPrompt(settings),
    `视频标题：${options.info.title || '未知'}`,
    `UP 主：${options.info.owner || '未知'}`,
    ...(settings.search.useVideoMeta !== false && options.info.desc
      ? [`视频简介：${options.info.desc.slice(0, 2000)}`]
      : []),
    webBlock
  ]
    .filter(Boolean)
    .join('\n\n');

  const history = options.messages.slice(-MAX_HISTORY).map((message) => {
    const text = String(message.content || '').slice(0, 4000);
    if (message.role === 'user' && Array.isArray(message.images) && message.images.length) {
      return {
        role: 'user',
        content: [
          { type: 'text', text },
          ...message.images.slice(0, 3).map((url) => ({
            type: 'image_url',
            image_url: { url }
          }))
        ]
      };
    }
    return { role: message.role, content: text };
  });

  const messages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `以下是当前视频的字幕（带时间戳），请作为回答依据：\n\n${transcript}`
    },
    ...history
  ];

  let toolBindings: Array<{ server: McpServer; tool: McpTool; qualifiedName: string }> = [];
  if (settings.mcp.enabled) {
    for (const server of settings.mcp.servers.filter((item) => item.enabled && item.url)) {
      try {
        const tools = await listMcpTools(server);
        toolBindings.push(
          ...tools.map((tool) => ({
            server,
            tool,
            qualifiedName: `${server.id}__${tool.name}`
          }))
        );
      } catch (error) {
        console.warn('[mcp] 连接失败', server.name, (error as Error).message);
      }
    }
  }

  if (toolBindings.length) {
    return chatWithTools({
      platform,
      messages,
      settings,
      toolBindings,
      signal: options.signal,
      onDelta: options.onDelta
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('AI 请求超时（5 分钟）')), REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    const base = platform.baseUrl.replace(/\/+$/, '');
    const response = await session.defaultSession.fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${platform.apiKey.trim()}`
      },
      body: JSON.stringify({
        model: platform.model.trim(),
        stream: settings.ai.stream !== false,
        temperature: settings.ai.temperature,
        max_tokens: settings.ai.maxTokens || undefined,
        messages
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(errorForStatus(response.status, body));
    }

    const contentType = response.headers.get('content-type') || '';
    if (!response.body || !contentType.includes('text/event-stream')) {
      const json: any = await response.json();
      const text = String(json?.choices?.[0]?.message?.content || '');
      const reasoning = String(json?.choices?.[0]?.message?.reasoning_content || '');
      if (!text.trim()) throw new Error('AI 返回为空');
      options.onDelta?.(text);
      if (reasoning) options.onReasoning?.(reasoning);
      return { text, model: platform.model, reasoning };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let reasoning = '';
    let finished = false;

    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const rawLine = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!rawLine.startsWith('data:')) continue;
        const data = rawLine.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') {
          finished = true;
          break;
        }
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.text ?? '';
          const think = json?.choices?.[0]?.delta?.reasoning_content;
          if (typeof think === 'string' && think) {
            reasoning += think;
            options.onReasoning?.(think);
          }
          if (typeof delta === 'string' && delta) {
            text += delta;
            options.onDelta?.(delta);
          }
        } catch {
          // 忽略非 JSON 行
        }
      }
    }

    if (!text.trim()) throw new Error('AI 返回为空');
    return { text, model: platform.model, reasoning };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}


async function chatWithTools(options: {
  platform: AiPlatform;
  messages: any[];
  settings: AppSettings;
  toolBindings: Array<{ server: McpServer; tool: McpTool; qualifiedName: string }>;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}): Promise<{ text: string; model: string; reasoning: string }> {
  const { platform, settings, toolBindings } = options;
  const base = platform.baseUrl.replace(/\/+$/, '');
  const tools = toolBindings.map((binding) => ({
    type: 'function',
    function: {
      name: binding.qualifiedName,
      description: (binding.tool.description || '').slice(0, 1024),
      parameters:
        (binding.tool.inputSchema as Record<string, unknown>) || {
          type: 'object',
          properties: {}
        }
    }
  }));
  const convo = options.messages.map((message) => ({ ...message }));

  for (let round = 0; round < Math.max(1, settings.mcp.maxToolRounds || 6); round += 1) {
    if (options.signal?.aborted) throw new Error('已终止');
    const response = await session.defaultSession.fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${platform.apiKey.trim()}`
      },
      body: JSON.stringify({
        model: platform.model.trim(),
        stream: false,
        temperature: settings.ai.temperature,
        max_tokens: settings.ai.maxTokens || undefined,
        messages: convo,
        tools,
        tool_choice: 'auto'
      }),
      signal: options.signal
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(errorForStatus(response.status, body));
    }
    const json: any = await response.json();
    const message = json?.choices?.[0]?.message;
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];

    if (calls.length) {
      convo.push({
        role: 'assistant',
        content: message?.content ?? null,
        tool_calls: calls
      });
      for (const call of calls) {
        const name = String(call?.function?.name || '');
        const binding = toolBindings.find((item) => item.qualifiedName === name);
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(call?.function?.arguments || '{}'));
        } catch {
          args = {};
        }
        let content = '工具不存在';
        if (binding) {
          try {
            content = await callMcpTool(
              binding.server,
              binding.tool.name,
              args,
              settings.mcp.callTimeoutMs || 60000
            );
          } catch (error) {
            content = `工具调用失败：${(error as Error).message}`;
          }
        }
        convo.push({
          role: 'tool',
          tool_call_id: String(call?.id || ''),
          name,
          content: content.slice(0, 4000)
        });
      }
      continue;
    }

    const text = String(message?.content || '');
    if (!text.trim()) throw new Error('AI 返回为空');
    options.onDelta?.(text);
    return { text, model: platform.model, reasoning: '' };
  }

  throw new Error('工具调用轮数过多（超过 6 轮）');
}
