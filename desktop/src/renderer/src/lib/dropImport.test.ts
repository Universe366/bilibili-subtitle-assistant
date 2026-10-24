import { describe, expect, it } from 'vitest';
import { extractDropPayload } from './dropImport';

const data = (values: Record<string, string>, files: File[] = []) => ({
  getData: (type: string) => values[type] || '',
  files
});

describe('extractDropPayload', () => {
  it('优先 uri-list 里的 http 链接', () => {
    expect(
      extractDropPayload(
        data({
          'text/uri-list': 'https://www.bilibili.com/video/BV1xx411c7mD\n# comment',
          'text/plain': 'ignored'
        })
      )
    ).toEqual({ kind: 'url', value: 'https://www.bilibili.com/video/BV1xx411c7mD' });
  });

  it('纯文本 BV 号', () => {
    expect(extractDropPayload(data({ 'text/plain': 'BV1xx411c7mD' }))).toEqual({
      kind: 'text',
      value: 'BV1xx411c7mD'
    });
  });

  it('裸域名当文本处理', () => {
    expect(extractDropPayload(data({ 'text/plain': 'example.com/a' }))).toEqual({
      kind: 'text',
      value: 'example.com/a'
    });
  });

  it('普通文字不当地址', () => {
    expect(extractDropPayload(data({ 'text/plain': '这是一段普通说明' }))).toBeNull();
  });

  it('有文件时标记 files', () => {
    expect(
      extractDropPayload(data({}, [new File(['x'], 'a.mp3', { type: 'audio/mpeg' })]))
    ).toEqual({ kind: 'files', value: '1' });
  });
});
