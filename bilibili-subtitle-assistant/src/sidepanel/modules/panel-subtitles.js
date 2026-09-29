// 字幕面板：搜索 + 高亮、点击跳转、复制全部 / 单行、单行统计、行内操作（默认隐藏）。
// 大列表用「虚拟滚动 + 绝对定位覆盖层」，避免上千行时卡顿。

import { h, clear, button, fmtTime, toast, copyText, escapeRegExp, debounce, setBoolAttr } from './dom.js';
import { store } from './store.js';
import { app, updateLine, exportSubtitles, copyAllSubtitles, applyCorrection, applyAllCorrections, generateChapters, runQualityCheck, transcribe } from './context.js';
import { call } from './bridge.js';
import { lineStats, overallStats, langLabel } from './subtitles.js';
import { FORMATTERS } from './exporter.js';
import { EXPORT_FORMATS, EXPORT_TEMPLATES } from '../../shared/constants.js';
import { openOverlay, closeOverlays } from './ui.js';

const OVERSCAN = 6;
const state = {
  host: null,
  scrollHost: null,
  inner: null,
  items: [],
  positions: [],
  total: 0,
  rendered: new Map(),
  lastSignature: '',
  followPaused: false,
  manualScrollAt: 0,
  editing: null
};

export function init(container) {
  const root = h('div', { class: 'pane', style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' } });
  container.appendChild(root);

  const toolbar = h('div', { class: 'pane-toolbar' });
  root.appendChild(toolbar);

  const scrollHost = h('div', { class: 'scroll-host', id: 'subtitle-scroll' });
  const inner = h('div', { class: 'subtitle-list' });
  scrollHost.appendChild(inner);
  root.appendChild(scrollHost);

  state.host = root;
  state.scrollHost = scrollHost;
  state.inner = inner;

  scrollHost.addEventListener('scroll', () => {
    if (Date.now() - state.manualScrollAt > 60) store.setScroll('subtitle', scrollHost.scrollTop);
    renderWindow();
  });
  for (const evt of ['wheel', 'touchstart', 'keydown']) {
    scrollHost.addEventListener(
      evt,
      () => {
        state.manualScrollAt = Date.now();
        if (store.get().settings?.general.autoFollow) {
          state.followPaused = true;
          renderToolbar();
        }
      },
      { passive: true }
    );
  }
  window.addEventListener(
    'resize',
    debounce(() => {
      state.measured = new Map();
      renderWindow();
    }, 150)
  );

  renderToolbar();
  render();
  // 恢复滚动位置（稳定性 #5）
  requestAnimationFrame(() => {
    scrollHost.scrollTop = store.scrollOf('subtitle', 0);
  });
  return { render, renderToolbar, scrollToLine };
}

function signatureOf(st) {
  return [
    st.subtitlesRevision || 0,
    st.subtitles ? st.subtitles.length : 0,
    st.ui.search || '',
    st.subtitleFilter || 'all',
    (st.optimize && st.optimize.corrections ? st.optimize.corrections.length : 0),
    st.video ? st.video.signature : ''
  ].join('|');
}

export function render() {
  const st = store.get();
  const sig = signatureOf(st);
  if (sig === state.lastSignature) {
    renderToolbar();
    return;
  }
  state.lastSignature = sig;
  state.editing = null;
  buildItems(st);
  renderToolbar();
  renderWindow(true);
}

function buildItems(st) {
  const lines = st.subtitles || [];
  const q = (st.ui.search || '').trim();
  state.searchQuery = q;
  state.searchRe = q ? new RegExp(escapeRegExp(q), 'gi') : null;
  state.items = lines;
  state.rendered.clear();
  state.inner.textContent = '';
  state.tmp = null;
}

// ---------------------------------------------------------------------------
// 渲染窗口
// ---------------------------------------------------------------------------

function renderWindow(force = false) {
  const host = state.scrollHost;
  if (!host) return;
  const items = state.items;
  if (!items.length) {
    if (force || !state.emptyShown) {
      state.inner.textContent = '';
      state.inner.appendChild(emptyState(store.get()));
      state.emptyShown = true;
    }
    return;
  }
  state.emptyShown = false;

  // 估算行高：编辑中或长文本行更高
  const estimate = (line) => {
    const text = String(line.text || '');
    const width = Math.max(160, host.clientWidth - 120);
    const perChar = 12.5;
    const rows = Math.max(1, Math.ceil((text.length * perChar) / width));
    return 22 * rows + 8;
  };
  const positions = [];
  let y = 0;
  for (let i = 0; i < items.length; i += 1) {
    const realH = state.measured && state.measured.get(i);
    const hh = realH || estimate(items[i]);
    positions.push({ top: y, height: hh });
    y += hh;
  }
  state.positions = positions;
  state.total = y;
  state.inner.style.height = `${y}px`;
  state.inner.style.position = 'relative';

  const top = host.scrollTop;
  const viewH = host.clientHeight || 0;
  const bottom = top + viewH;
  let first = 0;
  while (first < positions.length && positions[first].top + positions[first].height < top) first += 1;
  let last = first;
  while (last < positions.length && positions[last].top < bottom) last += 1;
  // 视口高度为 0（尚未布局 / 隐藏）时也要渲染一批，否则只会反复测量而不显示
  const from = Math.max(0, first - OVERSCAN);
  const to = Math.min(items.length, Math.max(last + OVERSCAN, Math.min(items.length, from + OVERSCAN * 2)));
  const canMeasure = viewH > 0;

  const keep = new Set();
  for (let i = from; i < to; i += 1) {
    keep.add(i);
    if (!state.rendered.has(i)) {
      const row = buildRow(items[i], i, positions[i]);
      state.inner.appendChild(row);
      state.rendered.set(i, row);
    } else {
      const row = state.rendered.get(i);
      row.style.transform = `translateY(${positions[i].top}px)`;
    }
  }
  for (const [i, row] of Array.from(state.rendered.entries())) {
    if (!keep.has(i)) {
      row.remove();
      state.rendered.delete(i);
    }
  }
  syncActive();
  // 测量真实高度（仅在真实布局可用且高度非 0 时），与估算差异较大则下一帧修正
  if (!state.measured) state.measured = new Map();
  let needRemeasure = false;
  if (canMeasure) {
    for (const [i, row] of state.rendered.entries()) {
      const real = row.offsetHeight;
      if (!real) continue;
      const est = positions[i].height;
      if (!state.measured.has(i) || Math.abs(state.measured.get(i) - real) > 2) {
        state.measured.set(i, real);
        if (Math.abs(real - est) > 12) needRemeasure = true;
      }
    }
  }
  if (needRemeasure && !state.remeasureScheduled) {
    state.remeasureScheduled = true;
    requestAnimationFrame(() => {
      state.remeasureScheduled = false;
      renderWindow();
    });
  }
}

function buildRow(line, index, pos) {
  const row = h('div', {
    class: 'subtitle-row',
    dataset: { index },
    style: { position: 'absolute', left: '0', right: '0', top: '0', transform: `translateY(${pos.top}px)` },
    tabindex: '0'
  });
  const time = h('span', {
    class: 'st-time',
    text: fmtTime(line.from),
    title: `跳到 ${fmtTime(line.from)}（点击跳转播放位置）`,
    onclick: () => jumpTo(line.from)
  });
  row.appendChild(time);

  const textEl = h('span', { class: 'st-text' });
  renderTextWithHighlight(textEl, String(line.text || ''), state.searchRe);
  row.appendChild(textEl);

  const stats = lineStats(line);
  row.appendChild(
    h('span', {
      class: 'stats',
      title: '单行统计：句数 / 字数 / 预计朗读时长 / 覆盖时长',
      text: `${stats.sentences}句 ${stats.chars}字 ~${fmtTime(stats.speakSeconds)} / ${fmtTime(stats.durationSeconds)}`
    })
  );

  const actions = h('span', { class: 'st-actions' });
  actions.appendChild(iconMini('⧉', '复制这一行', () => copyLine(line)));
  actions.appendChild(iconMini('✎', '编辑这一行', () => startEdit(row, line, index)));
  actions.appendChild(iconMini('?', '就这一行问 AI', () => askAboutLine(line)));
  actions.appendChild(iconMini('⇢', '跳到这一行', () => jumpTo(line.from)));
  row.appendChild(actions);

  row.addEventListener('dblclick', () => startEdit(row, line, index));
  if (state.editing === index) startEdit(row, line, index, true);
  return row;
}

function iconMini(label, title, onClick) {
  return h('button', {
    class: 'btn btn-sm icon-btn',
    type: 'button',
    title,
    'aria-label': title,
    text: label,
    onclick: (e) => {
      e.stopPropagation();
      onClick();
    }
  });
}

function renderTextWithHighlight(el, text, re) {
  if (!re) {
    el.textContent = text;
    return;
  }
  re.lastIndex = 0;
  let last = 0;
  let m;
  let hit = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
    const mark = document.createElement('mark');
    mark.textContent = m[0];
    el.appendChild(mark);
    last = m.index + m[0].length;
    hit += 1;
    if (m[0].length === 0) re.lastIndex += 1;
  }
  if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  if (!hit) el.textContent = text;
}

function startEdit(row, line, index, keep) {
  state.editing = index;
  const textEl = row.querySelector('.st-text');
  if (!textEl || textEl.querySelector('textarea')) return;
  const area = h('textarea', { class: 'input', style: { minHeight: '46px', width: '100%' } });
  area.value = String(line.text || '');
  const save = () => {
    const v = area.value.trim();
    updateLine(line.i, v);
    store.set({ subtitlesRevision: (store.get().subtitlesRevision || 0) + 1 });
    state.measured && state.measured.delete(index);
    state.editing = null;
    render();
    saveHistorySoon();
  };
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
    if (e.key === 'Escape') {
      state.editing = null;
      render();
    }
  });
  area.addEventListener('blur', save);
  clear(textEl);
  textEl.appendChild(area);
  area.focus();
  area.select();
}

