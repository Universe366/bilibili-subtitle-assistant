import type { CollectionSummary } from '../shared/types';
import type { AiMessage } from './aiClient';
import { chatOnce, chatStream } from './aiClient';
import { activePlatform, loadSettings } from './settings';
import { needsApiKey } from './platformKey';
import { getCollectionMaterial, saveCollectionSummary } from './library';

const SYSTEM_PROMPT = [
  '你是视频合集对比助手。用户会给你同一个合集里多个视频的总结或字幕节选。',
  '请输出一份「合集对比笔记」，不要逐个复述视频内容。',
  '',
  '必须包含以下部分：',
  '1. **一句话总览**：这个合集主要在讨论什么。',
  '2. **速览表格**：视频 | 核心观点 | 适合谁 | 材料类型（总结/字幕）。',
  '3. **共识**：多个视频都提到的结论，注明来自哪些视频。',
  '4. **分歧与差异**：观点、方法、结论上的不同，用表格对比。',
  '5. **演进或互补关系**：如果视频之间有先后、上下游或互补关系，说明清楚。',
  '6. **推荐观看顺序**：给出顺序和理由。',
  '7. **材料空白**：哪些问题没有被回答，或材料不足以判断。',
  '',
  '硬性要求：',
  '· 只使用给定材料，不补充外部事实；材料没有写到的，明确写「材料未提及」。',
  '· 引用视频时使用给定标题，不要编造标题或观点。',
  '· 使用 Markdown；表格必须有表头与 `---` 分隔行。',
  '· 标题最多三级（`#` / `##` / `###`），不要跳级。',
  '· 这份笔记用于横向比较，详细程度以「能直接拿去选看/复习」为准。'
].join('\n');

function materialText(material: ReturnType<typeof getCollectionMaterial>): string {
  const parts = [
    `合集：${material.name || '未命名合集'}`,
    `视频数量：${material.blocks.length}`,
    ''
  ];
  material.blocks.forEach((block, index) => {
    parts.push(
      `【视频 ${index + 1}】${block.title || `#${block.videoId}`}`,
      `UP：${block.owner || '未知'}｜时长：${Math.round(block.duration / 60)} 分钟｜材料：${
        block.source === 'summary' ? '已保存总结' : '字幕节选'
      }`,
      '',
      block.text,
      '',
      '---',
      ''
    );
  });
  return parts.join('\n');
}

export async function summarizeCollection(
  collectionId: number,
  signal?: AbortSignal,
  onStatus?: (status: string) => void
): Promise<CollectionSummary> {
  const settings = loadSettings();
  const platform = activePlatform(settings);
  if (!platform || !platform.baseUrl.trim()) throw new Error('请先在设置里选择一个 AI 平台');
  if (!platform.model.trim()) throw new Error('请先在设置里填写模型名');
  if (needsApiKey(platform) && !platform.apiKey.trim()) throw new Error('请先在设置里填写 API Key');

  onStatus?.('正在收集合集内容…');
  const material = getCollectionMaterial(collectionId);
  if (!material.blocks.length) throw new Error('合集里没有可用的字幕或总结');

  onStatus?.(`已收集 ${material.blocks.length} 个视频，正在生成对比…`);
  const messages: AiMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: materialText(material) }
  ];
  const options = {
    temperature: Math.min(0.5, Math.max(0, Number(settings.ai.temperature) || 0.3)),
    maxTokens: settings.ai.maxTokens || undefined,
    timeoutMs: 600000,
    signal
  };

  const result =
    settings.ai.stream === false
      ? await chatOnce(platform, messages, options)
      : await chatStream(platform, messages, options);
  if (!result.text.trim()) throw new Error('AI 返回为空');

  return saveCollectionSummary(
    collectionId,
    result.text,
    platform.model,
    material.blocks.length
  );
}
