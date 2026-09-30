// 操作留痕（快照日志）+ 回退。
//
// 用户要求：「全流程留痕，可以回退」。
//
// 之前只有零散的备份：`subtitlesOriginal` 只保一份原文，只能整体回退一次；
// 而且「抓字幕 → AI 优化 → AI 校对」这些步骤前后无法回到中间某一态。
//
// 这里做一条**会话内的快照时间线**：
//   · 每个改变内容的步骤前后 push 一个快照（含字幕、总结、对话）
//   · 记录「是什么操作造成的变化」与时间
//   · 可回退到任意一个快照
//
// 只保留最近 MAX 条，避免吃掉存储配额。
// 快照只存**由视频派生的内容**，不含设置与密钥，回退也不会碰设置。

import { store } from './store.js';

const MAX = 40;

// 需要纳入快照的字段（都是「由视频派生」的可变内容）
const FIELDS = ['subtitles', 'subtitlesOriginal', 'summary', 'chat', 'video', 'optimize'];

let seq = 0;

function clone(v) {
  try {
    return structuredClone(v);
  } catch (err) {
    return JSON.parse(JSON.stringify(v));
  }
}

function snapshotOf(state) {
  const snap = {};
  for (const f of FIELDS) snap[f] = clone(state[f] === undefined ? null : state[f]);
  return snap;
}

// 判断两个快照的内容是否等价（只看真正会变的两个大字段，
// video/optimize 里的时间戳之类不应导致误判为「有变化」）
function sameContent(a, b) {
  if (!a || !b) return false;
  const norm = (lines) =>
    (lines || [])
      .map((l) => `${l.i}|${l.from}|${l.to}|${l.text}`)
      .join('\u0001');
  if (norm(a.subtitles) !== norm(b.subtitles)) return false;
  if (String(a.summary || '') !== String(b.summary || '')) return false;
  if ((a.chat || []).length !== (b.chat || []).length) return false;
  return true;
}

function push(label, extra = {}) {
  const st = store.get();
  const snap = snapshotOf(st);
  const timeline = st.timeline || [];
  const last = timeline[timeline.length - 1];
  // 内容没变就不重复留痕（否则一堆「无变化」的快照毫无价值）
  if (last && sameContent(last.snapshot, snap) && !extra.force) return null;
  seq += 1;
  const entry = {
    id: `s${Date.now().toString(36)}${seq}`,
    at: Date.now(),
    label: String(label || '操作'),
    detail: extra.detail || '',
    snapshot: snap
  };
  const next = [...timeline, entry].slice(-MAX);
  store.set({ timeline: next });
  return entry;
}

export function record(label, extra = {}) {
  return push(label, extra);
}

export function list() {
  return (store.get().timeline || []).slice().reverse();
}

export function get(id) {
  return (store.get().timeline || []).find((x) => x.id === id) || null;
}

// 回退到某个快照。**回退本身也会留痕**，所以还能再退回来。
export function revertTo(id) {
  const tl = store.get().timeline || [];
  const idx = tl.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  const target = tl[idx];
  // 回退前先记下当前状态，避免「退过去就回不来」
  push('回退前自动留痕');
  const restored = clone(target.snapshot);
  store.set({ ...restored });
  push(`回退到「${target.label}」`, { force: true });
  return target;
}

export function clear() {
  store.set({ timeline: [] });
}

export function count() {
  return (store.get().timeline || []).length;
}

export const TIMELINE_MAX = MAX;