const saveHistorySoon = debounce(() => {
  import('./context.js').then((m) => m.saveHistory());
}, 800);

export function scrollToLine(from, opts = {}) {
  const host = state.scrollHost;
  if (!host) return;
  const idx = state.items.findIndex((l) => l.from <= from && (l.to || l.from + 1) >= from);
  if (idx < 0) return;
  const pos = state.positions[idx];
  if (!pos) return;
  host.scrollTop = Math.max(0, pos.top - host.clientHeight / 3);
  if (!opts.silent) store.setScroll('subtitle', host.scrollTop);
}

function jumpTo(from) {
  call('page.seek', { time: from }, { timeoutMs: 8000 })
    .then(() => toast({ title: `已跳到 ${fmtTime(from)}` }, 'ok', 1200))
    .catch((err) => toast({ title: '跳转失败', detail: err.payload?.detail || String(err.message) }, 'warn'));
}

async function copyLine(line) {
  await copyText(line.text);
  toast({ title: '已复制这一行' }, 'ok', 1200);
}

function askAboutLine(line) {
  const st = store.get();
  store.set({
    chat: [
      ...st.chat,
      { role: 'user', text: `请解释 ${fmtTime(line.from)} 处这句话的意思：${line.text}` }
    ],
    activeTab: 'ai'
  });
  app.panels.ai && app.panels.ai.focusInput && app.panels.ai.focusInput();
  app.panels.ai && app.panels.ai.sendPending && app.panels.ai.sendPending();
}

