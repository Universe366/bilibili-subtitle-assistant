// 应用上下文：所有动作（抓取 / 转录 / 优化 / 检索 / 历史 / 批量）在此集中编排，
// 面板只调用这里的接口，避免互相依赖。

import { store, saveSettings } from './store.js';
import { call, errorPayload } from './bridge.js';
import { toast, downloadFile, copyText, h, button, fmtTime, clear } from './dom.js';
import * as jobs from './jobs.js';
import { harvestSubtitles, overallStats, lineStats, sortCandidates } from './subtitles.js';
import { transcribeVideo } from './transcribe.js';
import * as OPT from './optimize.js';
import * as SEARCH from './search.js';
import { buildExport, safeFilename } from './exporter.js';
import { DEFAULT_SYSTEM_PROMPT, TASK_LABEL, METHOD_TIMEOUT } from '../../shared/constants.js';
import { buildVerifyClaims, verifyItems, contextWindowForQuery, annotateEvidenceAgreement } from '../../shared/verify.js';

export const app = {
  panels: {},
  overlays: {},
  lastError: null,
  batch: {
    items: [],
    running: false,
    paused: false,
    history: []
  }
};

export function usePanel(name, api) {
  app.panels[name] = api;
}

// ---------------------------------------------------------------------------
// 提示与错误
// ---------------------------------------------------------------------------

