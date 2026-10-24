import { describe, expect, it } from 'vitest';
import { safeFileBase, uniqueFileName } from './exportNames';

describe('uniqueFileName', () => {
  it('不冲突时直接用基础名', () => {
    const used = new Set<string>();
    expect(uniqueFileName(used, '报告', 'md')).toBe('报告.md');
    expect(used.has('报告.md')).toBe(true);
  });

  it('重名追加序号', () => {
    const used = new Set(['报告.md']);
    expect(uniqueFileName(used, '报告', 'md')).toBe('报告-2.md');
    expect(uniqueFileName(used, '报告', 'md')).toBe('报告-3.md');
  });

  it('大小写不同也视为冲突', () => {
    const used = new Set(['report.md']);
    expect(uniqueFileName(used, 'Report', 'md')).toBe('Report-2.md');
  });
});

describe('safeFileBase', () => {
  it('替换 Windows 非法字符', () => {
    expect(safeFileBase('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('压缩空白并截断', () => {
    expect(safeFileBase('  a   b  ')).toBe('a b');
    expect(safeFileBase('x'.repeat(100)).length).toBe(60);
  });

  it('空名回退', () => {
    expect(safeFileBase('   ')).toBe('未命名');
  });
});
