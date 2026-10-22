import type { ChatMessage, PageInfo, SubtitleLine } from '../shared/types';
import { activePlatform, loadSettings } from './settings';
import { chatOnce, chatStream, chatToolLoop } from './aiClient';
import type { AiMessage, AiPart } from './aiClient';
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
  skillIds?: string[];
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
  // 对话不强依赖字幕：没有字幕时仍可提问（联网 / 简介 / 通用问答），
  // 但要在提示里说清“没有字幕依据”，避免模型假装看过视频。
  const hasTranscript = Boolean(transcript.trim());

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
    skillPrompt(settings, options.skillIds),
    `视频标题：${options.info.title || '未知'}`,
    `UP 主：${options.info.owner || '未知'}`,
    ...(settings.search.useVideoMeta !== false && options.info.desc
      ? [`视频简介：${options.info.desc.slice(0, 2000)}`]
      : []),
    ...(hasTranscript
      ? []
      : ['当前视频没有可用字幕：可以基于问题本身、视频简介和联网结果回答，但要明确说明“没有字幕依据”。']),
    webBlock
  ]
    .filter(Boolean)
    .join('\n\n');

  const history: AiMessage[] = options.messages.slice(-MAX_HISTORY).map((message) => {
    const text = String(message.content || '').slice(0, 4000);
    if (message.role === 'user' && Array.isArray(message.images) && message.images.length) {
      const parts: AiPart[] = [{ type: 'text', text }];
      for (const url of message.images.slice(0, 3)) {
        const match = /^data:([^;,]+);base64,(.*)$/s.exec(String(url || ''));
        if (match) parts.push({ type: 'image', mime: match[1], data: match[2] });
      }
      return { role: 'user', content: parts };
    }
    return { role: message.role, content: text };
  });

  const messages: AiMessage[] = [
    { role: 'system', content: system },
    ...(hasTranscript
      ? [
          {
            role: 'user' as const,
            content: `以下是当前视频的字幕（带时间戳），请作为回答依据：\n\n${transcript}`
          }
        ]
      : []),
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
    const result = await chatToolLoop(
      platform,
      messages,
      toolBindings.map((binding) => ({
        name: binding.qualifiedName,
        description: binding.tool.description,
        parameters: binding.tool.inputSchema
      })),
      {
        temperature: settings.ai.temperature,
        maxTokens: settings.ai.maxTokens || undefined,
        maxRounds: settings.mcp.maxToolRounds || 6,
        signal: options.signal
      },
      async (call) => {
        const binding = toolBindings.find((item) => item.qualifiedName === call.name);
        if (!binding) return '工具不存在';
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(call.arguments || '{}'));
        } catch {
          args = {};
        }
        try {
          return await callMcpTool(
            binding.server,
            binding.tool.name,
            args,
            settings.mcp.callTimeoutMs || 60000
          );
        } catch (error) {
          return `工具调用失败：${(error as Error).message}`;
        }
      }
    );
    options.onDelta?.(result.text);
    if (result.reasoning) options.onReasoning?.(result.reasoning);
    return { text: result.text, model: platform.model, reasoning: result.reasoning };
  }

  const chatOptions = {
    temperature: settings.ai.temperature,
    maxTokens: settings.ai.maxTokens || undefined,
    timeoutMs: REQUEST_TIMEOUT_MS,
    signal: options.signal
  };

  if (settings.ai.stream === false) {
    const result = await chatOnce(platform, messages, chatOptions);
    if (!result.text.trim()) throw new Error('AI 返回为空');
    options.onDelta?.(result.text);
    if (result.reasoning) options.onReasoning?.(result.reasoning);
    return { text: result.text, model: platform.model, reasoning: result.reasoning };
  }

  const result = await chatStream(platform, messages, {
    ...chatOptions,
    onDelta: options.onDelta,
    onReasoning: options.onReasoning
  });
  return { text: result.text, model: platform.model, reasoning: result.reasoning };
}
