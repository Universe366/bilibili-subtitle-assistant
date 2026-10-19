// 顶部操作区：按「流程状态」决定主按钮，其余作为次要操作。
// 流程：① 读取视频 → ② 获取字幕（或语音转录）→ ③ 总结 / 对话 → ④ 导出。

import { h, clear, button, toast, fmtTime } from './dom.js';
import { store } from './store.js';
import {
  app,
  loadVideo,
  harvest as contextHarvest,
  transcribe as contextTranscribe,
  clearSubtitles,
  generateChapters as contextGenerateChapters,
  runQualityCheck as contextQualityCheck,
  optimizeWithAi,
  applyActiveRules,
  doProviderSearch,
  doEngineSearch,
  loadHistory,
  restoreHistory,
  exportSubtitles,
  copyAllSubtitles
} from './context.js';
import { call } from './bridge.js';
import { openOverlay, closeOverlays, popoverMenu } from './ui.js';
import { engineLabel } from './search.js';
import { subtitleSpan, searchCapabilityOf } from './panel-ai.js';
import * as TIMELINE from './timeline.js';

let host = null;
let searchQuery = '';
let lastSig = '';

// 操作区必须跟着状态走：订阅 store，签名变化就重画（避免漏渲染）
function signatureOf(st) {
  return [
    st.video ? st.video.signature || st.video.bvid || 'v' : '-',
    (st.subtitles || []).length,
    (st.summary || '').length > 0 ? 's' : '-',
    st.subtitleError ? 'e' : '-',
    (st.search.results || []).length,
    (st.jobs || []).length
  ].join('|');
}

export function init(container) {
  host = container;
  store.subscribe((st) => {
    const sig = signatureOf(st);
    if (sig === lastSig) return;
    lastSig = sig;
    render();
  });
  lastSig = signatureOf(store.get());
  render();
  return {
    render,
    seek,
    reload,
    transcribe: contextTranscribe,
    harvest: contextHarvest,
    // 统一的转录入口（会先关掉浮层）。字幕面板通过
    // app.panels.actions.runTranscribe() 调用它 —— 必须在这里导出，
    // 否则那边拿到 undefined，点击时报「不是函数」。
    runTranscribe,
    summarize,
    generateChapters,
    runQualityCheck,
    qualityCheck: contextQualityCheck
  };
}

// 读取 / 重新读取当前视频（空状态引导与顶部按钮共用）
export function reload() {
  return loadVideo();
}

// 面板间共享：跳到指定播放位置
export function seek(time) {
  call('page.seek', { time }, { timeoutMs: 8000 })
    .then(() => toast({ title: `已跳到 ${fmtTime(time)}` }, 'ok', 1400))
    .catch((err) => toast({ title: '跳转失败', detail: (err.payload && err.payload.detail) || String(err.message) }, 'warn'));
}

export function generateChapters() {
  return contextGenerateChapters();
}

// 「生成总结」与「快速总结」的唯一区别就是是否跳过联网校对。
// 抽成一个函数，避免以后调用方式变了只改一处。
export function summarize(skipProofread) {
  store.set({ activeTab: 'ai' });
  if (app.panels.ai && app.panels.ai.generateSummary) {
    app.panels.ai.generateSummary(skipProofread ? { skipProofread: true } : undefined);
  }
}

export function runQualityCheck() {
  return contextQualityCheck();
}

// 统一的「语音转录」入口：**先关掉可能挡着的浮层再跑**。
//
// 为什么需要：失败明细、候选轨明细、失败提示这几个浮层里都有
// 「语音转录」按钮，但以前只是直接调 transcribe ——
// 浮层不关，转录在底下跑，用户看不到进度，还以为是重复按钮。
export function runTranscribe() {
  closeOverlays();
  return contextTranscribe();
}