// ---------------------------------------------------------------------------
// 当前句高亮（跟随播放）
// ---------------------------------------------------------------------------

let lastActive = -1;
export function syncActive() {
  const st = store.get();
  const t = st.follow && st.follow.paused === false ? st.follow.currentTime : null;
  const idx = t == null ? -1 : findByTime(t);
  if (idx === lastActive) return;
  lastActive = idx;
  for (const [i, row] of state.rendered.entries()) {
    setBoolAttr(row, 'data-active', i === idx);
  }
  if (idx >= 0 && !state.followPaused && st.settings?.general.autoFollow !== false) {
    scrollToActive(idx);
  }
}

function findByTime(t) {
  const lines = state.items;
  if (!lines.length) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  if (t < lines[0].from) return -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const l = lines[mid];
    if (t < l.from) hi = mid - 1;
    else if (t > (l.to || l.from + 1)) lo = mid + 1;
    else return mid;
  }
  return -1;
}

function scrollToActive(idx) {
  const host = state.scrollHost;
  const pos = state.positions[idx];
  if (!host || !pos) return;
  const top = pos.top;
  const bottom = top + pos.height;
  if (top < host.scrollTop + 10 || bottom > host.scrollTop + host.clientHeight - 10) {
    host.scrollTop = Math.max(0, top - host.clientHeight * 0.35);
    store.setScroll('subtitle', host.scrollTop);
  }
}

