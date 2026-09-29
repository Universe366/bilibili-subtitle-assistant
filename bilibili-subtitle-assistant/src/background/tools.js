// 把 MCP 工具接进 AI 对话循环（「给模型装上手脚」）。
//
// 流程：把工具以 OpenAI / Anthropic 两种格式之一交给模型 →
//   模型返回 tool_calls → 我们调用 MCP → 把结果作为 tool 消息追加 →
//   再问一次模型，直到它给出最终回答或达到轮数上限。
//
// 兼容性说明：不同平台对「函数调用」的支持差异很大。
// 本模块**不假设**平台一定支持 tools —— 若平台报错，会把错误如实带出，
// 由上层决定是否降级为「无工具对话」。

import { AppError } from './errors.js';
import { chatOnce } from './providers.js';
import { callTool, toolResultToText } from './mcp.js';

function isAnthropic(baseUrl) {
  return /anthropic\.com/i.test(String(baseUrl || ''));
}

// 把 MCP 的 inputSchema 原样交给模型（它本身就是 JSON Schema）
function toOpenAiTools(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.qualifiedName,
      description: (t.description || '').slice(0, 1024),
      parameters: t.inputSchema || { type: 'object', properties: {} }
    }
  }));
}

function toAnthropicTools(tools) {
  return tools.map((t) => ({
    name: t.qualifiedName,
    description: (t.description || '').slice(0, 1024),
    input_schema: t.inputSchema || { type: 'object', properties: {} }
  }));
}

// 解析模型返回里的一次工具调用（兼容 OpenAI 与 Anthropic 两种形状）
export function extractToolCalls(message) {
  if (!message) return [];
  // Anthropic: content: [{type:'tool_use', id, name, input}]
  if (Array.isArray(message.content)) {
    return message.content
      .filter((c) => c && (c.type === 'tool_use' || c.type === 'function'))
      .map((c) => ({
        id: String(c.id || ''),
        name: String(c.name || (c.function && c.function.name) || ''),
        args: c.input || (c.function && safeJson(c.function.arguments)) || {}
      }))
      .filter((c) => c.name);
  }
  const list = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return list
    .map((c) => ({
      id: String(c.id || ''),
      name: String((c.function && c.function.name) || c.name || ''),
      args: safeJson(c.function ? c.function.arguments : c.arguments)
    }))
    .filter((c) => c.name);
}

function safeJson(v) {
  if (v == null) return {};
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch (err) {
    return {};
  }
}

// 把「服务名.工具名」拆回来
function resolveTool(tools, qualifiedName) {
  return tools.find((t) => t.qualifiedName === qualifiedName) ||
    tools.find((t) => t.name === qualifiedName) ||
    null;
}

export function buildToolDescription(tools) {
  if (!tools.length) return '';
  const lines = tools.map((t) => `- ${t.qualifiedName}（${t.serverName}）：${(t.description || '无说明').split('\n')[0]}`);
  return `\n\n【可用工具（MCP）】\n你可以在需要时调用下列工具获取外部信息或执行操作：\n${lines.join('\n')}`;
}

// 带工具的多轮对话。
// 返回 { text, toolEvents }，toolEvents 记录每次调用于结果，便于界面展示。
// opts.chatFn 可注入（测试用），默认为 providers.chatOnce。
export async function chatWithTools(platform, messages, tools, opts = {}) {
  const onToolEvent = opts.onToolEvent || (() => {});
  const chatFn = opts.chatFn || chatOnce;
  const maxRounds = Math.max(1, Math.min(12, Number(opts.maxToolRounds) || 6));
  const anthropic = isAnthropic(platform.baseUrl);
  const convo = messages.map((m) => ({ ...m }));
  const toolEvents = [];
  let lastText = '';

  for (let round = 0; round < maxRounds; round += 1) {
    const reqOpts = {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      tools: anthropic ? toAnthropicTools(tools) : toOpenAiTools(tools),
      toolChoice: 'auto'
    };
    let res;
    try {
      res = await chatFn(platform, convo, reqOpts);
    } catch (err) {
      // 平台不支持函数调用时，如实抛出，由上层决定降级
      if (round === 0) throw err;
      // 已经跑过工具再失败：保留已有文本
      return { text: lastText, toolEvents, degraded: true, error: err };
    }
    const message = (res && res.message) || null;
    const calls = extractToolCalls(message);
    if (res && res.text) lastText = res.text;

    if (!calls.length) {
      return { text: (res && res.text) || lastText, toolEvents, rounds: round + 1 };
    }

    // 把助手的这轮（含 tool_calls）追加进对话
    convo.push(
      anthropic
        ? { role: 'assistant', content: message.content }
        : { role: 'assistant', content: message.content || null, tool_calls: message.tool_calls }
    );

    for (const call of calls) {
      const tool = resolveTool(tools, call.name);
      onToolEvent({ phase: 'start', name: call.name, args: call.args, serverName: tool ? tool.serverName : '' });
      let text = '';
      let ok = true;
      try {
        if (!tool) throw new Error(`未知工具：${call.name}`);
        const out = await callTool(tool.server, tool.name, call.args, { timeoutMs: opts.toolTimeoutMs });
        text = toolResultToText(out) || '（工具没有返回文本内容）';
      } catch (err) {
        ok = false;
        text = `工具调用失败：${(err && err.message) || err}`;
      }
      const event = { phase: 'end', name: call.name, ok, text, serverName: tool ? tool.serverName : '', args: call.args };
      toolEvents.push(event);
      onToolEvent(event);

      // 回填工具结果
      if (anthropic) {
        convo.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: call.id, content: text.slice(0, 8000) }]
        });
      } else {
        convo.push({ role: 'tool', tool_call_id: call.id, content: text.slice(0, 8000) });
      }
    }
  }

  // 达到轮数上限：再要一次最终回答（不带工具）
  try {
    const final = await chatFn(platform, convo, {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal
    });
    return { text: (final && final.text) || lastText, toolEvents, rounds: maxRounds, capped: true };
  } catch (err) {
    return { text: lastText, toolEvents, rounds: maxRounds, capped: true, error: err };
  }
}
