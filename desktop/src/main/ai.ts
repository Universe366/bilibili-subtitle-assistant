import type { AiPlatform, PageInfo, SubtitleLine, VerificationSummary } from '../shared/types';
import { activePlatform, activePrompt, loadSettings } from './settings';
import { needsApiKey } from './platformKey';
import { chatOnce, chatStream } from './aiClient';
import { buildSearchQuery, rankReferences, searchWeb } from './search';
import { buildVerifyBlock, verifySummary } from './verify';
import { fetchHotComments } from './comments';
import { glossaryTerms } from './correction';
import { optimizeLines } from './optimize';

const MAX_TRANSCRIPT_CHARS = 200000;
const REQUEST_TIMEOUT_MS = 300000;
// 长视频：超过这个字符数就走「分段总结 → 合并」，不再截断中间内容。
const DIRECT_SUMMARY_CHARS = 40000;
const SUMMARY_CHUNK_CHARS = 40000;

const CHUNK_SYSTEM =
  '你是视频字幕整理助手。用户会给你一部长视频中的一段字幕。' +
  '请只针对这一段做结构化提取，不要臆测其它段落的内容，也不要写“本段/接下来”这类过渡语。';

// 与插件 panel-ai.js 的 FEISHU_FORMAT_RULES 对齐：
// 插件总结之所以看起来像一份「图文笔记」，靠的就是这段格式细则。
const SUMMARY_FORMAT_RULES = [
  '【输出风格：做成一份信息密度高的图文笔记，不要平铺直叙的流水账】',
  '',
  '飞书文档能渲染丰富结构，请**主动使用**，不要只用「标题 + 段落」：',
  '',
  '1. **先给一句话结论**，紧接一个「速览」表格（3~6 行），让读者 10 秒抓住重点。',
  '2. **该用表格就用表格** —— 对比、参数、时间线、优劣、步骤一律用管道表格，',
  '   不要写成句子。必须有表头与 `---` 分隔行。',
  '3. **引用块（行首 `> `）用来强调关键判断或原话**，例如 `> **结论**：…`。',
  '4. **代码块**（三个反引号 + 语言）用于命令、配置、代码、数据样例。',
  '5. **超链接**写成 `[文字](https://…)`。**只链接字幕里明确出现过、或你确信真实存在的 URL**，绝对不要编造。',
  '6. **公式**用 LaTeX：行内 `$…$`、块级 `$$…$$`。',
  '7. **任务列表** `- [ ]` / `- [x]` 用于待办、检查项、可执行建议。',
  '8. **分割线** `---` 用于分节。',
  '9. **emoji 做小标题前缀**提升可读性（如 `## 🎯 核心结论`），但不要每行都加。',
  '10. **图片无法通过文本携带**。某个位置适合配图时，用一行 `> 🖼️ 建议配图：<放什么图>` 占位，不要输出假的图片语法。',
  '',
  '【硬性要求】',
  '· 内容必须**全部来自字幕**（以及下方给出的简介/评论/外部补充），不要引入字幕里没有的信息。',
  '· **不要输出**内嵌 HTML、脚注、自定义容器语法、base64 图片。',
  '· 标题最多三级（`#` / `##` / `###`），不要跳级。',
  '',
  '【详细程度：宁可详细，不要简略】',
  '· 这是一份**完整的观看笔记**，不是摘要提纲，请充分展开。',
  '· 每个要点都要写清「是什么 + 为什么 + 怎么做/结论」，不要只写一句短语。',
  '· 视频里出现的**具体数字、名称、命令、步骤、参数、结论**都要保留；有流程就逐步列出，有对比就做成表格，有坑就写清现象与原因。',
  '· 按内容自然分节，不要为了短而合并章节；长视频写长一些是正常的。',
  '· 唯一要避免的是**重复与灌水** —— 不要为了凑长度而复述同一件事。'
].join('\n');

export interface SummarizeOptions {
  info: PageInfo;
  lines: SubtitleLine[];
  platform?: AiPlatform;
  prompt?: string;
  signal?: AbortSignal;
  skipProofread?: boolean;
  onDelta?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onStatus?: (status: string) => void;
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function buildTranscript(info: PageInfo, lines: SubtitleLine[]): string {
  let text = lines.map((line) => `[${clock(line.start)}] ${line.text}`).join('\n');
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    const head = text.slice(0, MAX_TRANSCRIPT_CHARS - 6000);
    const tail = text.slice(-5000);
    text = `${head}\n…（中间字幕过长，已省略）…\n${tail}`;
  }
  return text;
}

function fullTranscript(lines: SubtitleLine[]): string {
  return lines.map((line) => `[${clock(line.start)}] ${line.text}`).join('\n');
}

interface TranscriptChunk {
  text: string;
  start: number;
  end: number;
}