// ---------------------------------------------------------------------------
// 工具栏
// ---------------------------------------------------------------------------

function renderToolbar() {
  const st = store.get();
  const bar = state.host.querySelector('.pane-toolbar');
  if (!bar) return;
  clear(bar);

  const searchWrap = h('span', { class: 'row tight', style: { flex: '1 1 150px', minWidth: '120px' } });
  const input = h('input', {
    class: 'input',
    type: 'search',
    placeholder: '在字幕里搜索…',
    value: st.ui.search || '',
    oninput: debounce((e) => {
      store.setUi({ search: e.target.value });
    }, 220)
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      store.setUi({ search: '' });
    }
    if (e.key === 'Enter') {
      const hits = state.items.filter((l) => String(l.text || '').includes(input.value)).length;
      toast({ title: `命中 ${hits} 行` }, 'ok', 1600);
    }
  });
  searchWrap.appendChild(input);
  bar.appendChild(searchWrap);

  if (st.ui.search) {
    const hits = state.items.filter((l) => String(l.text || '').toLowerCase().includes(String(st.ui.search).toLowerCase())).length;
    bar.appendChild(h('span', { class: 'search-hits', text: `${hits} 命中` }));
    bar.appendChild(button('清除', () => store.setUi({ search: '' }), { small: true }));
  }

  bar.appendChild(
    button(`${st.followPaused ? '恢复' : '暂停'}跟随`, () => {
      state.followPaused = !state.followPaused;
      renderToolbar();
    }, { small: true, title: '字幕自动高亮并滚动到当前句；暂停后不再自动滚动' })
  );

  bar.appendChild(button('复制全部', () => copyAllSubtitles(), { small: true }));
  bar.appendChild(button('导出', () => exportDialog(), { small: true }));
  bar.appendChild(button('统计', () => statsDialog(), { small: true }));
  bar.appendChild(button('章节', () => generateChapters(), { small: true, disabled: !(store.get().subtitles || []).length, title: '把视频按内容切成若干段，可点击跳转' }));
  bar.appendChild(button('自检', () => runQualityCheck(), { small: true, disabled: !(store.get().subtitles || []).length, title: '检查是否漏段、时间是否异常' }));

  // 优化建议条
  const corrections = (st.optimize && st.optimize.corrections) || [];
  if (corrections.length) {
    const box = h('div', { class: 'row tight', style: { flexBasis: '100%', borderTop: '1px dotted var(--line)', paddingTop: '4px' } });
    box.appendChild(h('span', { text: `AI 修正建议 ${corrections.length} 条：` }));
    box.appendChild(button('一键全部应用', () => applyAllCorrections(), { small: true, primary: true }));
    for (let i = 0; i < Math.min(3, corrections.length); i += 1) {
      const c = corrections[i];
      box.appendChild(
        button(`${c.wrong} → ${c.right}`, () => applyCorrection(i), {
          small: true,
          title: `${c.reason || ''}（点击应用这一条）`
        })
      );
    }
    if (corrections.length > 3) box.appendChild(h('span', { class: 'muted', text: `…等共 ${corrections.length} 条` }));
    box.appendChild(button('全部忽略', () => store.set({ optimize: { ...(st.optimize || {}), corrections: [], pending: false } }), { small: true }));
    bar.appendChild(box);
  }

  // 候选轨明细 / 失败原因（稳定性 #12）
  if (st.subtitleError) {
    const first = String(st.subtitleError.detail || '').split('\n')[0];
    const box = h('div', { class: 'row tight', style: { flexBasis: '100%', color: 'var(--danger)' } });
    box.appendChild(h('span', { text: `${st.subtitleError.title}：${first}`.slice(0, 200) }));
    box.appendChild(button('查看明细 / 诊断', () => attemptsDialog(), { small: true, primary: true }));
    box.appendChild(button('语音转录', () => app.panels.actions.transcribe(), { small: true, title: '改用语音识别把音轨转成文字' }));
    bar.appendChild(box);
  }
  if (st.video && st.video.subtitleMeta) {
    const m = st.video.subtitleMeta;
    bar.appendChild(
      h('span', {
        class: 'pill pill-brand',
        text: `${m.from === 'asr' ? '语音转录' : langLabel(m.lang)}${m.cached ? ' · 缓存' : ''}`
      })
    );
  }
  if (st.video && st.video.source === 'asr') bar.appendChild(h('span', { class: 'pill', text: 'ASR' }));
}