// 秒 → [时:分:秒]。诊断里用裸秒数（如「末句 6220.3s」）用户要在脑子里
// 换算才知道字幕覆盖到哪；直接给 [1:43:40] 一眼就能和视频时长对比。
function fmtClockFull(s) {
  const v = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(v / 3600);
  const mm = String(Math.floor((v % 3600) / 60)).padStart(2, '0');
  const ss = String(v % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function render() {
  if (!host) return;
  const st = store.get();
  clear(host);
  const hasVideo = !!st.video;
  const hasLines = (st.subtitles || []).length > 0;
  const hasSummary = !!(st.summary || '').length;

  // ---- 主按钮 + 常用操作 ----
  //
  // 用户要求：「将常用的功能按钮摆出来，不常用的放在⋯里面」。
  // 所以这里不再只留一个主按钮 —— 把高频操作直接摆出来，
  // 低频/一次性操作才收进菜单。
  if (!hasVideo) {
    host.appendChild(button('① 读取当前视频', () => reload(), { primary: true, title: '读取当前 B 站视频页面的标题、时长、分 P 与字幕轨' }));
  } else if (!hasLines) {
    // 文案从「抓取官方字幕」改为「获取字幕」：
    // 这条路径除了官方字幕轨，还会用「页面嗅探到的 AI 字幕」，
    // 说「官方」会让人以为只取官方轨（用户就被这个措辞误导过）。
    host.appendChild(button('② 获取字幕', () => contextHarvest(), { primary: true, title: '优先官方字幕轨；也接受页面已捕获的 AI 字幕。没有就改用「语音转录」' }));
    // 走 runTranscribe（统一入口，会先关掉可能挡着的浮层）
    host.appendChild(button('语音转录', () => runTranscribe(), { cls: 'btn-accent', title: '没有可用字幕时，把音轨转成文字' }));
  } else {
    const capSearch = searchCapabilityOf(st.settings || {});
    const willProofread = !!(
      st.settings &&
      st.settings.search &&
      st.settings.search.verifyOnSummary !== false &&
      capSearch.webCapable
    );
    host.appendChild(
      button(hasSummary ? '重新生成总结' : '③ 生成总结', () => summarize(false), {
        primary: true,
        title: willProofread
          ? '先联网校对字幕（术语/逻辑/时间/事实），再据此生成总结'
          : '直接用现有字幕生成总结（未开启联网校对，或检索不可用）'
      })
    );
    // 快速总结：跳过联网校对，省掉最耗时的一段。
    // 文案补全为「快速总结」—— 内部菜单与 AI 面板都叫这个名字，
    // 只写「快速」会让人不确定快速的是哪一步。
    host.appendChild(
      button('⚡ 快速总结', () => summarize(true), {
        title: '快速总结：跳过联网校对，直接用现有字幕生成（更快，但不会修正字幕错误）'
      })
    );
    // 「去提问」是字幕就绪后的高频动作，摆出来
    host.appendChild(
      button('去提问', () => {
        store.set({ activeTab: 'ai' });
        if (app.panels.ai && app.panels.ai.focusInput) app.panels.ai.focusInput();
      }, { title: '基于这期视频的字幕向 AI 提问' })
    );
    // 「导出」也走格式选择弹窗 —— 之前这里直接下载（用上次记住的设置），
    // 而菜单里那个才弹格式选择，两个入口行为不一致，用户会以为「不能选格式」。
    host.appendChild(
      button('导出', () => {
        if (app.panels.subtitles && app.panels.subtitles.exportDialog) app.panels.subtitles.exportDialog();
        else exportSubtitles();
      }, { title: '选择格式后导出（SRT / WebVTT / ASS / TXT / Markdown / JSON）' })
    );
    // 「✨ 优化字幕」与「复制」挪进「⋯」。
    //
    // 原因（实测）：操作区最多时有 7 个按钮，在 400px 宽下要占 **3 行 / 113px**，
    // 接近侧边栏可视高度的三分之一，把真正要看的字幕往下挤。
    // 这两个动作字幕面板的「⋯」里也有，属于「偶尔用一次」，
    // 收进菜单后操作区从 3 行降到 2 行。
  }

  // ---- 不常用的操作：收进「⋯」菜单 ----
  //
  // 菜单按**流程顺序**分组（获取 → 加工 → 查看），并加了文字小标题，
  // 而不是一大串平铺 —— 之前 10 项连排，用户得逐行读完才知道哪个是哪个。
  const moreItems = [
    { heading: '获取内容' },
    { icon: '🔄', label: '重新读取视频', title: '重新读取当前页面的视频信息', onClick: () => reload() },
    { icon: '📥', label: '重新获取字幕', title: '重新抓取官方字幕轨（也会接受页面已捕获的 AI 字幕）', disabled: !hasVideo, onClick: () => contextHarvest() },
    { icon: '🎙️', label: '语音转录', title: hasLines ? '重新转录（会消耗语音识别额度）' : '把音轨转成文字', onClick: () => runTranscribe() },
    { divider: true },
    { heading: '加工字幕' },
    { icon: '✨', label: '优化字幕（AI）', title: '只修正字幕文本（错别字/术语/时间/数据/逻辑），不改写内容', disabled: !hasLines, onClick: () => optimizeWithAi() },
    { icon: '🔁', label: '应用替换规则', title: '按当前替换规则组一键全部替换', disabled: !hasLines, onClick: () => applyActiveRules() },
    { icon: '📑', label: '生成章节', title: '把视频按内容切成若干段并可跳转', disabled: !hasLines, onClick: () => generateChapters() },
    { icon: '🩺', label: '质量自检', title: '检查漏段与时间异常', disabled: !hasLines, onClick: () => runQualityCheck() },
    { divider: true },
    { heading: '结果与记录' },
    { icon: '📋', label: '复制全部字幕', title: '复制纯文本字幕到剪贴板', disabled: !hasLines, onClick: () => copyAllSubtitles() },
    { icon: '🕘', label: '历史记录与回退', title: '查看本会话操作留痕（可回退）与其它视频历史', onClick: async () => showHistory(await loadHistory()) },
    {
      icon: '🗂️',
      label: '批量处理',
      title: '一次提交多个视频，串行处理',
      onClick: () => {
        store.set({ activeTab: 'settings' });
        store.setGroupOpen('batch', true);
        if (app.panels.settings) app.panels.settings.render();
      }
    },
    { divider: true },
    {
      icon: '🧽',
      label: '清空字幕',
      title: '清掉当前字幕（含校对备份、章节与统计），方便重新获取',
      disabled: !hasLines,
      onClick: () => clearSubtitles()
    }
  ];
  host.appendChild(popoverMenu(moreItems, { label: '⋯', title: '更多操作' }));

  // ---- 检索来源：只在**已经有来源**时给一个入口 ----
  //
  // 原本这里是一整行「关键词输入框 + 检索 + 直接搜索」的手动检索栏。
  // 但实际用法是「让 AI 自己联网」—— 生成总结与对话时会自动检索，
  // 手动那一行既占地方，也容易被误以为「必须自己点才会联网」。
  // 现在只留一个查看来源的入口，没有来源时整行不出现。
  const count = (st.search.results || []).length;
  if (count) {
    const srcRow = h('div', { class: 'row tight', style: { flexBasis: '100%' } });
    srcRow.appendChild(
      button(`🔗 查看 ${count} 条检索来源`, () => showSources(), {
        small: true,
        title: '查看 AI 联网时引用的页面与引用次数'
      })
    );
    const cited = st.search.counts ? Object.values(st.search.counts).reduce((a, b) => a + b, 0) : 0;
    srcRow.appendChild(h('span', { class: 'muted', text: `已被引用 ${cited} 次` }));
    host.appendChild(srcRow);
  }

  // ---- 状态胶囊 ----
  if (hasVideo) {
    const pillText = `${st.video.title || '未命名'}${st.video.partTitle ? ` · ${st.video.partTitle}` : ''}${
      st.video.duration ? ` · ${fmtTime(st.video.duration)}` : ''
    }`;
    // 文本放在**内层 span** 里：外层的 .actionbar .pill 是 flex，
    // 内层负责省略号截断。直接给胶囊加 text-overflow 不够 ——
    // 胶囊会先随内容变宽、再换行，标题照样占两行（实测踩过）。
    const titlePill = h('span', { class: 'pill', title: pillText });
    titlePill.appendChild(h('span', { text: pillText }));
    host.appendChild(titlePill);
    if (st.video.parts && st.video.parts.length > 1) {
      host.appendChild(h('span', { class: 'pill', text: `${st.video.parts.length} 个分 P（当前 P${st.video.page}）` }));
    }
    if (hasLines) {
      host.appendChild(h('span', { class: 'pill pill-brand', text: `${(st.subtitles || []).length} 行` }));
      // 字幕实际覆盖到哪 —— 直接把范围摆出来。
      //
      // 为什么值得占一个胶囊：用户曾看到总结里写着
      // 「字幕覆盖 00:00–1:43:39，之后约 14 分钟字幕未提供」而困惑 ——
      // 那其实是 AI 自己推断的（它拿视频总时长与最后一句字幕作差），
      // 我们代码里从没产生过这行字。把真实范围显示出来，
      // 用户自己就能判断到底有没有缺、缺多少，不必听 AI 的推测。
      const span = subtitleSpan(st.subtitles);
      if (span) {
        const dur = Number(st.video && st.video.duration) || 0;
        const gap = dur > 0 ? dur - span.last : 0;
        // 末尾缺口超过 60 秒才提示，避免正常收尾（片尾留白）误报
        const missing = gap > 60;
        host.appendChild(
          h('span', {
            class: `pill${missing ? ' pill-warn' : ''}`,
            title: missing
              ? `字幕最后一句在 ${fmtClockFull(span.last)}，视频总长 ${fmtClockFull(dur)}，末尾约 ${Math.round(gap / 60)} 分钟没有字幕行`
              : `字幕覆盖 ${fmtClockFull(span.first)} ~ ${fmtClockFull(span.last)}`,
            text: missing
              ? `字幕至 ${fmtClockFull(span.last)}（末尾缺约 ${Math.round(gap / 60)} 分钟）`
              : `字幕 ${fmtClockFull(span.first)}–${fmtClockFull(span.last)}`
          })
        );
      }
      const meta = st.video.subtitleMeta;
      if (meta) {
        host.appendChild(
          h('span', {
            class: 'pill',
            text: `${meta.from === 'asr' || st.video.source === 'asr' ? '语音转录' : meta.langLabel || meta.lang || '官方字幕'}${
              meta.cached ? ' · 缓存' : ''
            }`
          })
        );
      }
    } else {
      host.appendChild(h('span', { class: 'pill', text: `字幕轨 ${(st.video.subtitleTracks || []).length}` }));
    }
  } else {
    host.appendChild(h('span', { class: 'muted', text: '先在浏览器打开一个 B 站视频页面，然后点「① 读取当前视频」' }));
  }

  // ---- 失败提示（稳定性 #12：区分下载失败 / 时长不匹配，并给明细入口）----
  if (st.subtitleError) {
    const first = String(st.subtitleError.detail || '').split('\n')[0];
    const box = h('div', { class: 'row tight', style: { flexBasis: '100%', color: 'var(--danger)' } });
    box.appendChild(h('span', { text: `${st.subtitleError.title}：${first}`.slice(0, 180) }));
    box.appendChild(button('查看明细 / 诊断', () => showSubtitleDiagnostic(), { small: true, primary: true }));
    box.appendChild(button('语音转录', () => runTranscribe(), { small: true, title: '改用语音识别把音轨转成文字（会先关闭本浮层）' }));
    host.appendChild(box);
  }
}

// 字幕失败原因浮层：列出每条候选轨的判定与各来源明细
function showSubtitleDiagnostic() {
  const st = store.get();
  const body = h('div');
  if (st.subtitleError) {
    body.appendChild(h('div', { class: 'alert error' }, [h('div', { class: 'alert-title', text: st.subtitleError.title })]));
    body.appendChild(h('pre', { class: 'md-pre', text: st.subtitleError.detail || '' }));
    if (st.subtitleError.action) body.appendChild(h('div', { class: 'note', text: `下一步：${st.subtitleError.action}` }));
  }
  const attempts = st.subtitleAttempts || [];
  body.appendChild(h('div', { class: 'section-title', text: `候选字幕轨（${attempts.length}）` }));
  if (!attempts.length) body.appendChild(h('div', { class: 'note', text: '本次没有可尝试的候选轨。' }));
  for (const a of attempts) {
    body.appendChild(
      h('div', { class: 'history-row' }, [
        h('div', { class: 't', text: `${a.label}${a.isAi ? '（AI）' : ''}${a.from ? ` · 来源 ${a.from}` : ''}` }),
        h('div', {
          class: 'muted',
          text: a.error
            ? `下载失败：${a.error.title}${a.error.detail ? `（${a.error.detail}）` : ''}`
            : a.validation
              ? `${a.validation.ok ? '✅ 通过' : '❌ 拒用'}：${a.validation.title}${a.validation.detail ? ` —— ${a.validation.detail}` : ''}`
              : `未处理（${a.stage}）`
        }),
        a.validation && a.validation.stats
          ? h('div', {
              class: 'muted',
              // 用 [时:分:秒] 而不是裸秒数：用户看到的是「末句 6220.3s」，
              // 需要在脑子里换算才知道字幕到底覆盖到哪。
              text:
                `行数 ${a.validation.stats.count} · ` +
                `时间范围 ${fmtClockFull(a.validation.stats.first)} ~ ${fmtClockFull(a.validation.stats.last)}` +
                (a.validation.stats.duration
                  ? ` · 视频 ${fmtClockFull(a.validation.stats.duration)}`
                  : '')
            })
          : null
      ])
    );
  }
  const diag = st.subtitleDiagnostic;
  if (diag) {
    body.appendChild(h('div', { class: 'section-title', text: '各来源明细' }));
    body.appendChild(
      h('div', {
        class: 'kv',
        text: `页面侧 ${diag.pageTracks.length} 条 · 接口侧 ${diag.apiTracks.length} 条 · 网络嗅探 ${diag.sniffedCount || 0} 份`
      })
    );
    if (diag.pageBundle) {
      body.appendChild(h('div', { class: 'kv', text: `页面来源：${(diag.pageBundle.sources || []).join('、') || '无'}` }));
      if (diag.pageBundle.needLogin) body.appendChild(h('div', { class: 'kv', text: '页面侧提示需要登录 B 站' }));
      for (const e of diag.pageBundle.errors || []) {
        body.appendChild(h('div', { class: 'kv', text: `页面来源报错：${e.source} ${e.code == null ? e.message || '' : 'code ' + e.code}` }));
      }
    }
    if (diag.apiSources && diag.apiSources.length) body.appendChild(h('div', { class: 'kv', text: `接口有效来源：${diag.apiSources.join('、')}` }));
    if (diag.apiNeedLogin) body.appendChild(h('div', { class: 'kv', text: '接口标记 need_login_subtitle=true（需要登录）' }));
    if (diag.triggerResult) {
      body.appendChild(
        h('div', { class: 'kv', text: `播放器字幕菜单触发：${diag.triggerResult.ok ? '成功捕获' : '未捕获（' + (diag.triggerResult.reason || '未知') + '）'}` })
      );
    }
    for (const e of diag.apiErrors || []) {
      body.appendChild(h('div', { class: 'kv', text: `接口来源报错：${e.source} ${e.code == null ? e.message || '' : 'code ' + e.code}` }));
    }
  }
  openOverlay('字幕失败原因', body, [
    { label: '语音转录', primary: true, onClick: () => runTranscribe() },
    { label: '关闭', onClick: () => closeOverlays() }
  ], { width: '540px' });
}

function showSources() {
  const st = store.get();
  const body = h('div');
  body.appendChild(
    h('div', { class: 'note', text: `共 ${st.search.results.length} 条来源，按引用次数排序。服务商检索结果会作为 AI 的依据（已消耗额度）。` })
  );
  const counts = st.search.counts || {};
  const sorted = [...st.search.results].sort((a, b) => (counts[b.url] || 0) - (counts[a.url] || 0));
  for (const r of sorted) {
    body.appendChild(
      h('div', { class: 'src-row' }, [
        h('span', { class: 'cite-count', text: `×${counts[r.url] || 0}` }),
        h('a', { class: 'md-link', href: r.url, target: '_blank', rel: 'noreferrer', text: r.title || r.url }),
        h('span', { class: 'muted', text: (r.snippet || '').slice(0, 80) })
      ])
    );
  }
  openOverlay('检索来源面板', body, [{ label: '关闭', onClick: () => closeOverlays() }], { width: '520px' });
}

function showHistory(rows) {
  const body = h('div');

  // ---- 当前会话的「操作留痕」（可回退到任意一步）----
  // 用户要求「全流程留痕，可以回退」。
  // 这里与下面的跨视频历史并列：上面是本会话的步骤时间线，下面是别的视频。
  const tlTitle = h('div', { class: 'section-title', text: '本会话操作留痕（可回退）' });
  body.appendChild(tlTitle);
  const entries = TIMELINE.list();
  if (!entries.length) {
    body.appendChild(
      h('div', {
        class: 'note',
        text: '还没有留痕。抓取字幕、AI 优化、AI 校对、生成总结都会自动记一步。'
      })
    );
  } else {
    for (let i = 0; i < entries.length; i += 1) {
      const e = entries[i];
      const isCurrent = i === 0;
      body.appendChild(
        h('div', { class: 'history-row' }, [
          h('div', { class: 't', text: e.label + (isCurrent ? '（当前）' : '') }),
          h('div', {
            class: 'muted',
            text: `${new Date(e.at).toLocaleTimeString('zh-CN', { hour12: false })}${e.detail ? ` · ${e.detail}` : ''}`
          }),
          h('div', { class: 'row tight' }, [
            button(
              '回退到这一步',
              () => {
                const restored = TIMELINE.revertTo(e.id);
                if (restored) {
                  closeOverlays();
                  toast(
                    { title: `已回退到「${e.label}」`, detail: '回退本身也留了痕，可以再退回来。' },
                    'ok',
                    3500
                  );
                  render();
                  if (app.panels.subtitles) app.panels.subtitles.render();
                  if (app.panels.ai) app.panels.ai.render();
                }
              },
              { small: true, primary: !isCurrent, disabled: isCurrent }
            )
          ])
        ])
      );
    }
    body.appendChild(
      h('div', { class: 'row tight' }, [
        button(
          '清空留痕',
          () => {
            TIMELINE.clear();
            closeOverlays();
            toast({ title: '已清空操作留痕' }, 'ok');
          },
          { small: true }
        ),
        h('span', { class: 'muted', text: `最多保留 ${TIMELINE.TIMELINE_MAX} 步` })
      ])
    );
  }

  // ---- 跨视频的历史记录 ----
  body.appendChild(h('div', { class: 'section-title', text: '其它视频的历史' }));
  if (!rows.length) body.appendChild(h('div', { class: 'note', text: '还没有历史记录。抓取或转录成功后会自动保存。' }));
  for (const r of rows) {
    body.appendChild(
      h('div', { class: 'history-row' }, [
        h('div', {
          class: 't',
          text: `${(r.video && r.video.title) || '未命名'}${r.video && r.video.partTitle ? ` · ${r.video.partTitle}` : ''}`
        }),
        h('div', { class: 'muted', text: `${r.source === 'asr' ? '语音转录' : '官方字幕'} · ${r.lines ? r.lines.length : 0} 行` }),
        h('div', { class: 'row tight' }, [
          button('恢复到当前', () => {
            restoreHistory(r.key);
            closeOverlays();
          }, { small: true, primary: true })
        ])
      ])
    );
  }
  openOverlay('历史记录与操作留痕', body, [{ label: '关闭', onClick: () => closeOverlays() }], { width: '480px' });
}