function chunkTranscript(lines: SubtitleLine[], maxChars: number): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let rows: string[] = [];
  let size = 0;
  let start = 0;
  let end = 0;

  const flush = () => {
    if (!rows.length) return;
    chunks.push({ text: rows.join('\n'), start, end });
    rows = [];
    size = 0;
  };

  for (const line of lines) {
    const row = `[${clock(line.start)}] ${line.text}`;
    if (row.length > maxChars) {
      flush();
      chunks.push({
        text: row.slice(0, maxChars),
        start: line.start,
        end: line.end
      });
      continue;
    }
    if (rows.length && size + row.length + 1 > maxChars) flush();
    if (!rows.length) start = line.start;
    rows.push(row);
    size += row.length + 1;
    end = Math.max(end, line.end || line.start);
  }
  flush();
  return chunks;
}

function subtitleSpanText(lines: SubtitleLine[], duration: number): string {
  if (!lines.length) return '';
  const first = lines[0].start;
  let last = 0;
  for (const line of lines) last = Math.max(last, line.end || line.start);
  return `已获取字幕时间范围：${clock(first)} ~ ${clock(last)}（共 ${lines.length} 行）${
    duration > 0 ? `；视频总时长 ${clock(duration)}` : ''
  }`;
}

function chunkPrompt(options: {
  title: string;
  part: string;
  index: number;
  total: number;
  from: number;
  to: number;
  background: string;
  text: string;
}): string {
  return [
    options.title ? `视频：${options.title}${options.part ? ` · ${options.part}` : ''}` : '',
    options.background
      ? `【视频背景（辅助理解，不要照抄）】\n${options.background}`
      : '',
    `这是第 ${options.index}/${options.total} 段字幕，时间范围约 ${clock(options.from)} ~ ${clock(
      options.to
    )}。`,
    '请按下面的格式提取这一段的内容（Markdown，用中文）：',
    '- `### <小标题>`：这一段的主题',
    '- 要点列表（尽量具体：数字、结论、步骤、例子、人物）',
    '- 若出现值得原样保留的说法，用 `> 引用` 格式直接摘录',
    '不要给每条要点都标时间；只有极少数确实需要跳转的位置才写 `[mm:ss]`（整段最多一两处）。',
    '不要写总结性的收尾语，直接给提取结果。',
    '下面是这一段字幕原文：',
    options.text
  ]
    .filter(Boolean)
    .join('\n\n');
}