export function showError(err, fallbackTitle = '操作失败') {
  const payload = errorPayload(err);
  app.lastError = { ...payload, at: Date.now() };
  toast(payload, 'error', 6000);
  renderPanels();
  return payload;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export function applyTheme(s) {
  const theme = (s && s.general && s.general.theme) || 'system';
  const scale = (s && s.general && s.general.fontScale) || 1;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.setProperty('--fs', `${(13 * scale).toFixed(1)}px`);
}

export async function persistSettings(next, opts = {}) {
  const saved = await saveSettings(next);
  applyTheme(saved);
  await pushPageOptions(saved);
  if (!opts.silent) toast({ title: '设置已保存' }, 'ok', 1600);
  renderPanels();
  return saved;
}

export async function pushPageOptions(settings) {
  const s = settings || store.get().settings;
  if (!s) return;
  try {
    await call('page.call', {
      name: 'applyOptions',
      params: {
        playerButton: s.page.playerButton,
        playerButtonPrompt: s.page.playerButtonPrompt,
        overlay: s.page.overlay,
        overlayFontScale: s.page.overlayFontScale,
        overlayBottom: s.page.overlayBottom,
        followPlayback: s.page.followPlayback
      }
    });
  } catch (err) {
    /* 没有打开 B 站页面时忽略 */
  }
}

// ---------------------------------------------------------------------------
// 视频信息
// ---------------------------------------------------------------------------

export async function loadVideo(opts = {}) {
  const tab = jobs.beginTask('读取视频信息', { detail: '' });
  try {
    // 内嵌面板可能在 B 站页面刚加载/刚切 P 时立即读取：
    // page.info 这时可能返回空对象。重试几次，比直接报“没有视频信息”稳。
    let info = null;
    let lastErr = null;
    for (let i = 0; i < 5; i += 1) {
      try {
        info = await call('page.info', {}, { timeoutMs: 20000 });
      } catch (err) {
        lastErr = err;
        info = null;
      }
      if (info && info.signature) break;
      if (i < 4) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!info || !info.signature) {
      if (lastErr) throw lastErr;
      throw new Error('页面没有返回视频信息（已重试 5 次；请刷新 B 站页面后重试）');
    }
    const attempt = await call('page.call', { name: 'getSubtitles', params: {} }, { timeoutMs: 20000 });
    const detail = (attempt && attempt.data) || {};
    const video = {
      ...info,
      subtitleTracks: detail.subtitles || [],
      subSources: detail.sources || [],
      subtitleDetail: detail
    };

    // ---- 换了视频就必须清掉上一个视频的残留 ----
    //
    // 之前这里是直接 `store.set({ video })`，**什么都不清**。
    // 结果：从 A 视频切到 B 视频后，左侧还是 A 的字幕、总结还是 A 的内容、
    // 对话历史也还混着 A 的 —— 这就是用户报的
    // 「上一次的读取残留影响这次读取」。
    //
    // 判据用 signature（bvid + 分P + cid），切分 P 也算换视频。
    const prev = store.get();
    const prevSig = (prev.video && prev.video.signature) || '';
    const changed = prevSig !== (video.signature || '');
    const cleared = {};
    if (changed) {
      // 只清「由视频派生的」数据，不动设置、缓存、导出配置等全局状态
      cleared.subtitles = [];
      cleared.subtitlesOriginal = [];
      cleared.summary = '';
      cleared.summaryStream = '';
      cleared.chat = [];
      cleared.transcriptLog = [];
      cleared.search = { ...(prev.search || {}), results: [], counts: {}, query: '' };
    }

    store.set({ video, ...cleared });
    // 换视频后重开一条留痕时间线 —— 旧视频的步骤混进来会让人困惑
    if (changed) store.set({ timeline: [] });
    recordTimeline(changed ? '读取视频' : '重新读取视频', video.title || '');
    if (changed && prevSig) {
      toast(
        {
          title: '已切换到新的视频',
          detail: '上一个视频的字幕、总结与对话已清空，避免和这次混在一起。'
        },
        'ok',
        3500
      );
    }
    if (store.get().settings) await pushPageOptions();

    // ---- 已经处理过的视频：直接把上次的字幕 + 总结呈现出来 ----
    //
    // 用户需求：「如果遇到已经读取总结过的视频，直接将总结过的内容呈现出来，
    // 不用重新搞」。所以在读取视频后自动查一次历史，命中就直接填上，
    // 不必再点「抓取字幕」「生成总结」。
    //
    // 只填**空着的**字段：如果本次会话里已经有内容（例如刚生成过），
    // 不要被历史覆盖掉。
    //
    // opts.noRestore：**页面内跳转（SPA 导航）时必须传 true**。
    // 否则换视频后会自动把上一个视频的字幕/总结从历史里载回来，
    // 界面看起来「没有重新开始，还停在原来那期视频的总结上」——
    // 用户实际报的就是这个现象。手动点「读取当前视频」时才回填。
    if (changed && !opts.noRestore) await restoreFromHistory(video, { toast: true });
    return video;
  } catch (err) {
    showError(err, '读取视频信息失败');
    return null;
  } finally {
    tab.end();
  }
}

// 把历史里的字幕/总结填回当前状态。
//
// 抽成函数是为了**两个入口都能用**：
//   · 点「读取当前视频」→ loadVideo
//   · 页面内跳转（SPA 导航）→ app.js 的 navigate 处理器
// 之前只在 loadVideo 里做了，于是「页面内点开另一个视频」这条路
// 清空了总结却从不回填，表现为「字幕出来了、总结没出来」。
export async function restoreFromHistory(video, opts = {}) {
  const v = video || store.get().video;
  if (!v || !v.bvid) return null;
  try {
    // key 必须与 ST.historyKey 完全一致（bvid|cid|page），否则查不到。
    const key = [v.bvid || '-', v.cid || '-', v.page == null ? '-' : String(v.page)].join('|');
    const hit = await call('history.get', { key }, { timeoutMs: 8000 });
    const row = hit && hit.row;
    const hasLines = Array.isArray(row && row.lines) && row.lines.length > 0;
    const hasSummary = !!(row && row.summary);
    if (!hasLines && !hasSummary) return null;

    const cur = store.get();
    const nextSubtitles = hasLines ? row.lines : cur.subtitles;
    const nextSummary = hasSummary ? row.summary : cur.summary;
    // 什么都没变就别 set（避免无意义的重渲染与提示）
    const sameLines = JSON.stringify(nextSubtitles) === JSON.stringify(cur.subtitles || []);
    const sameSummary = String(nextSummary || '') === String(cur.summary || '');
    if (sameLines && sameSummary) return row;

    store.set({
      video: {
        ...cur.video,
        stats: row.stats || (cur.video && cur.video.stats),
        subtitleMeta: row.subtitleMeta || (cur.video && cur.video.subtitleMeta),
        chapters: row.chapters || [],
        source: row.source || (cur.video && cur.video.source)
      },
      subtitles: nextSubtitles,
      summary: nextSummary,
      verifyQueries: [],
      verifyEvidence: [],
      verifyFailures: [],
      verifyJudged: false
    });
    recordTimeline('载入历史结果', `${hasLines ? `${row.lines.length} 行字幕` : ''}${hasLines && hasSummary ? ' + ' : ''}${hasSummary ? '总结' : ''}`);
    renderPanels();
    if (opts.toast !== false) {
      toast(
        {
          title: '已载入上次的结果',
          detail: `${hasLines ? `字幕 ${row.lines.length} 行` : ''}${hasLines && hasSummary ? '，' : ''}${
            hasSummary ? '总结已就绪' : ''
          }。想重新生成，点「重新生成总结」。`
        },
        'ok',
        4000
      );
    }
    return row;
  } catch (err) {
    /* 载入历史失败不影响主流程 */
    return null;
  }
}

// ---------------------------------------------------------------------------
// 字幕抓取
// ---------------------------------------------------------------------------

export async function harvest(opts = {}) {
  const s = store.get().settings;
  const video = store.get().video || (await loadVideo());
  if (!video) return null;
  const task = jobs.beginTask(TASK_LABEL.harvest, { detail: '选择候选字幕轨' });
  try {
    const result = await harvestSubtitles(video, s, {
      onProgress: (p) => task.set(p.percent, p.detail)
    });
    const attempts = result.attempts || [];
    const diagnostic = result.diagnostic || null;
    if (!result.ok) {
      const payload = result.reason || { title: '没有可用字幕' };
      const detailLines = attempts.length
        ? attempts.map((a) => {
            const tag = `· ${a.label}${a.from === 'api' ? '（接口）' : ''}`;
            if (a.error) return `${tag}：下载失败 —— ${a.error.title}${a.error.detail ? `（${a.error.detail}）` : ''}`;
            if (a.validation && !a.validation.ok) return `${tag}：${a.validation.title}（${a.validation.detail}）`;
            if (a.validation && a.validation.ok) return `${tag}：通过`;
            return `${tag}：未处理（${a.stage}）`;
          })
        : ['· （本次没有任何候选字幕轨可尝试）'];
      payload.detail = `${payload.detail || ''}\n候选轨明细：\n${detailLines.join('\n')}`;
      if (diagnostic) {
        payload.detail += `\n诊断：页面侧 ${diagnostic.pageTracks.length} 条 / 接口侧 ${diagnostic.apiTracks.length} 条`;
        if (diagnostic.apiError) payload.detail += `；接口错误：${diagnostic.apiError.title}`;
      }
      store.set({ subtitleAttempts: attempts, subtitleError: payload, subtitleDiagnostic: diagnostic });
      showError(Object.assign(new Error(payload.title), { payload }), payload.title);
      return null;
    }
    const stats = overallStats(result.lines);
    const videoWithMeta = {
      ...video,
      source: 'official',
      subtitleMeta: result.meta,
      stats,
      chapters: video.chapters || []
    };
    store.set({
      video: videoWithMeta,
      subtitles: result.lines,
      subtitleAttempts: attempts,
      subtitleError: null,
      subtitleDiagnostic: diagnostic,
      subtitlesRevision: (store.get().subtitlesRevision || 0) + 1
    });
    await saveHistory();
    await syncOverlayLines();
    if (s.optimize.autoApplyAfter) await applyActiveRules({ silent: true });
    return result;
  } catch (err) {
    showError(err);
    return null;
  } finally {
    task.end();
    renderPanels();
  }
}

// 清空当前字幕（含校对备份、章节、统计、诊断）。
//
// 为什么必须有这个功能：用户报
// 「此时读取出来的字幕为什么不能清除？」——
// 之前确实**没有任何清空字幕的入口**。抓到可疑内容（例如疑似别的视频的
// 字幕）时，用户唯一的办法就是换视频或重启侧边栏。
//
// 只清「由视频派生的内容」，不动视频信息本身与设置。
export function clearSubtitles(opts = {}) {
  const st = store.get();
  if (!(st.subtitles || []).length && !st.subtitleError && !(st.subtitlesOriginal || []).length) {
    if (!opts.silent) toast({ title: '当前没有字幕可清除' }, 'warn');
    return false;
  }
  store.set({
    subtitles: [],
    subtitlesOriginal: [],
    // 章节是按原字幕切出来的，字幕没了就该一起清掉
    video: st.video ? { ...st.video, chapters: [], stats: null, subtitleMeta: null, source: null } : st.video,
    subtitleAttempts: [],
    subtitleError: null,
    subtitleDiagnostic: null,
    // 让字幕列表等按依赖重绘
    subtitlesRevision: (st.subtitlesRevision || 0) + 1
  });
  recordTimeline('清空字幕');
  renderPanels();
  if (!opts.silent) {
    toast({ title: '已清空字幕', detail: '可以重新「获取字幕」或改用「语音转录」。' }, 'ok');
  }
  return true;
}

// ---------------------------------------------------------------------------
// 语音转录
// ---------------------------------------------------------------------------

export async function transcribe() {
  const s = store.get().settings;
  const video = store.get().video || (await loadVideo());
  if (!video) return null;
  if (!s.__readiness && store.get().readiness && !store.get().readiness.ok.asr) {
    const issue = (store.get().readiness.issues || []).find((i) => i.area === 'asr');
    if (issue) {
      showError(Object.assign(new Error(issue.text), { payload: { kind: 'nokey', title: '语音识别不可用', detail: issue.text, action: '打开 设置 → 语音识别平台 填写 Key。' } }));
      return null;
    }
  }
  const task = jobs.beginTask(TASK_LABEL.transcribe, { detail: '准备中', cancellable: true });
  const logLines = [];
  try {
    const out = await transcribeVideo({
      video,
      settings: s,
      hooks: {
        signal: task.signal,
        onProgress: ({ percent, detail }) => task.set(percent, detail),
        onLog: (msg) => {
          logLines.push(msg);
          task.detail(msg.slice(0, 60));
        }
      }
    });
    const stats = overallStats(out.lines);
    const nextVideo = {
      ...video,
      source: 'asr',
      subtitleMeta: out.meta,
      stats,
      transcriptLog: logLines
    };
    store.set({ video: nextVideo, subtitles: out.lines, subtitleError: null });
    await saveHistory();
    await syncOverlayLines();

    // 转录后自动优化 / 自动替换（默认关闭）
    if (s.asr.autoOptimizeAfter) {
      await optimizeWithAi({ silent: true });
    } else if (s.asr.autoApplyAfter) {
      await applyActiveRules({ silent: true });
    }
    toast({ title: `转录完成：${out.lines.length} 行`, detail: logLines.slice(-2).join('；') }, 'ok', 4000);
    return out;
  } catch (err) {
    if (err && (err.name === 'AbortError' || task.signal.aborted)) {
      toast({ title: '已终止转录', detail: '不再继续消耗额度。' }, 'warn');
      return null;
    }
    // 失败时也要保留转录日志：排查问题最需要的就是「它到底做到哪一步、发了什么」。
    const payload = (err && err.payload) || { title: (err && err.message) || '转录失败' };
    try {
      store.set({
        video: { ...video, transcriptLog: logLines },
        subtitleError: {
          ...payload,
          detail: `${payload.detail || ''}\n\n转录日志（共 ${logLines.length} 条）：\n${logLines.join('\n')}`.trim()
        },
        subtitleAttempts: []
      });
    } catch (e) {
      /* ignore */
    }
    showError(err, '语音转录失败');
    return null;
  } finally {
    task.end();
    renderPanels();
  }
}

// ---------------------------------------------------------------------------
// 字幕行编辑
// ---------------------------------------------------------------------------

export function updateLine(index, text) {
  const lines = [...store.get().subtitles];
  const l = lines.find((x) => x.i === index);
  if (!l) return;
  lines[lines.indexOf(l)] = { ...l, text, edited: text !== (l.original || l.text) };
  store.set({ subtitles: lines });
  refreshStats();
}

// 所有「改写字幕」的路径都汇聚到这里，所以留痕也放在这里 ——
// 这样抓字幕、AI 优化、AI 校对、手动改行都会被自动记录，不用逐处调用。
export function setLines(lines, meta = {}) {
  store.set({ subtitles: lines });
  refreshStats();
  recordTimeline(meta.label || '字幕已更新', meta.detail || `${(lines || []).length} 行`);
}

// 延迟到运行期再取 timeline 模块：timeline.js 依赖 store，
// 用顶层 import 会形成循环依赖（虽然 ESM 能处理，但初始化顺序很脆）。
function recordTimeline(label, detail) {
  import('./timeline.js')
    .then((T) => T.record(label, { detail }))
    .catch(() => {});
}

export function refreshStats() {
  const st = store.get();
  const lines = st.subtitles || [];
  if (!lines.length) {
    if (st.video) store.set({ video: { ...st.video, stats: { lines: 0, chars: 0, sentences: 0, speakSeconds: 0, coverage: 0 } } });
    return;
  }
  const stats = overallStats(lines);
  if (st.video) store.set({ video: { ...st.video, stats } });
}

async function syncOverlayLines() {
  const st = store.get();
  if (!st.settings?.page?.overlay) return;
  try {
    await call('page.call', {
      name: 'setOverlayLines',
      params: { lines: (st.subtitles || []).map((l) => ({ from: l.from, to: l.to, text: l.text })) }
    });
  } catch (err) {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// 替换规则 / 优化
// ---------------------------------------------------------------------------

export async function applyActiveRules(opts = {}) {
  const s = store.get().settings;
  const group = (s.optimize.groups || []).find((g) => g.id === s.optimize.activeGroupId);
  if (!group) {
    toast({ title: '没有选中的替换规则组' }, 'warn');
    return null;
  }
  const lines = store.get().subtitles || [];
  if (!lines.length) {
    toast({ title: '还没有字幕可以替换' }, 'warn');
    return null;
  }
  const res = OPT.applyRulesToLines(lines, group.rules);
  setLines(res.lines);
  if (!opts.silent) {
    toast({ title: `已应用规则组「${group.name}」`, detail: `修改了 ${res.changed} 行` }, 'ok', 2600);
  }
  await saveHistory();
  renderPanels();
  return res;
}

export async function optimizeWithAi(opts = {}) {
  const s = store.get().settings;
  const lines = store.get().subtitles || [];
  if (!lines.length) {
    toast({ title: '还没有字幕可以优化' }, 'warn');
    return null;
  }
  const video = store.get().video;
  const task = jobs.beginTask(TASK_LABEL.optimize, { detail: '向 AI 提交字幕全文' });
  try {
    // 联网核对：**逐条**查字幕里的术语/事实/时间/数据，而不是整篇搜。
    // 整篇搜会把上万字网页灌进上下文，模型就开始把字幕改写成网页内容
    // （总结那边已经踩过这个坑）。
    let verify = [];
    let evidence = { results: [] };
    if (s.optimize.useSearch) {
      task.detail('联网核对字幕里的术语与事实…');
      try {
        const items = buildVerifyClaims(lines, s.optimize.verifyItemCount || 8);
        if (items.length) {
          verify = await verifyItems(
            items,
            (q, o) => doProviderSearch(q, { ...o, quiet: true, ephemeral: true }),
            {
              maxItems: s.optimize.verifyItemCount || 8,
              perItem: 3,
              concurrency: 2,
              // 用字幕原句作为上下文，过滤只是提到名字、没谈这件事的网页
              contextOf: (q) => contextWindowForQuery(lines, q)
            }
          );
          // 手动优化没有单独的语义判定调用，这里只按独立域名粗标来源强度
          annotateEvidenceAgreement(verify);
          task.detail(`已核对 ${verify.length} 条`);
        }
      } catch (err) {
        /* 核对失败不影响优化本身 */
      }
      // 兼容：用户可能仍想看整篇检索结果，仅在逐条核对一无所获时才回退
      if (!verify.length) {
        evidence = await OPT.gatherSearchEvidence(s, `${video?.title || ''} 专有名词 术语`);
      }
    }
    const messages = OPT.buildOptimizeMessages({
      lines,
      glossary: s.optimize.glossary,
      verify,
      searchResults: evidence.results,
      useSearch: !!s.optimize.useSearch,
      videoTitle: (video && video.title) || ''
    });
    task.set(20, '等待 AI 返回修正建议');
    const res = await call('ai.chat', { messages, temperature: 0.1, maxTokens: 3000 }, { timeoutMs: 300000 });
    const corrections = OPT.parseOptimizeResult(res.text);
    store.set({ optimize: { ...(store.get().optimize || {}), corrections, raw: res.text } });
    if (!corrections.length) {
      toast({ title: 'AI 没有发现需要修正的地方' }, 'ok');
      return { corrections: [] };
    }
    if (s.optimize.autoApplyAfter || opts.autoApply) {
      const applied = OPT.applyCorrections(lines, corrections);
      setLines(applied.lines);
      await saveHistory();
      toast({ title: `AI 优化完成，已自动全部替换`, detail: `修正 ${applied.changed} 处` }, 'ok', 3500);
      renderPanels();
      return { corrections, applied };
    }
    // 否则把建议渲染成可逐条应用/全部应用的界面
    store.set({ optimize: { ...(store.get().optimize || {}), corrections, pending: true } });
    if (!opts.silent) {
      store.set({ activeTab: 'subtitles' });
      toast({ title: `AI 给出 ${corrections.length} 条修正建议`, detail: '可在字幕区上方逐条应用，或一键全部应用。' }, 'ok', 4000);
    }
    renderPanels();
    return { corrections };
  } catch (err) {
    showError(err, 'AI 优化失败');
    return null;
  } finally {
    task.end();
    renderPanels();
  }
}

export async function applyCorrection(index, scope = 'all') {
  const st = store.get();
  const corrections = (st.optimize && st.optimize.corrections) || [];
  const c = corrections[index];
  if (!c) return;
  const res = OPT.applyCorrections(st.subtitles, [c], { onlyLine: scope === 'line' ? c.line : undefined });
  setLines(res.lines);
  const rest = corrections.filter((_, i) => i !== index);
  store.set({ optimize: { ...(st.optimize || {}), corrections: rest, pending: rest.length > 0 } });
  await saveHistory();
  renderPanels();
}

export async function applyAllCorrections() {
  const st = store.get();
  const corrections = (st.optimize && st.optimize.corrections) || [];
  if (!corrections.length) return;
  const res = OPT.applyCorrections(st.subtitles, corrections);
  setLines(res.lines);
  store.set({ optimize: { ...(st.optimize || {}), corrections: [], pending: false } });
  await saveHistory();
  toast({ title: '已全部应用', detail: `共修改 ${res.changed} 处` }, 'ok');
  renderPanels();
}

// ---------------------------------------------------------------------------
// 章节 / 质量自检
// ---------------------------------------------------------------------------

export async function generateChapters() {
  const s = store.get().settings;
  const lines = store.get().subtitles || [];
  const video = store.get().video;
  if (!lines.length) {
    toast({ title: '还没有字幕，无法分段' }, 'warn');
    return null;
  }
  const task = jobs.beginTask(TASK_LABEL.chapters, { detail: 'AI 正在阅读全文' });
  try {
    const transcript = lines.map((l) => `${fmtTime(l.from)} ${l.text}`).join('\n');
    const messages = [
      {
        role: 'system',
        content:
          '你是视频内容分段助手。只输出 JSON，不要输出解释、不要用代码块包裹。' +
          '格式：{"chapters":[{"title":"段落标题","start":起始秒数,"end":结束秒数,"summary":"一句话概括"}]}' +
          '要求：4~12 段，覆盖全片，start/end 必须是数字（秒）。'
      },
      { role: 'user', content: `视频标题：${video?.title || ''}\n时长：${video?.duration || 0} 秒\n字幕：\n${transcript}` }
    ];
    const res = await call('ai.chat', { messages, temperature: 0.2, maxTokens: 3000 }, { timeoutMs: 300000 });
    const chapters = parseChapters(res.text);
    if (!chapters.length) throw new Error('AI 没有返回可解析的章节');
    store.set({ video: { ...video, chapters } });
    await saveHistory();
    toast({ title: `已生成 ${chapters.length} 个章节`, detail: '点击章节可跳转到对应时间' }, 'ok');
    renderPanels();
    return chapters;
  } catch (err) {
    showError(err, '章节生成失败');
    return null;
  } finally {
    task.end();
  }
}

function parseChapters(text) {
  const raw = String(text || '');
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  const cand = first >= 0 && last > first ? raw.slice(first, last + 1) : raw;
  try {
    const json = JSON.parse(cand);
    const arr = json.chapters || json.data || (Array.isArray(json) ? json : []);
    return arr
      .map((c) => ({
        title: String(c.title || c.name || '未命名').slice(0, 80),
        start: Number(c.start) || 0,
        end: Number(c.end) || 0,
        summary: String(c.summary || '')
      }))
      .filter((c) => Number.isFinite(c.start))
      .sort((a, b) => a.start - b.start);
  } catch (err) {
    return [];
  }
}

export function runQualityCheck() {
  const st = store.get();
  const result = OPT.qualityCheck(st.subtitles || [], st.video);
  store.set({ quality: result });
  renderPanels();
  if (result.ok && !result.issues.length) toast({ title: '质量自检通过：未发现异常' }, 'ok');
  else if (result.issues.length) {
    toast({ title: `质量自检发现 ${result.issues.length} 项`, detail: result.issues.map((i) => i.text).join('；').slice(0, 200) }, result.ok ? 'warn' : 'error', 6000);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 检索
// ---------------------------------------------------------------------------

// 服务商检索。
//
// opts.fetchPageContent === false → 只要摘要，不抓网页正文
//   （总结核实用的是这个：抓正文会把上万字无关内容灌进上下文）
// opts.quiet === true            → 不显示任务提示
// opts.ephemeral === true        → **不写入全局检索面板、不弹提示**
//   核实流程会连续搜好几条，写面板会把用户上一次的检索结果冲掉
export async function doProviderSearch(query, opts = {}) {
  const s = store.get().settings;
  const task = opts.quiet ? null : jobs.beginTask(TASK_LABEL.search, { detail: '调用检索服务商' });
  try {
    const out = await SEARCH.runProviderSearch(s, query, {
      onLog: (m) => task && task.detail(m),
      oriQuestion: opts.oriQuestion || query,
      rid: opts.rid,
      ...(Number(opts.maxResults) > 0 ? { maxResults: Number(opts.maxResults) } : {}),
      ...(opts.fetchPageContent !== undefined ? { fetchPageContent: !!opts.fetchPageContent } : {})
    });
    if (out && out.results && !opts.ephemeral) {
      const current = store.get().search || {};
      const counts = SEARCH.countCitations(store.get().summary || '', out.results);
      store.set({
        search: {
          ...current,
          results: out.results,
          counts,
          query: out.query,
          provider: out.provider,
          lastAt: out.at
        }
      });
    }
    if (!opts.quiet && !opts.ephemeral) {
      toast({ title: `检索完成：${out.results.length} 条来源`, detail: '结果会作为 AI 回答的依据（已消耗额度）' }, 'ok');
      renderPanels();
    }
    return out;
  } catch (err) {
    if (!opts.quiet) showError(err, '服务商检索失败');
    return null;
  } finally {
    if (task) task.end();
  }
}

export async function doEngineSearch(query) {
  const s = store.get().settings;
  try {
    const out = await SEARCH.openEngineSearch(s, query);
    toast({ title: `已用 ${SEARCH.engineLabel(out.engine)} 打开结果页`, detail: '直接搜索引擎不消耗额度，也不会进入 AI 上下文。' }, 'ok', 3500);
    return out;
  } catch (err) {
    showError(err, '打开搜索引擎失败');
    return null;
  }
}

export function recountCitations(summaryText) {
  const st = store.get();
  const counts = SEARCH.countCitations(summaryText, st.search.results || []);
  store.set({ search: { ...st.search, counts } });
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

export async function exportSubtitles(overrides = {}) {
  const st = store.get();
  const lines = st.subtitles || [];
  if (!lines.length) {
    toast({ title: '还没有字幕可以导出' }, 'warn');
    return null;
  }
  const cfg = { ...st.settings.exportCfg, ...overrides };
  const video = { ...st.video, summary: st.summary, stats: st.video?.stats };
  const text = buildExport(lines, video, cfg);
  const filename = safeFilename(video, cfg);
  downloadFile(filename, text, cfg.format === 'json' ? 'application/json' : 'text/plain;charset=utf-8');
  toast({ title: `已导出 ${filename}`, detail: `格式 ${cfg.format.toUpperCase()} · 模板 ${cfg.template}` }, 'ok');
  return { filename, text };
}

export async function copyAllSubtitles(overrides = {}) {
  const st = store.get();
  const cfg = { ...st.settings.exportCfg, ...overrides };
  const text = buildExport(st.subtitles || [], { ...st.video, summary: st.summary }, { ...cfg, format: cfg.format === 'json' ? 'json' : 'txt' });
  await copyText(text);
  toast({ title: '已复制全部字幕' }, 'ok');
  return text;
}

// ---------------------------------------------------------------------------
// 历史
// ---------------------------------------------------------------------------

export async function saveHistory() {
  const st = store.get();
  if (!st.video || !st.video.bvid) return;
  const key = [st.video.bvid || '-', st.video.cid || '-', st.video.page == null ? '-' : String(st.video.page)].join('|');
  try {
    const entry = {
      title: st.video.title,
      partTitle: st.video.partTitle,
      source: st.video.source,
      subtitleMeta: st.video.subtitleMeta,
      stats: st.video.stats,
      chapters: st.video.chapters || [],
      lines: st.subtitles || []
    };
    // 关键：**当前 summary 为空时，不要用它覆盖历史里已有的总结**。
    //
    // 历史是一次「合并写」（historyPut 用 {...prev, ...entry}），
    // 而 entry.summary 之前一律写成 `st.summary || ''`。
    // 于是只要 store 里的 summary 是空的（换视频/导航时会清空），
    // 之后任何一个「保存历史」的动作（应用规则、AI 优化、生成章节…）
    // 都会把已经存好的总结**抹成空字符串**。
    // 结果就是用户报的「字幕出来了，但总结没出来」——
    // 字幕刚抓完会重新存一份，而总结早被抹掉了。
    if (st.summary) entry.summary = st.summary;
    else {
      // 本次没有总结：读一下已有的，避免写入空值
      try {
        const prev = (await call('history.get', { key }, { timeoutMs: 8000 })).row;
        if (prev && prev.summary) entry.summary = prev.summary;
      } catch (err) {
        /* 读不到就保持不写 summary 字段，让 {...prev} 生效 */
      }
    }
    await call('history.put', { video: st.video, entry });
  } catch (err) {
    /* 历史保存失败不打断主流程 */
  }
}

export async function loadHistory() {
  try {
    const out = await call('history.list', { limit: 100 });
    store.set({ history: out.rows || [] });
    renderPanels();
    return out.rows || [];
  } catch (err) {
    showError(err, '读取历史失败');
    return [];
  }
}

export async function restoreHistory(key) {
  try {
    const out = await call('history.get', { key });
    const row = out.row;
    if (!row) {
      toast({ title: '历史记录不存在' }, 'warn');
      return null;
    }
    store.set({
      video: { ...row.video, stats: row.stats, subtitleMeta: row.subtitleMeta, chapters: row.chapters || [], source: row.source },
      subtitles: row.lines || [],
      summary: row.summary || ''
    });
    toast({ title: '已从历史恢复', detail: row.video?.title || '' }, 'ok');
    renderPanels();
    return row;
  } catch (err) {
    showError(err, '恢复历史失败');
    return null;
  }
}

export async function removeHistory(key) {
  await call('history.remove', { key });
  await loadHistory();
  toast({ title: '已删除该记录' }, 'ok');
}

export async function clearHistory() {
  await call('history.clear');
  store.set({ history: [] });
  renderPanels();
  toast({ title: '历史已清空' }, 'ok');
}

// ---------------------------------------------------------------------------
// 批量队列（串行处理，支持暂停 / 移除 / 进度）
// ---------------------------------------------------------------------------

export function batchAdd(urls) {
  const list = String(urls || '')
    .split(/[\s\n,，;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const items = [...app.batch.items];
  for (const u of list) {
    items.push({ id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, url: u, status: 'queued', progress: 0, title: '' });
  }
  app.batch.items = items;
  store.set({ queue: items });
  renderPanels();
  if (!app.batch.running) runBatchQueue();
}

// ---------------------------------------------------------------------------
// 合集：解析链接 →（可选）展开成多个视频 → 入队
// ---------------------------------------------------------------------------

// 从合集/空间链接里抠出 mid 与 season_id。
// 支持的形态：
//   https://space.bilibili.com/946974/channel/collectiondetail?sid=2046621
//   https://space.bilibili.com/946974/lists/2046621?type=season
//   https://www.bilibili.com/video/BV1xx  （普通视频，交给 batchAdd 原样处理）
export function parseCollectionUrl(url) {
  const raw = String(url || '').trim();
  const mid = /space\.bilibili\.com\/(\d+)/.exec(raw);
  const sid =
    /[?&](?:sid|season_id)=(\d+)/i.exec(raw) ||
    /\/lists\/(\d+)/.exec(raw) ||
    /\/channel\/seriesdetail\?[^#]*\bsid=(\d+)/i.exec(raw);
  return {
    mid: mid ? Number(mid[1]) : 0,
    seasonId: sid ? Number(sid[1]) : 0,
    url: raw
  };
}

export function isCollectionUrl(url) {
  const s = String(url || '');
  if (!/bilibili\.com/.test(s)) return false;
  return /channel\/(collectiondetail|seriesdetail)/.test(s) || /\/lists\/\d+/.test(s);
}

// 展开链接里的合集。返回 { ok, videos, meta, reason }。
// 展开后**不直接入队** —— 交给调用方展示，让用户决定全加还是挑着加。
export async function expandCollectionsFromText(text) {
  const urls = String(text || '')
    .split(/[\s\n,，;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const collections = urls.filter(isCollectionUrl);
  // 普通视频链接保持原样，一起返回，方便「合集 + 单个视频」混着提交
  const plain = urls.filter((u) => !isCollectionUrl(u));
  if (!collections.length) {
    return { ok: true, videos: plain.map((u) => ({ url: u })), meta: { collections: 0, plain: plain.length } };
  }
  const videos = [];
  const metas = [];
  for (const c of collections) {
    const { mid, seasonId } = parseCollectionUrl(c);
    try {
      const res = await call('bili.collection', { mid, seasonId, pageUrl: c }, { timeoutMs: METHOD_TIMEOUT['bili.collection'] });
      if (res && res.ok && res.videos && res.videos.length) {
        for (const v of res.videos) videos.push({ ...v, fromCollection: true });
        metas.push({ url: c, ok: true, meta: res.meta });
      } else {
        metas.push({ url: c, ok: false, reason: (res && res.reason) || '没有解析到视频' });
      }
    } catch (err) {
      metas.push({ url: c, ok: false, reason: (err && err.payload && err.payload.detail) || (err && err.message) || '展开失败' });
    }
  }
  for (const u of plain) videos.push({ url: u });
  const failed = metas.filter((m) => !m.ok);
  return {
    ok: videos.length > 0,
    videos,
    metas,
    reason: videos.length ? '' : failed.map((f) => f.reason).join('；') || '没有解析到视频',
    meta: { collections: collections.length, plain: plain.length }
  };
}

export function batchRemove(id) {
  const item = app.batch.items.find((x) => x.id === id);
  // 运行中的条目不能只从数组里删掉：抓取仍在继续，之后还会把字幕写回面板。
  // 想中止请走 batchCancel()。
  if (item && (item.status === 'running' || item.status === 'cancelling')) {
    batchCancel(id);
    return;
  }
  app.batch.items = app.batch.items.filter((x) => x.id !== id);
  store.set({ queue: app.batch.items });
  renderPanels();
}

// 队列里每个正在处理的条目都有自己的 AbortController。
// 不能塞进 app.batch.items —— 那个对象会被 store 序列化。
const batchControllers = new Map();

export function batchCancel(id) {
  const item = app.batch.items.find((x) => x.id === id);
  if (!item) return;
  if (item.status === 'queued') {
    app.batch.items = app.batch.items.filter((x) => x.id !== id);
    syncQueue();
    renderPanels();
    return;
  }
  if (item.status === 'running') {
    item.status = 'cancelling';
    item.error = '正在取消…';
    syncQueue();
    renderPanels();
    const ctl = batchControllers.get(id);
    if (ctl) ctl.abort();
    // batch.resolve 在后台等标签页加载/注入，客户端 AbortController 管不到它；
    // 用同一个 rid 让后台把当前 RPC 也 abort 掉。
    call('cancel', { rid: `batch_${id}` }).catch(() => {});
  }
}

export function batchPause(paused) {
  app.batch.paused = paused;
  if (!paused && !app.batch.running) runBatchQueue();
  renderPanels();
}

export function batchClearDone() {
  app.batch.items = app.batch.items.filter(
    (x) => x.status !== 'done' && x.status !== 'error' && x.status !== 'cancelled'
  );
  store.set({ queue: app.batch.items });
  renderPanels();
}

async function runBatchQueue() {
  if (app.batch.running) return;
  app.batch.running = true;
  try {
    for (;;) {
      if (app.batch.paused) break;
      const item = app.batch.items.find((x) => x.status === 'queued');
      if (!item) break;
      item.status = 'running';
      syncQueue();
      const ctl = new AbortController();
      batchControllers.set(item.id, ctl);
      const task = jobs.beginTask(TASK_LABEL.batch, {
        detail: item.url.slice(0, 50),
        onCancel: () => ctl.abort()
      });
      let resolved = null;
      try {
        resolved = await call('batch.resolve', { url: item.url, rid: `batch_${item.id}` }, { timeoutMs: 90000 });
        const video = resolved.video;
        item.title = video.title || item.url;
        syncQueue();
        // 不要无脑清空 summary —— 那样会把历史里已生成的总结覆盖成空字符串
        // （用户报的「字幕出来了但总结没出来」的一个来源）。
        store.set({ video, subtitles: [], summary: '', verifyQueries: [], verifyEvidence: [], verifyFailures: [], verifyJudged: false });
        const batchKey = [video.bvid || '-', video.cid || '-', video.page == null ? '-' : String(video.page)].join('|');
        let restoredSummary = '';
        try {
          const prevRow = (await call('history.get', { key: batchKey }, { timeoutMs: 8000 })).row;
          if (prevRow && prevRow.summary) restoredSummary = prevRow.summary;
        } catch (err) {
          /* 历史读不到就继续生成 */
        }
        task.set(20, '抓取字幕');
        const s = store.get().settings;
        const result = await harvestSubtitles(video, s, {
          signal: ctl.signal,
          onProgress: (p) => task.set(20 + p.percent * 0.6, p.detail)
        });
        if (ctl.signal.aborted) {
          item.status = 'cancelled';
          item.error = '已取消';
        } else if (result.ok) {
          // 汇总结论：历史里有总结就保留，避免把已有成果清掉
          store.set({
            subtitles: result.lines,
            summary: store.get().summary || restoredSummary || '',
            video: { ...video, source: 'official', subtitleMeta: result.meta, stats: overallStats(result.lines) }
          });
          await saveHistory();
          item.status = 'done';
          item.progress = 100;
        } else {
          item.status = 'error';
          item.error = result.reason?.title || '没有可用字幕';
        }
      } catch (err) {
        if (ctl.signal.aborted || (err && err.name === 'AbortError')) {
          item.status = 'cancelled';
          item.error = '已取消';
        } else {
          const payload = errorPayload(err);
          item.status = 'error';
          item.error = payload.title;
        }
      } finally {
        // 不管成功、失败还是取消，都释放 batch.resolve 打开的标签页
        if (resolved) {
          try {
            await call('batch.release', { tabId: resolved.tabId, closeTab: resolved.openedNew });
          } catch (err) {
            /* 释放失败不影响队列 */
          }
        }
        batchControllers.delete(item.id);
        task.end();
        syncQueue();
        renderPanels();
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  } finally {
    app.batch.running = false;
    renderPanels();
  }
}

function syncQueue() {
  store.set({ queue: [...app.batch.items] });
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

export function renderPanels() {
  for (const api of Object.values(app.panels)) {
    if (api && typeof api.render === 'function') {
      try {
        api.render();
      } catch (err) {
        console.error('[字幕助手] 面板渲染异常', err);
      }
    }
  }
}

// 供 AI 面板构造系统提示词（默认值必须一字不差）
export function activePromptText() {
  const s = store.get().settings;
  const t = (s.prompt.templates || []).find((x) => x.id === s.prompt.activeId);
  return (t && t.text) || DEFAULT_SYSTEM_PROMPT;
}