// 空状态 = 引导清单：告诉用户「现在在哪一步、下一步点哪里」
function emptyState(st) {
  const box = h('div', { class: 'empty' });
  const hasVideo = !!st.video;
  const hasLines = (st.subtitles || []).length > 0;
  const failed = !!st.subtitleError;

  box.appendChild(
    h('div', { class: 'empty-title', text: hasVideo ? st.video.title || '当前视频' : '还没有拿到视频信息' })
  );
  if (hasVideo) {
    const bits = [];
    if (st.video.owner) bits.push(`UP：${st.video.owner}`);
    if (st.video.duration) bits.push(`时长 ${fmtTime(st.video.duration)}`);
    if (st.video.page) bits.push(`P${st.video.page}`);
    const subCount = (st.video.subtitleTracks || []).length;
    bits.push(subCount ? `字幕轨 ${subCount} 条` : '未解析到字幕轨');
    box.appendChild(h('div', { class: 'muted', text: bits.join(' · ') }));
  } else {
    box.appendChild(h('div', { class: 'muted', text: '请先在浏览器里打开一个 B 站视频页面。' }));
  }

  const steps = h('div', { class: 'steps' });
  const mk = (index, title, desc, done, onClick, disabled) => {
    const el = h('div', {
      class: 'step',
      dataset: { done: String(!!done) },
      title: disabled ? '当前不可用' : '点击执行',
      onclick: () => {
        if (!disabled) onClick();
      }
    });
    el.appendChild(h('span', { class: 'step-index', text: done ? '✓' : String(index) }));
    const body = h('div', { class: 'step-body' });
    body.appendChild(h('div', { class: 'step-title', text: title }));
    body.appendChild(h('div', { class: 'step-desc', text: desc }));
    el.appendChild(body);
    if (disabled) el.style.opacity = '0.55';
    return el;
  };

  steps.appendChild(
    mk(
      1,
      hasVideo ? '已读取当前视频' : '读取当前视频信息',
      hasVideo ? '标题 / UP / 时长 / 分 P / 字幕轨已就绪' : '点击从当前 B 站页面读取标题、时长与字幕轨列表',
      hasVideo,
      () => app.panels.actions && app.panels.actions.reload(),
      false
    )
  );
  steps.appendChild(
    mk(
      2,
      '抓取官方字幕',
      failed
        ? '上次没有通过：点这里重试（会自动尝试全部来源），或看「查看明细」'
        : '优先官方字幕，自动挑中文字幕轨并做时长校验；页面读不到时会直连 B 站接口',
      hasLines,
      () => app.panels.actions && app.panels.actions.harvest(),
      !hasVideo
    )
  );
  steps.appendChild(
    mk(
      3,
      '没有官方字幕就用语音转录',
      '把音轨切成分片做语音识别，可随时终止；完成后会自动填入字幕',
      hasLines && st.video && st.video.source === 'asr',
      () => app.panels.actions && app.panels.actions.transcribe(),
      false
    )
  );
  steps.appendChild(
    mk(
      4,
      '生成总结 / 提问 / 导出',
      '字幕就绪后：右侧「生成总结」、或直接提问、或导出 SRT / Markdown',
      !!(st.summary || '').length,
      () => {
        store.set({ activeTab: 'ai' });
        render();
      },
      !hasLines
    )
  );
  box.appendChild(steps);

  if (!hasVideo) {
    box.appendChild(
      button('读取当前视频', () => app.panels.actions && app.panels.actions.reload(), { primary: true })
    );
  } else if (!hasLines) {
    const row = h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '6px' } });
    row.appendChild(button('抓取官方字幕', () => app.panels.actions.harvest(), { primary: true }));
    row.appendChild(button('语音转录', () => app.panels.actions.transcribe(), { cls: 'btn-accent' }));
    box.appendChild(row);
    if (failed) {
      box.appendChild(
        h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '8px' } }, [
          button('查看失败明细', () => attemptsDialog(), { small: true })
        ])
      );
    }
  }
  return box;
}

