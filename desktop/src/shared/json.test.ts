import { describe, expect, it } from 'vitest';
import { asJsonObject, readArray, readBoolean, readNumber, readObject, readString } from './json';

describe('JSON 边界读取器', () => {
  const source = {
    title: '拾字',
    count: 42,
    enabled: true,
    tags: ['a', 'b'],
    nested: { id: 1 }
  };

  it('读取基础类型', () => {
    expect(readString(source, 'title')).toBe('拾字');
    expect(readNumber(source, 'count')).toBe(42);
    expect(readBoolean(source, 'enabled')).toBe(true);
    expect(readString(source, 'missing')).toBeUndefined();
  });

  it('类型不符时返回 undefined，而不是强转', () => {
    expect(readString(source, 'count')).toBeUndefined();
    expect(readNumber(source, 'title')).toBeUndefined();
    expect(readBoolean(source, 'title')).toBeUndefined();
  });

  it('数组与嵌套对象', () => {
    expect(readArray(source, 'tags')).toEqual(['a', 'b']);
    expect(readArray(source, 'title')).toEqual([]);
    expect(readObject(source, 'nested')).toEqual({ id: 1 });
    expect(readObject(null, 'nested')).toBeNull();
  });

  it('asJsonObject 拒绝数组与原始值', () => {
    expect(asJsonObject([1, 2])).toBeNull();
    expect(asJsonObject('text')).toBeNull();
    expect(asJsonObject({ a: 1 })).toEqual({ a: 1 });
  });
});
