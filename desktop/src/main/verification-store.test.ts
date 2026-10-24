import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PageInfo, VerificationSummary } from '../shared/types';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: () => state.dir
  }
}));

import { closeLibrary, getSummaryFor, initLibrary, saveSummary } from './library';

const info: PageInfo = {
  kind: 'video',
  bvid: 'BV1verify001',
  aid: 11,
  cid: 22,
  epId: null,
  seasonId: null,
  page: 1,
  partTitle: '',
  parts: [],
  title: '核对持久化测试',
  owner: 'UP',
  desc: '',
  duration: 60,
  url: 'https://www.bilibili.com/video/BV1verify001',
  signature: 'sig-verify'
};

const verification: VerificationSummary = {
  items: [
    {
      label: '3nm',
      query: '3nm',
      line: '台积电 3nm 量产',
      references: [{ title: '证据标题', url: 'https://example.com/a', snippet: 's' }]
    }
  ],
  references: [{ title: '证据标题', url: 'https://example.com/a', snippet: 's' }],
  supplements: ['补充一句'],
  attempted: 1,
  failed: 0,
  judged: false,
  dropped: 0
};

describe('总结携带核对结果', () => {
  beforeAll(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-verify-'));
    initLibrary();
  });

  afterAll(() => {
    closeLibrary();
    fs.rmSync(state.dir, { recursive: true, force: true });
  });

  it('保存后能读回判定、证据与补充', () => {
    saveSummary(info, '# 总结正文', 'test-model', verification);
    const saved = getSummaryFor({ bvid: info.bvid, cid: info.cid, epId: null });
    expect(saved?.content).toContain('总结正文');
    expect(saved?.verification?.judged).toBe(false);
    expect(saved?.verification?.references[0]?.title).toBe('证据标题');
    expect(saved?.verification?.supplements).toEqual(['补充一句']);
  });

  it('没有核对结果时读回 null，不影响旧数据', () => {
    const other: PageInfo = { ...info, bvid: 'BV1verify002', title: '旧总结' };
    saveSummary(other, '# 只有正文', 'test-model');
    const saved = getSummaryFor({ bvid: other.bvid, cid: other.cid, epId: null });
    expect(saved?.content).toContain('只有正文');
    expect(saved?.verification ?? null).toBeNull();
  });

  it('覆盖保存会更新核对结果', () => {
    const next: VerificationSummary = { ...verification, judged: true, dropped: 2 };
    saveSummary(info, '# 新正文', 'test-model', next);
    const saved = getSummaryFor({ bvid: info.bvid, cid: info.cid, epId: null });
    expect(saved?.verification?.judged).toBe(true);
    expect(saved?.verification?.dropped).toBe(2);
  });
});