// ---------------------------------------------------------------------------
// 浮层：导出 / 统计 / 候选轨
// ---------------------------------------------------------------------------

export function exportDialog() {
  const st = store.get();
  let cfg = { ...st.settings.exportCfg };
  const body = h('div');
  const preview = h('pre', { class: 'md-pre', style: { maxHeight: '200px' } });
  const updatePreview = () => {
    try {
      const text = FORMATTERS[cfg.format](st.subtitles || [], { ...st.video, summary: st.summary }, cfg);
      preview.textContent = text.slice(0, 1200) + (text.length > 1200 ? '\n…（预览截断）' : '');
    } catch (err) {
      preview.textContent = `预览失败：${err.message}`;
    }
  };

  const fmtTags = h('div', { class: 'row tight' });
  for (const f of EXPORT_FORMATS) {
    const t = h('button', {
      class: 'tag',
      type: 'button',
      text: f.label,
      dataset: { active: String(cfg.format === f.id) },
      onclick: () => {
        cfg = { ...cfg, format: f.id };
        store.set({ settings: { ...st.settings, exportCfg: cfg } });
        refreshTags();
        updatePreview();
      }
    });
    fmtTags.appendChild(t);
  }
  const tplTags = h('div', { class: 'row tight' });
  for (const t of EXPORT_TEMPLATES) {
    tplTags.appendChild(
      h('button', {
        class: 'tag',
        type: 'button',
        text: t.label,
        title: t.desc,
        dataset: { active: String(cfg.template === t.id) },
        onclick: (e) => {
          cfg = { ...cfg, template: t.id };
          store.set({ settings: { ...st.settings, exportCfg: cfg } });
          refreshTags();
          updatePreview();
        }
      })
    );
  }
  function refreshTags() {
    for (const el of fmtTags.children) el.setAttribute('data-active', String(el.textContent === (EXPORT_FORMATS.find((x) => x.id === cfg.format) || {}).label));
    for (const el of tplTags.children) {
      const found = EXPORT_TEMPLATES.find((x) => x.label === el.textContent);
      if (found) el.setAttribute('data-active', String(found.id === cfg.template));
    }
  }

  body.appendChild(h('div', { class: 'section-title', text: '导出格式（6 种）' }));
  body.appendChild(fmtTags);
  body.appendChild(h('div', { class: 'section-title', text: '字幕模板（4 种）' }));
  body.appendChild(tplTags);
  body.appendChild(
    h('label', { class: 'check' }, [
      h('input', {
        type: 'checkbox',
        checked: cfg.includeTimestamps !== false,
        onchange: (e) => {
          cfg = { ...cfg, includeTimestamps: e.target.checked };
          store.set({ settings: { ...st.settings, exportCfg: cfg } });
          updatePreview();
        }
      }),
      h('span', { text: '正文里保留时间戳' })
    ])
  );
  body.appendChild(
    h('label', { class: 'check' }, [
      h('input', {
        type: 'checkbox',
        checked: cfg.estimateTimestamps !== false,
        onchange: (e) => {
          cfg = { ...cfg, estimateTimestamps: e.target.checked };
          store.set({ settings: { ...st.settings, exportCfg: cfg } });
          updatePreview();
        }
      }),
      h('span', { text: '缺少时间戳时自动估算' })
    ])
  );
  const fontInput = h('input', {
    class: 'input',
    type: 'number',
    value: cfg.assFontSize || 42,
    style: { width: '80px' },
    oninput: (e) => {
      cfg = { ...cfg, assFontSize: Number(e.target.value) || 42 };
      store.set({ settings: { ...st.settings, exportCfg: cfg } });
      updatePreview();
    }
  });
  body.appendChild(h('div', { class: 'row tight' }, [h('span', { text: 'ASS 字号：' }), fontInput]));
  body.appendChild(h('div', { class: 'section-title', text: '预览' }));
  body.appendChild(preview);
  updatePreview();

  app.overlays.export = openOverlay('导出字幕', body, [
    { label: '复制到剪贴板', onClick: () => copyAllSubtitles(cfg) },
    { label: '导出文件', primary: true, onClick: () => { exportSubtitles(cfg); closeOverlay('export'); } }
  ]);
}