function mergePrompt(options: {
  title: string;
  owner: string;
  duration: string;
  spanText: string;
  extraContext: string;
  referencesBlock: string;
  chunkCount: number;
  chunkSummaries: string;
}): string {
  return [
    options.title ? `视频：${options.title}` : '',
    options.owner ? `UP：${options.owner}` : '',
    options.duration ? `时长：${options.duration}` : '',
    options.spanText,
    options.extraContext,
    options.referencesBlock,
    `下面是这部视频**分成 ${options.chunkCount} 段**分别提取的内容，请把它们**合并成一篇完整、连贯的总结**。`,
    '要求：',
    '- 按时间顺序组织，覆盖**全片**（不要只写开头，也不要遗漏后面的段落）',
    '- 合并重复内容，保持逻辑连贯；同一主题分散在多段的要归并到一起',
    '- 保留具体数字、结论、步骤与例子',
    '- **不要**在正文里大量标注时间。时间只保留在**极少数**真正需要跳转的位置（全篇最多 2~3 处），其余一律不写时间。',
    '- **不要**写任何关于「字幕是否完整 / 某段字幕未提供 / 字幕只覆盖到某处」的说明；你无法判断字幕来源的完整性。',
    '各段提取结果如下：',
    options.chunkSummaries
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function summarizeInChunks(options: {
  platform: AiPlatform;
  settings: ReturnType<typeof loadSettings>;
  info: PageInfo;
  lines: SubtitleLine[];
  prompt: string;
  glossaryBlock: string;
  skills: string;
  metaBlock: string;
  referencesBlock: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  onDelta?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
}): Promise<{ text: string; chunks: number }> {
  const { platform, settings, info, lines } = options;
  const chunks = chunkTranscript(lines, SUMMARY_CHUNK_CHARS);
  const total = chunks.length;
  const background = options.metaBlock.slice(0, 900);
  const summaries: string[] = [];
  const chunkMaxTokens = Math.min(settings.ai.maxTokens || 8192, 8192);

  for (let index = 0; index < total; index += 1) {
    if (options.signal?.aborted) throw new Error('已终止');
    const chunk = chunks[index];
    options.onStatus?.(
      `长视频分段总结 ${index + 1}/${total}（约 ${clock(chunk.start)} 起）…`
    );
    const result = await chatOnce(
      platform,
      [
        {
          role: 'system',
          content: [
            options.prompt,
            options.glossaryBlock,
            options.skills,
            SUMMARY_FORMAT_RULES,
            CHUNK_SYSTEM
          ]
            .filter(Boolean)
            .join('\n\n')
        },
        {
          role: 'user',
          content: chunkPrompt({
            title: info.title || '',
            part: info.partTitle || '',
            index: index + 1,
            total,
            from: chunk.start,
            to: index + 1 < total ? chunks[index + 1].start : info.duration || chunk.end,
            background,
            text: chunk.text
          })
        }
      ],
      {
        temperature: settings.ai.temperature,
        maxTokens: chunkMaxTokens,
        timeoutMs: 600000,
        signal: options.signal
      }
    );
    if (!result.text.trim()) throw new Error(`第 ${index + 1}/${total} 段总结为空`);
    summaries.push(
      `【第 ${index + 1}/${total} 段 · 起于 ${clock(chunk.start)}】\n${result.text.trim()}`
    );
  }

  options.onStatus?.(`正在合并 ${total} 段总结…`);
  const messages = [
    {
      role: 'system' as const,
      content: [options.prompt, options.glossaryBlock, options.skills, SUMMARY_FORMAT_RULES]
        .filter(Boolean)
        .join('\n\n')
    },
    {
      role: 'user' as const,
      content: mergePrompt({
        title: info.title || '',
        owner: info.owner || '',
        duration: clock(info.duration || 0),
        spanText: subtitleSpanText(lines, info.duration || 0),
        extraContext: options.metaBlock,
        referencesBlock: options.referencesBlock,
        chunkCount: total,
        chunkSummaries: summaries.join('\n\n---\n\n')
      })
    }
  ];
  const chatOptions = {
    temperature: settings.ai.temperature,
    maxTokens: settings.ai.maxTokens || undefined,
    timeoutMs: 600000,
    signal: options.signal
  };

  if (settings.ai.stream === false) {
    const merged = await chatOnce(platform, messages, chatOptions);
    if (!merged.text.trim()) throw new Error('合并总结为空');
    options.onDelta?.(merged.text);
    if (merged.reasoning) options.onReasoning?.(merged.reasoning);
    return { text: merged.text, chunks: total };
  }

  const merged = await chatStream(platform, messages, {
    ...chatOptions,
    onDelta: options.onDelta,
    onReasoning: options.onReasoning
  });
  return { text: merged.text, chunks: total };
}

export async function summarize(options: SummarizeOptions): Promise<{ text: string; model: string; verification?: VerificationSummary }> {
  const settings = loadSettings();
  const platform = options.platform || activePlatform(settings);
  const template = activePrompt(settings);
  const prompt = options.prompt || template.text;

  // 总结默认不注入 Skills（与插件一致：只有用户在对话里显式选了技能才生效）。
  // 之前注入全部启用技能，会让总结凭空多出时间轴/术语表等章节，形式与插件不一致。
  const skills = '';
  const glossary = glossaryTerms(settings);
  const glossaryBlock = glossary.length
    ? `\n\n术语表（输出时统一使用以下写法）：\n${glossary
        .slice(0, 80)
        .map((term) => `- ${term.from} → ${term.to}${term.note ? `（${term.note}）` : ''}`)
        .join('\n')}`
    : '';

  if (!platform || !platform.baseUrl.trim()) throw new Error('请先在设置里选择一个 AI 平台');
  if (!platform.model.trim()) throw new Error('请先在设置里填写模型名');
  if (needsApiKey(platform) && !platform.apiKey.trim()) throw new Error('请先在设置里填写 API Key');

  const info = options.info;
  let workingLines = options.lines;
  if (settings.ai.preProofread && !options.skipProofread) {
    options.onStatus?.('先校对字幕…');
    try {
      const suggestions = await optimizeLines(options.lines, () => undefined, options.signal, settings);
      if (suggestions.length) {
        const byIndex = new Map(suggestions.map((item) => [item.index, item.suggestion]));
        workingLines = options.lines.map((line, index) =>
          byIndex.has(index) ? { ...line, text: byIndex.get(index) || line.text } : line
        );
        options.onStatus?.(`已校对 ${suggestions.length} 处`);
      } else {
        options.onStatus?.('校对完成，未发现改动');
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      options.onStatus?.('校对失败，改用原字幕');
    }
  }

  const transcript = fullTranscript(workingLines);
  if (!transcript.trim()) throw new Error('没有可用的字幕内容');

  let commentsBlock = '';
  if (settings.search.useComments && info.aid) {
    options.onStatus?.('正在获取热门评论…');
    try {
      const comments = await fetchHotComments(info, 12);
      if (options.signal?.aborted) throw new Error('已终止');
      if (comments.length) {
        commentsBlock = [
          '',
          '热门评论（仅作观众观点参考，不代表事实；不要逐条复述）：',
          ...comments.map(
            (comment, index) =>
              `${index + 1}. [${comment.like} 赞] ${comment.author}：${comment.content.slice(0, 160)}`
          )
        ].join('\n');
        options.onStatus?.(`已获取 ${comments.length} 条热门评论`);
      }
    } catch (error) {
      options.onStatus?.(`评论获取失败：${(error as Error).message}（继续总结）`);
    }
  }

  const metaBlock = [
    `视频标题：${info.title || '未知'}`,
    `UP 主：${info.owner || '未知'}`,
    `视频时长：${clock(info.duration)}`,
    `链接：${info.url || ''}`,
    ...(settings.search.useVideoMeta !== false && info.desc
      ? [`视频简介：${info.desc.slice(0, 2000)}`]
      : []),
    ...(commentsBlock ? [commentsBlock] : [])
  ].join('\n');

  const userContent = [
    metaBlock,
    '',
    '字幕（带时间戳，**已提供的全部**，请据此整理，不要推测缺失部分）：',
    transcript
  ].join('\n');

  let referencesBlock = '';
  let verification: VerificationSummary | undefined;
  if (settings.search.enabled) {
    if (settings.search.verifySummary !== false) {
      options.onStatus?.('正在从字幕抽取待核实项…');
      try {
        const verified = await verifySummary(
          settings,
          info,
          workingLines,
          options.signal,
          (done, total, query) =>
            options.onStatus?.(`联网核对 ${done}/${total}：${query.slice(0, 28)}`)
        );
        verification = verified;
        referencesBlock = buildVerifyBlock(verified);
        if (referencesBlock) {
          options.onStatus?.(
            `已核对 ${verified.attempted} 项，取得 ${verified.references.length} 条证据` +
              (verified.judged ? `，判定丢弃 ${verified.dropped} 条` : '') +
              (verified.supplements.length ? `，${verified.supplements.length} 条补充` : '') +
              (verified.failed ? `，${verified.failed} 项失败` : '')
          );
        } else {
          options.onStatus?.('没有取得可用证据，仅根据字幕总结');
        }
      } catch (error) {
        if (options.signal?.aborted) throw error;
        const message = (error as Error)?.message || String(error);
        verification = {
          items: [],
          references: [],
          supplements: [],
          attempted: 0,
          failed: 1,
          judged: false,
          dropped: 0,
          error: message
        };
        options.onStatus?.(`联网核对失败：${message}（继续总结）`);
      }
    } else {
      options.onStatus?.('正在联网检索参考资料…');
      try {
        const searchQuery = buildSearchQuery(info.title, info.owner);
        const references = rankReferences(searchQuery, await searchWeb(settings, searchQuery));
        if (references.length) {
          let budget = 6000;
          const rows: string[] = [];
          references.forEach((ref, index) => {
            if (budget <= 0) return;
            const snippet = ref.snippet.slice(0, Math.min(900, budget));
            budget -= snippet.length;
            rows.push(`[${index + 1}] ${ref.title}\n${ref.url}\n${snippet}`);
          });
          referencesBlock = [
            '',
            '联网参考资料（仅用于核对和补充，不要照抄；与字幕冲突时以字幕为准；使用到的地方用 [n] 标注来源）：',
            rows.join('\n\n')
          ].join('\n');
          options.onStatus?.(`已检索到 ${references.length} 条参考资料`);
        } else {
          options.onStatus?.('没有检索到参考资料，仅根据字幕总结');
        }
      } catch (error) {
        if (options.signal?.aborted) throw error;
        options.onStatus?.(`检索失败：${(error as Error).message}（继续总结）`);
      }
    }
  }

  // 长视频：分段提取 → 合并，避免只喂前 6 万字符导致“总结到一半就没了”。
  if (transcript.length > DIRECT_SUMMARY_CHARS) {
    const long = await summarizeInChunks({
      platform,
      settings,
      info,
      lines: workingLines,
      prompt,
      glossaryBlock,
      skills,
      metaBlock,
      referencesBlock,
      signal: options.signal,
      onStatus: options.onStatus,
      onDelta: options.onDelta,
      onReasoning: options.onReasoning
    });
    options.onStatus?.(`长视频总结完成（${long.chunks} 段合并）`);
    return { text: long.text, model: platform.model, verification };
  }

  options.onStatus?.('正在生成总结…');

  const messages = [
    {
      role: 'system' as const,
      content: `${prompt}${glossaryBlock}${skills}\n\n${SUMMARY_FORMAT_RULES}`
    },
    { role: 'user' as const, content: `${userContent}${referencesBlock}` }
  ];
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
    return { text: result.text, model: platform.model, verification };
  }

  const result = await chatStream(platform, messages, {
    ...chatOptions,
    onDelta: options.onDelta,
    onReasoning: options.onReasoning
  });
  return { text: result.text, model: platform.model, verification };
}
