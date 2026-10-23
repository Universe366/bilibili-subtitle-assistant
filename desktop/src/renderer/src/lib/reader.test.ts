import { describe, expect, it } from 'vitest';
import { buildReaderMarkdown, readerParagraphs } from './reader';

describe('reader', () => {
  it('按行拆分并去掉空行', () => {
    expect(readerParagraphs('第一段\n\n第二段\n  \n第三段')).toEqual(['第一段', '第二段', '第三段']);
  });

  it('生成带标题和来源的 Markdown', () => {
    const md = buildReaderMarkdown({
      title: '测试文章',
      url: 'https://example.com/a',
      text: '第一段\n第二段'
    });
    expect(md).toContain('# 测试文章');
    expect(md).toContain('> 来源：https://example.com/a');
    expect(md).toContain('第一段\n\n第二段');
  });

  it('空标题有兜底', () => {
    expect(buildReaderMarkdown({ title: '', url: '', text: '正文' })).toContain('# 未命名页面');
  });
});