export function statsDialog() {
  const st = store.get();
  const s = overallStats(st.subtitles || []);
  const body = h('div');
  const rows = [
    ['字幕行数', String(s.lines || (st.subtitles || []).length)],
    ['总字数', String(s.chars || 0)],
    ['总句数', String(s.sentences || 0)],
    ['预计朗读时长', fmtTime(s.speakSeconds || 0)],
    ['覆盖时长', fmtTime(s.coverage || 0)],
    ['视频时长', fmtTime(st.video?.duration || 0)],
    [
      '覆盖率',
      st.video?.duration ? `${(((s.coverage || 0) / st.video.duration) * 100).toFixed(1)}%` : '-'
    ],
    ['平均每行字数', (st.subtitles || []).length ? ((s.chars || 0) / st.subtitles.length).toFixed(1) : '-']
  ];
  for (const [k, v] of rows) body.appendChild(h('div', { class: 'kv' }, [h('span', { class: 'kv-key', text: k }), h('span', { class: 'kv-val', text: v })]));
  const q = st.quality;
  if (q) {
    body.appendChild(h('div', { class: 'section-title', text: '质量自检' }));
    if (!q.issues.length) body.appendChild(h('div', { text: '未发现异常。' }));
    for (const i of q.issues) {
      body.appendChild(h('div', { class: `alert ${i.level === 'error' ? 'error' : i.level === 'warn' ? 'warn' : 'info'}`, style: { marginBottom: '4px' } }, [h('div', { text: i.text })]));
    }
  }
  app.overlays.stats = openOverlay('字幕统计', body, [{ label: '关闭', onClick: () => closeOverlay('stats') }]);
}

