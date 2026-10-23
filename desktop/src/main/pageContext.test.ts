import { describe, expect, it } from 'vitest';
import { selectRelevantChunks } from './pageContext';

describe('selectRelevantChunks', () => {
  it('短文原样返回', () => {
    expect(selectRelevantChunks('短文本', '问题', 100)).toBe('短文本');
  });

  it('长文按问题选中后段内容，同时保留开头', () => {
    const blocks: string[] = ['# 标题\n\n开头摘要'];
    for (let index = 0; index < 30; index += 1) {
      blocks.push(`第 ${index} 段：这是一些和主题无关的普通内容。`);
    }
    blocks.push('目标段落：Transformer 的注意力机制需要 QKV 三个矩阵。');
    const text = blocks.join('\n\n');
    const selected = selectRelevantChunks(text, 'Transformer 注意力机制是什么？', 1200);
    expect(selected).toContain('开头摘要');
    expect(selected).toContain('QKV');
    expect(selected.length).toBeLessThanOrEqual(1200);
  });

  it('没有命中时按顺序填充', () => {
    const text = Array.from({ length: 20 }, (_, index) => `段落 ${index} 内容`).join('\n\n');
    const selected = selectRelevantChunks(text, '', 100);
    expect(selected.startsWith('段落 0')).toBe(true);
    expect(selected.length).toBeLessThanOrEqual(100);
  });
});
