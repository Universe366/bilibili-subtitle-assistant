// 顶部操作区：按「流程状态」决定主按钮，其余作为次要操作。
// 流程：① 读取视频 → ② 抓取官方字幕（或语音转录）→ ③ 总结 / 对话 → ④ 导出。

import { h, clear, button, toast, fmtTime } from './dom.js';
import { store } from './store.js';
import {
  app,
  loadVideo,
  harvest as contextHarvest,
  transcribe as contextTranscribe,
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
import { openOverlay, closeOverlays } from './ui.js';
import { engineLabel } from './search.js';

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

export function runQualityCheck() {
  return contextQualityCheck();
}

export function render() {
  if (!host) return;
  const st = store.get();
  clear(host);
  const hasVideo = !!st.video;
  const hasLines = (st.subtitles || []).length > 0;
  const hasSummary = !!(st.summary || '').length;

  // ---- 主按钮：永远只有一个「下一步该点的按钮」----
  if (!hasVideo) {
    host.appendChild(button('① 读取当前视频', () => reload(), { primary: true, title: '读取当前 B 站视频页面的标题、时长、分 P 与字幕轨' }));
  } else if (!hasLines) {
    host.appendChild(button('② 抓取官方字幕', () => contextHarvest(), { primary: true, title: '优先官方字幕；页面读不到时会自动直连 B 站接口再试一次' }));
    host.appendChild(button('语音转录', () => contextTranscribe(), { cls: 'btn-accent', title: '没有官方字幕时，把音轨转成文字' }));
  } else {
    host.appendChild(
      button(hasSummary ? '重新生成总结' : '③ 生成总结', () => {
        store.set({ activeTab: 'ai' });
        if (app.panels.ai && app.panels.ai.generateSummary) app.panels.ai.generateSummary();
      }, { primary: true, title: '基于当前字幕生成总结（流式 + Markdown 渲染）' })
    );
    host.appendChild(
      button('去提问', () => {
        store.set({ activeTab: 'ai' });
        if (app.panels.ai && app.panels.ai.focusInput) app.panels.ai.focusInput();
      }, { title: '基于这期视频的字幕向 AI 提问' })
    );
    host.appendChild(button('④ 导出', () => exportSubtitles(), { title: 'SRT / WebVTT / ASS / TXT / Markdown / JSON' }));
  }

  // ---- 次要操作 ----
  host.appendChild(button('读取视频', () => reload(), { small: true, title: '重新读取当前页面的视频信息' }));
  host.appendChild(button('抓取字幕', () => contextHarvest(), { small: true, disabled: !hasVideo, title: '重新抓取官方字幕' }));
  host.appendChild(button('语音转录', () => contextTranscribe(), { small: true, title: hasLines ? '重新转录（会消耗语音识别额度）' : '把音轨转成文字' }));
  host.appendChild(button('AI 优化', () => optimizeWithAi(), { small: true, disabled: !hasLines, title: '用 AI 修正错别字 / 同音字 / 专有名词' }));
  host.appendChild(button('全部替换', () => applyActiveRules(), { small: true, disabled: !hasLines, title: '一键自动全部进行：直接应用当前替换规则组' }));
  host.appendChild(button('章节', () => generateChapters(), { small: true, disabled: !hasLines, title: '把视频按内容切成若干段并可跳转' }));
  host.appendChild(button('自检', () => runQualityCheck(), { small: true, disabled: !hasLines, title: '检查漏段与时间异常' }));

  host.appendChild(h('span', { class: 'spacer' }));

  host.appendChild(button('复制全部', () => copyAllSubtitles(), { small: true, disabled: !hasLines, title: '复制纯文本字幕' }));
  host.appendChild(button('历史', async () => showHistory(await loadHistory()), { small: true, title: '处理过的视频与结果' }));
  host.appendChild(
    button('批量', () => {
      store.set({ activeTab: 'settings' });
      store.setGroupOpen('batch', true);
      if (app.panels.settings) app.panels.settings.render();
    }, { small: true, title: '一次提交多个视频，串行处理' })
  );

  // ---- 检索行（字幕就绪后即可见，且一直可见）----
  const searchRow = h('div', { class: 'row tight', style: { flexBasis: '100%' } });
  const input = h('input', {
    class: 'input',
    placeholder: '检索关键词（默认用视频标题）…',
    value: searchQuery || (st.video && st.video.title) || '',
    style: { flex: '1 1 150px' },
    oninput: (e) => {
      searchQuery = e.target.value;
    }
  });
  searchRow.appendChild(input);
  searchRow.appendChild(
    button('服务商检索', () => {
      const q = (searchQuery || (st.video && st.video.title) || '').trim();
      if (!q) {
        toast({ title: '请输入检索关键词' }, 'warn');
        return;
      }
      doProviderSearch(q);
    }, { small: true, primary: true, title: '走检索 API，结果会作为 AI 的依据（消耗额度）' })
  );
  searchRow.appendChild(
    button(`直接搜索（${engineLabel((st.settings && st.settings.search.engine) || 'bing')}）`, () => {
      const q = (searchQuery || (st.video && st.video.title) || '').trim();
      if (!q) {
        toast({ title: '请输入检索关键词' }, 'warn');
        return;
      }
      doEngineSearch(q);
    }, { small: true, title: '只打开搜索引擎结果页，不消耗额度，也不进入 AI 上下文' })
  );
  const count = (st.search.results || []).length;
  if (count) {
    searchRow.appendChild(button(`来源（${count}）`, () => showSources(), { small: true, title: '查看检索到的页面、数量与引用次数' }));
    searchRow.appendChild(
      h('span', {
        class: 'muted',
        text: `引用合计 ${st.search.counts ? Object.values(st.search.counts).reduce((a, b) => a + b, 0) : 0} 次`
      })
    );
  }
  host.appendChild(searchRow);

  // ---- 状态胶囊 ----
  if (hasVideo) {
    host.appendChild(
      h('span', {
        class: 'pill',
        text: `${st.video.title || '未命名'}${st.video.partTitle ? ` · ${st.video.partTitle}` : ''}${
          st.video.duration ? ` · ${fmtTime(st.video.duration)}` : ''
        }`
      })
    );
    if (st.video.parts && st.video.parts.length > 1) {
      host.appendChild(h('span', { class: 'pill', text: `${st.video.parts.length} 个分 P（当前 P${st.video.page}）` }));
    }
    if (hasLines) {
      host.appendChild(h('span', { class: 'pill pill-brand', text: `${(st.subtitles || []).length} 行` }));
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
    box.appendChild(button('语音转录', () => contextTranscribe(), { small: true, title: '改用语音识别把音轨转成文字' }));
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
              text: `行数 ${a.validation.stats.count} · 末句 ${Number(a.validation.stats.last || 0).toFixed(1)}s · 覆盖 ${Number(a.validation.stats.coverage || 0).toFixed(1)}s`
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
    { label: '语音转录', primary: true, onClick: () => { closeOverlays(); contextTranscribe(); } },
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
  openOverlay('历史记录', body, [{ label: '关闭', onClick: () => closeOverlays() }], { width: '480px' });
}