export function attemptsDialog() {
  const st = store.get();
  const body = h('div');
  const d = st.subtitleDiagnostic;

  if (d) {
    body.appendChild(h('div', { class: 'section-title', text: '字幕获取诊断' }));
    body.appendChild(
      h('div', { class: 'kv' }, [
        h('span', { class: 'kv-key', text: '页面侧字幕轨' }),
        h('span', { class: 'kv-val', text: `${d.pageTracks.length} 条${d.pageTracks.length ? '：' + d.pageTracks.map((t) => t.label).join('、') : ''}` })
      ])
    );
    const pd = d.pageDetail;
    if (pd) {
      body.appendChild(
        h('div', { class: 'kv' }, [
          h('span', { class: 'kv-key', text: '页面读取情况' }),
          h('span', {
            class: 'kv-val',
            text: `播放器实例：${pd.hasPlayer ? '有' : '无'}｜页面状态：${pd.hasInitialState ? '有' : '无'}｜已尝试字段：${
              (pd.tried || []).join('、') || '无'
            }`
          })
        ])
      );
    }
    body.appendChild(
      h('div', { class: 'kv' }, [
        h('span', { class: 'kv-key', text: '接口侧字幕轨' }),
        h('span', {
          class: 'kv-val',
          text: `${d.apiTracks.length} 条${d.apiTracks.length ? '：' + d.apiTracks.map((t) => t.label).join('、') : ''}${
            d.apiCode == null ? '' : `｜接口 code=${d.apiCode}${d.apiMessage ? ` ${d.apiMessage}` : ''}`
          }${d.apiIsLogin === false ? '（未登录）' : ''}${d.apiError ? `｜接口错误：${d.apiError.title}` : ''}`
        })
      ])
    );
    body.appendChild(h('div', { class: 'note', text: '若「页面侧 0 条 + 接口侧 0 条」，说明这个视频确实没有字幕，请用「语音转录」。' }));
  }

  body.appendChild(h('div', { class: 'section-title', text: '候选轨明细' }));
  if (!st.subtitleAttempts || !st.subtitleAttempts.length) {
    body.appendChild(h('div', { text: '没有候选轨记录。' }));
  } else {
    body.appendChild(h('div', { class: 'note', text: '每条候选字幕轨的判定结果（下载失败 / 时长不匹配 / 覆盖度过低 / 通过）：' }));
    for (const a of st.subtitleAttempts) {
      const line = h('div', { class: 'history-row' });
      line.appendChild(h('div', { class: 't', text: `${a.label}${a.isAi ? '（AI）' : ''}${a.from === 'api' ? '（来自接口）' : ''}` }));
      if (a.cached) line.appendChild(h('div', { class: 'muted', text: '来源：本地缓存' }));
      if (a.error) line.appendChild(h('div', { class: 'muted', text: `下载失败：${a.error.title} ${a.error.detail || ''}` }));
      if (a.validation) {
        line.appendChild(
          h('div', {
            class: 'muted',
            text: `${a.validation.ok ? '✅ 通过' : '❌ 拒用'}：${a.validation.title} ${a.validation.detail || ''}`
          })
        );
        if (a.validation.stats) {
          line.appendChild(
            h('div', {
              class: 'muted',
              text: `行数 ${a.validation.stats.count} · 首句 ${a.validation.stats.first?.toFixed?.(1)}s · 末句 ${a.validation.stats.last?.toFixed?.(1)}s · 覆盖 ${a.validation.stats.coverage?.toFixed?.(1)}s`
            })
          );
        }
      }
      body.appendChild(line);
    }
  }
  app.overlays.attempts = openOverlay('字幕候选轨明细', body, [{ label: '关闭', onClick: () => closeOverlays() }]);
}

