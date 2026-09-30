// 设置面板：全部配置都在侧边栏内完成（不另开设置标签页）。
// 要点：官网/申请 Key 链接、测试连接、探测模型（可点击标签）、自定义地址申请域名权限、
//       密钥掩码 + 留空不改动、显式保存按钮、构建指纹、诊断可复制、
//       展开状态与滚动位置在重建后恢复（稳定性 #5）。

import {
  h,
  clear,
  button,
  collapsible,
  field,
  textInput,
  numberInput,
  select,
  checkbox,
  toast,
  fmtBytes,
  fmtRelative,
  copyText
} from './dom.js';
import { store, loadSettings, saveSettings } from './store.js';
import { call } from './bridge.js';
import { app, showError, loadHistory, restoreHistory, removeHistory, clearHistory, persistSettings, doProviderSearch, doEngineSearch } from './context.js';
import { openOverlay, closeOverlays, confirmDialog, promptDialog } from './ui.js';
import { SEARCH_ENGINES, EXPORT_FORMATS, EXPORT_TEMPLATES, DEFAULT_SYSTEM_PROMPT } from '../../shared/constants.js';
import { exportRuleGroups, parseRuleGroups } from './optimize.js';
import { downloadFile } from './dom.js';
import { batchAdd, batchRemove, batchPause, batchClearDone } from './context.js';
import * as SKILLS from '../../shared/skills.js';
import { TIME_PRESETS, normalizeTimeRange } from '../../shared/time-range.js';

const state = { host: null, scrollHost: null, dirty: false, draft: null, modelCache: {} };

// 面板侧也需要知道「另一个站点」的地址，用于一键切换接口地址。
// 与后台 providers.js 的 alternateHosts 保持同样的白名单。
const DUAL_TLD_HOSTS = [/^api\.siliconflow\.(cn|com)$/i];

function hostOf(url) {
  try {
    return new URL(String(url || '')).hostname;
  } catch (err) {
    return '';
  }
}

function alternateHostsForUi(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) return [];
  try {
    const u = new URL(raw);
    if (!DUAL_TLD_HOSTS.some((re) => re.test(u.hostname))) return [];
    const alt = /\.cn$/i.test(u.hostname) ? u.hostname.replace(/\.cn$/i, '.com') : u.hostname.replace(/\.com$/i, '.cn');
    return [{ host: alt, url: `${u.protocol}//${alt}${u.pathname.replace(/\/+$/, '')}` }];
  } catch (err) {
    return [];
  }
}

export function init(container) {
  const root = h('div', { class: 'pane', style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' } });
  const toolbar = h('div', { class: 'pane-toolbar' });
  const scrollHost = h('div', { class: 'scroll-host', id: 'settings-scroll' });
  const body = h('div', { id: 'settings-body' });
  scrollHost.appendChild(body);
  root.appendChild(toolbar);
  root.appendChild(scrollHost);
  container.appendChild(root);
  state.host = root;
  state.scrollHost = scrollHost;
  state.body = body;

  scrollHost.addEventListener('scroll', () => store.setScroll('settings', scrollHost.scrollTop));
  render();
  requestAnimationFrame(() => {
    scrollHost.scrollTop = store.scrollOf('settings', 0);
  });
  return { render };
}

function draft() {
  const st = store.get();
  if (!state.draft) state.draft = structuredCloneSafe(st.settings);
  return state.draft;
}

function structuredCloneSafe(o) {
  try {
    return JSON.parse(JSON.stringify(o));
  } catch (err) {
    return o;
  }
}

function markDirty() {
  state.dirty = true;
  renderToolbar();
}

export function render() {
  const st = store.get();
  if (!state.body || !st.settings) return;
  renderToolbar();
  const scroll = state.scrollHost ? state.scrollHost.scrollTop : 0;
  clear(state.body);
  const d = draft();

  // ---- 常驻提示：为什么现在不能用（第七章）----
  const issues = (st.readiness && st.readiness.issues) || [];
  if (issues.length) {
    const box = h('div', { class: 'group' });
    const inner = h('div', { class: 'group-body', style: { background: 'var(--warn-soft)' } });
    inner.appendChild(h('div', { class: 'section-title', text: '配置状态' }));
    for (const i of issues) {
      inner.appendChild(h('div', { class: `alert ${i.level === 'error' ? 'error' : i.level === 'warn' ? 'warn' : 'info'}`, style: { marginBottom: '4px' } }, [h('div', { text: i.text })]));
    }
    box.appendChild(inner);
    state.body.appendChild(box);
  }

  state.body.appendChild(generalGroup(d));
  state.body.appendChild(aiGroup(d));
  state.body.appendChild(asrGroup(d));
  state.body.appendChild(promptGroup(d));
  state.body.appendChild(rulesGroup(d));
  state.body.appendChild(glossaryGroup(d));
  state.body.appendChild(searchGroup(d));
  state.body.appendChild(mcpGroup(d));
  state.body.appendChild(skillsGroup(d));
  state.body.appendChild(exportGroup(d));
  state.body.appendChild(batchGroup(d));
  state.body.appendChild(historyGroup(d));
  state.body.appendChild(pageGroup(d));
  state.body.appendChild(advancedGroup(d));

  requestAnimationFrame(() => {
    if (state.scrollHost && Math.abs(state.scrollHost.scrollTop - scroll) > 4) {
      state.scrollHost.scrollTop = scroll;
    }
  });
}

function renderToolbar() {
  const bar = state.host.querySelector('.pane-toolbar');
  if (!bar) return;
  clear(bar);
  bar.appendChild(
    button(state.dirty ? '保存设置 *' : '保存设置', () => save(), { small: true, primary: true, title: '显式保存（自动保存之外的明确确认）' })
  );
  bar.appendChild(button('放弃改动', () => reload(), { small: true, disabled: !state.dirty }));
  bar.appendChild(button('重置为默认', () => resetAll(), { small: true, danger: true }));
  bar.appendChild(button('诊断', () => diagnosticsDialog(), { small: true }));
  bar.appendChild(button('首次向导', () => app.panels.wizard && app.panels.wizard.open(), { small: true, title: '重新打开首次使用向导（随时可跳过）' }));
  bar.appendChild(h('span', { class: 'spacer' }));
  bar.appendChild(h('span', { class: 'muted', text: state.dirty ? '有未保存的改动' : '已保存' }));
}

// ---------------------------------------------------------------------------
// 分组
// ---------------------------------------------------------------------------

function groupWrap(key, title, openDefault, bodyFn) {
  const g = collapsible(title, openDefault, bodyFn, {
    stateKey: key,
    isOpen: (k, def) => store.groupOpen(k, def),
    onToggle: (k, open) => store.setGroupOpen(k, open)
  });
  return g;
}

// ---------------------------------------------------------------------------
// MCP 服务（给模型装上「手和脚」）
// ---------------------------------------------------------------------------

function mcpGroup(d) {
  return groupWrap('mcp', 'MCP 服务（给模型装上工具）', false, (body) => {
    d.mcp = d.mcp || { enabled: false, servers: [], callTimeoutMs: 60000, maxToolRounds: 6 };
    d.mcp.servers = d.mcp.servers || [];
    body.appendChild(
      checkbox(d.mcp.enabled, (v) => { d.mcp.enabled = v; markDirty(); }, '启用 MCP（对话时把工具交给模型，模型可自行调用）')
    );
    body.appendChild(
      h('div', {
        class: 'note',
        text:
          'MCP = Model Context Protocol。浏览器扩展无法启动本地进程，因此只支持远程传输：\n' +
          '· http —— 直接 POST JSON-RPC 的 MCP 端点\n' +
          '· sse  —— 先建立事件流、再按服务端给出的 endpoint 发请求\n' +
          '（不支持 stdio。）'
      })
    );

    const list = h('div', { class: 'platform-list' });
    d.mcp.servers.forEach((sv, i) => {
      const card = h('div', { class: 'platform-card' });
      const head = h('div', { class: 'platform-head' });
      head.appendChild(h('span', { class: 'platform-name', text: sv.name || `服务 ${i + 1}` }));
      head.appendChild(h('span', { class: 'spacer' }));
      head.appendChild(
        button('测试连接', async () => {
          try {
            const out = await call('mcp.probe', { server: sv }, { timeoutMs: 60000 });
            const names = (out.tools || []).map((t) => t.name).join('、') || '（该服务没有暴露工具）';
            toast({ title: `连接成功：${(out.tools || []).length} 个工具`, detail: `${out.serverInfo ? out.serverInfo.name || '' : ''} ${names}` }, 'ok', 6000);
          } catch (err) {
            showError(err, 'MCP 连接失败');
          }
        }, { small: true, primary: true })
      );
      head.appendChild(
        button('删除', () => {
          d.mcp.servers.splice(i, 1);
          markDirty();
          render();
        }, { small: true, danger: true })
      );
      card.appendChild(head);
      const cb = h('div', { class: 'platform-body' });
      cb.appendChild(
        field('名称', textInput(sv.name || '', (v) => { sv.name = v; markDirty(); }, { placeholder: '例如 高德地图' }))
      );
      cb.appendChild(
        field('传输方式', select(sv.transport || 'http', [
          { value: 'http', label: 'HTTP（POST JSON-RPC）' },
          { value: 'sse', label: 'SSE（事件流）' }
        ], (v) => { sv.transport = v; markDirty(); }))
      );
      cb.appendChild(
        field('服务地址', textInput(sv.url || '', (v) => { sv.url = v; markDirty(); }, { placeholder: 'https://example.com/mcp' }))
      );
      cb.appendChild(
        field('鉴权 Token（可选）', textInput(sv.token || '', (v) => { sv.token = v; markDirty(); }, { placeholder: '留空则不发送 Authorization', password: true }))
      );
      cb.appendChild(
        checkbox(sv.enabled !== false, (v) => { sv.enabled = v; markDirty(); }, '启用该服务')
      );
      card.appendChild(cb);
      list.appendChild(card);
    });
    body.appendChild(field('服务列表', list));
    body.appendChild(
      button('添加 MCP 服务', () => {
        d.mcp.servers.push({
          id: `mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          name: '',
          transport: 'http',
          url: '',
          token: '',
          enabled: true,
          headers: {}
        });
        markDirty();
        render();
      }, { small: true })
    );
    body.appendChild(
      field('单次工具调用超时（秒）', numberInput(Math.round((d.mcp.callTimeoutMs || 60000) / 1000), (v) => {
        d.mcp.callTimeoutMs = Math.max(5, Math.min(300, v)) * 1000;
        markDirty();
      }, { min: 5, max: 300 }))
    );
    body.appendChild(
      field('最多工具轮数', numberInput(d.mcp.maxToolRounds || 6, (v) => {
        d.mcp.maxToolRounds = Math.max(1, Math.min(12, v));
        markDirty();
      }, { min: 1, max: 12 }))
    );
    body.appendChild(
      h('div', { class: 'note', text: '并非所有平台都支持函数调用。若模型不返回工具调用，MCP 会静默不生效（不会影响普通对话）。' })
    );
  });
}

// ---------------------------------------------------------------------------
// Skills（可复用的提示词 / 工作流）
// ---------------------------------------------------------------------------

function skillsGroup(d) {
  return groupWrap('skills', 'Skills（可复用的提问模板）', false, (body) => {
    d.skills = d.skills || { enabled: true, items: [] };
    d.skills.items = d.skills.items || [];
    body.appendChild(
      checkbox(d.skills.enabled, (v) => { d.skills.enabled = v; markDirty(); }, '启用 Skills（对话区出现 ✨ 图标）')
    );
    const list = h('div', { class: 'platform-list' });
    d.skills.items.forEach((sk, i) => {
      const card = h('div', { class: 'platform-card' });
      const head = h('div', { class: 'platform-head' });
      head.appendChild(h('span', { class: 'platform-name', text: `${sk.icon || '✨'} ${sk.name || '未命名'}` }));
      head.appendChild(h('span', { class: 'spacer' }));
      if (sk.source === 'builtin') head.appendChild(h('span', { class: 'muted', text: '内置' }));
      head.appendChild(
        button('删除', () => {
          d.skills.items.splice(i, 1);
          markDirty();
          render();
        }, { small: true, danger: true })
      );
      card.appendChild(head);
      const cb = h('div', { class: 'platform-body' });
      cb.appendChild(field('图标', textInput(sk.icon || '', (v) => { sk.icon = v; markDirty(); }, { placeholder: '✨' })));
      cb.appendChild(field('名称', textInput(sk.name || '', (v) => { sk.name = v; markDirty(); })));
      cb.appendChild(field('说明', textInput(sk.desc || '', (v) => { sk.desc = v; markDirty(); }, { placeholder: '一句话说明用途' })));
      const ta = h('textarea', {
        class: 'input',
        style: { minHeight: '80px', width: '100%' },
        value: sk.body || '',
        placeholder: '技能正文：会作为指令追加到你的提问里',
        oninput: (e) => { sk.body = e.target.value; markDirty(); }
      });
      cb.appendChild(field('技能正文', ta));
      card.appendChild(cb);
      list.appendChild(card);
    });
    body.appendChild(field('技能列表', list));
    body.appendChild(
      button('添加技能', () => {
        d.skills.items.push({
          id: `skill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          icon: '✨',
          name: '',
          desc: '',
          body: '',
          source: 'user'
        });
        markDirty();
        render();
      }, { small: true })
    );
    body.appendChild(h('div', { class: 'note', text: '对话区点 ✨ 选择技能，会把技能正文与你的提问一起发给 AI。' }));

    // ---- 导入 SKILL.md（Cherry Studio / Anthropic Skills 约定）----
    const fileInput = h('input', { type: 'file', accept: '.md,.markdown,text/markdown', multiple: true, style: { display: 'none' } });
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = '';
      if (!files.length) return;
      let added = 0;
      const blocked = [];
      for (const f of files) {
        try {
          const text = await f.text();
          const sk = SKILLS.skillFromMarkdown(text, { folderName: f.name.replace(/\.md$/i, ''), icon: '📄' });
          d.skills.items.push(sk);
          added += 1;
          if (sk.execDeps) blocked.push(`${sk.name}（用到：${sk.execDeps.join('、')}）`);
        } catch (err) {
          toast({ title: `导入失败：${f.name}`, detail: (err && err.message) || '' }, 'warn', 4000);
        }
      }
      if (added) {
        markDirty();
        render();
        toast(
          {
            title: `已导入 ${added} 个技能`,
            detail: blocked.length
              ? `以下技能声明了本地执行依赖，浏览器扩展无法运行，只会作为指令使用：${blocked.join('；')}`
              : '技能正文会作为指令交给模型'
          },
          blocked.length ? 'warn' : 'ok',
          blocked.length ? 8000 : 3000
        );
      }
    });
    body.appendChild(fileInput);
    body.appendChild(
      button('导入 SKILL.md', () => fileInput.click(), { small: true })
    );
    body.appendChild(
      h('div', {
        class: 'note',
        text:
          '兼容 Cherry Studio / Anthropic 的 SKILL.md 格式（YAML frontmatter + Markdown 正文）：\n' +
          'name / description 会成为技能名称与说明，正文作为指令。\n' +
          '⚠ 浏览器扩展无法执行技能里的 shell / python 脚本，这类技能只会当提示词用。'
      })
    );
  });
}

function generalGroup(d) {
  return groupWrap('general', '通用（主题 / 字号 / 布局）', true, (body) => {
    body.appendChild(
      field(
        '主题',
        select(d.general.theme, [
          { value: 'system', label: '跟随系统' },
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' }
        ], (v) => {
          d.general.theme = v;
          markDirty();
        })
      )
    );
    const fontRow = h('div', { class: 'row tight' });
    fontRow.appendChild(
      h('input', {
        class: 'input',
        type: 'range',
        min: '0.8',
        max: '1.6',
        step: '0.05',
        value: String(d.general.fontScale),
        style: { flex: '1 1 auto' },
        oninput: (e) => {
          d.general.fontScale = Number(e.target.value);
          document.documentElement.style.setProperty('--fs', `${(13 * d.general.fontScale).toFixed(1)}px`);
        },
        onchange: markDirty
      })
    );
    fontRow.appendChild(h('span', { class: 'mono', text: `${Math.round(d.general.fontScale * 100)}%` }));
    body.appendChild(field('字号缩放', fontRow));
    body.appendChild(
      field(
        '布局',
        select(d.general.layout, [
          { value: 'one', label: '单列堆叠（默认，推荐窄侧边栏）' },
          { value: 'two', label: '双列（左字幕 / 右总结·AI）' },
          { value: 'auto', label: '自动（宽度 <420px 才单列）' }
        ], (v) => {
          d.general.layout = v;
          markDirty();
        })
      )
    );
    body.appendChild(checkbox(d.general.autoFollow, (v) => { d.general.autoFollow = v; markDirty(); }, '字幕自动高亮并滚动到当前句（跟随播放）'));
    body.appendChild(checkbox(d.diagnostics.verbose, (v) => { d.diagnostics.verbose = v; markDirty(); }, '输出详细日志（排查问题时开启）'));
  });
}


function aiGroup(d) {
  return groupWrap('ai', 'AI 平台（默认 DeepSeek）', true, (body) => {
    body.appendChild(
      h('div', { class: 'note', text: '所有 AI 平台都是同一套 OpenAI 兼容配置：接口地址 + 模型 + API Key。用下拉框选平台，只显示当前这一家的配置，不用来回翻。' })
    );
    body.appendChild(platformPicker('ai', d));
    body.appendChild(
      field('温度（0~2）', numberInput(d.ai.temperature, (v) => { d.ai.temperature = Math.max(0, Math.min(2, v)); markDirty(); }, { min: 0, max: 2, step: 0.1 }))
    );
    body.appendChild(field('最大输出 token', numberInput(d.ai.maxTokens, (v) => { d.ai.maxTokens = v; markDirty(); }, { min: 256, max: 32000, step: 256 })));
  });
}

function asrGroup(d) {
  return groupWrap('asr', '语音识别平台（默认 硅基流动）', true, (body) => {
    body.appendChild(
      h('div', { class: 'note', text: '语音识别平台统一走 OpenAI 兼容的 /audio/transcriptions：接口地址 + 模型 + Key，请求方式（base64 JSON / multipart）与文件字段名因平台而异。' })
    );
    body.appendChild(platformPicker('asr', d));
    const grid = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } });
    grid.appendChild(field('并发切片数', numberInput(d.asr.concurrency, (v) => { d.asr.concurrency = Math.max(1, Math.min(8, v)); markDirty(); }, { min: 1, max: 8 })));
    grid.appendChild(field('单片超时（秒）', numberInput(d.asr.timeoutSeconds, (v) => { d.asr.timeoutSeconds = Math.max(30, v); markDirty(); }, { min: 30, max: 1800, step: 30 })));
    grid.appendChild(field('平台单文件上限（MB）', numberInput(d.asr.sizeLimitMB, (v) => { d.asr.sizeLimitMB = Math.max(1, v); markDirty(); }, { min: 1, max: 1024 })));
    grid.appendChild(field('切片时长（秒）', numberInput(d.asr.sliceSeconds, (v) => { d.asr.sliceSeconds = Math.max(45, Math.min(600, v)); markDirty(); }, { min: 45, max: 600, step: 15 })));
    grid.appendChild(field('切片重叠（秒）', numberInput(d.asr.overlapSeconds, (v) => { d.asr.overlapSeconds = Math.max(0, Math.min(30, v)); markDirty(); }, { min: 0, max: 30, step: 0.5 })));
    body.appendChild(grid);
    body.appendChild(checkbox(d.asr.autoOptimizeAfter, (v) => { d.asr.autoOptimizeAfter = v; markDirty(); }, '转录完成后自动做 AI 优化（默认关闭，会消耗额度）'));
    body.appendChild(checkbox(d.asr.autoApplyAfter, (v) => { d.asr.autoApplyAfter = v; markDirty(); }, '转录完成后自动替换（默认关闭）'));
    body.appendChild(h('div', { class: 'note', text: '说明：分片时长会按「平台单文件上限」自动收缩；若某片仍超限，会按 0.7 系数重切，最多 3 次。终止后不会再继续消耗额度。' }));
  });
}

// ---------------------------------------------------------------------------
// 平台选择：下拉框 + 只显示当前平台的配置
// ---------------------------------------------------------------------------

const PLATFORM_META = {
  ai: {
    listKey: 'ai',
    label: 'AI 平台',
    newIdPrefix: 'custom_ai_',
    newName: '新 AI 平台',
    template: { homepage: '', keyUrl: '', baseUrl: 'https://', model: '', apiKey: '', models: [] }
  },
  asr: {
    listKey: 'asr',
    label: '语音识别平台',
    newIdPrefix: 'custom_asr_',
    newName: '新语音平台',
    template: { homepage: '', keyUrl: '', baseUrl: 'https://', model: '', transport: 'multipart', keyField: 'file', apiKey: '', models: [] }
  },
  search: {
    listKey: 'search',
    label: '检索服务商',
    newIdPrefix: 'search_',
    newName: '新检索服务商',
    template: { homepage: '', keyUrl: '', baseUrl: 'https://', apiKey: '', kind: 'tavily', models: [] }
  }
};

function platformPicker(kind, d) {
  const meta = PLATFORM_META[kind];
  const list = d[meta.listKey].platforms || [];
  const wrap = h('div');

  // 当前编辑哪个：优先用户在这个分组里选过的，否则用「使用中」的平台
  const editKey = `editPlatform_${kind}`;
  let editingId = store.get().ui[editKey];
  if (!editingId || !list.some((p) => p.id === editingId)) {
    editingId = d[meta.listKey].activeId || (list[0] && list[0].id);
  }
  const current = list.find((p) => p.id === editingId) || list[0] || null;

  const options = list.map((p) => ({
    value: p.id,
    label: `${p.name || p.id}${p.id === d[meta.listKey].activeId ? '（使用中）' : ''}${p.apiKeySet || p.apiKey ? '' : ' · 未配 Key'}`
  }));

  const isCustomNew = editingId && String(editingId).startsWith(meta.newIdPrefix);
  if (isCustomNew) options.push({ value: editingId, label: `${meta.newName}（新）` });
  options.push({ value: '__add__', label: '➕ 添加自定义平台…' });

  const row = h('div', { class: 'row tight' });
  row.appendChild(
    h('span', { class: 'row-label', text: `选择${meta.label}` })
  );
  row.appendChild(
    select(
      editingId,
      options,
      (v) => {
        if (v === '__add__') {
          const id = `${meta.newIdPrefix}${Date.now().toString(36)}`;
          d[meta.listKey].platforms.push({ id, name: meta.newName, ...meta.template });
          store.setUi({ [editKey]: id });
          markDirty();
          render();
          return;
        }
        store.setUi({ [editKey]: v });
        render();
      }
    )
  );
  if (current && current.id !== d[meta.listKey].activeId) {
    row.appendChild(
      button('设为使用中', () => {
        d[meta.listKey].activeId = current.id;
        markDirty();
        render();
      }, { small: true, primary: true, title: '把这一家设为当前使用的平台' })
    );
  }
  if (current && current.id === d[meta.listKey].activeId) {
    row.appendChild(h('span', { class: 'pill pill-brand', text: '当前使用中' }));
  }
  wrap.appendChild(field(`${meta.label}`, row, `共 ${list.length} 家可选；下拉框只显示选中这一家的配置。`));

  if (current) {
    wrap.appendChild(platformDetail(kind, list, current, d, () => render()));
  } else {
    wrap.appendChild(h('div', { class: 'note', text: '还没有任何平台，请从下拉框选择「➕ 添加自定义平台…」。' }));
  }
  return wrap;
}

// 单个平台的配置详情（关键字段 + 折叠的高级项）
function platformDetail(kind, list, p, d, rerender) {
  const card = h('div', { class: 'platform-card' });
  const head = h('div', { class: 'platform-head' });
  head.appendChild(h('span', { class: 'platform-name', text: p.name || p.id }));
  head.appendChild(h('span', { class: 'spacer' }));
  if (p.keyUrl) {
    head.appendChild(h('a', { class: 'btn btn-sm', href: p.keyUrl, target: '_blank', rel: 'noreferrer', text: '申请 Key', title: `打开 ${p.keyUrl}` }));
  }
  if (p.homepage) {
    head.appendChild(h('a', { class: 'btn btn-sm', href: p.homepage, target: '_blank', rel: 'noreferrer', text: '官网' }));
  }
  head.appendChild(
    button('删除', () => {
      confirmDialog('删除平台', `确定删除「${p.name}」？`, () => {
        const arr = list.filter((x) => x.id !== p.id);
        d[kind].platforms = arr;
        if (d[kind].activeId === p.id) d[kind].activeId = (arr[0] || {}).id || '';
        store.setUi({ [`editPlatform_${kind}`]: d[kind].activeId });
        markDirty();
        rerender();
      });
    }, { small: true, danger: true, disabled: list.length <= 1 })
  );
  card.appendChild(head);

  const body = h('div', { class: 'platform-body' });
  body.appendChild(field('名称', textInput(p.name, (v) => { p.name = v; markDirty(); })));

  // 接口地址：硅基流动这类有国内/国际双站点的服务，给一个一键切换，
  // 避免手改字符串出错（站点与 Key 不匹配时的表现是 401，很难自查）。
  const baseRow = h('div', { class: 'row tight' });
  const baseInput = textInput(p.baseUrl, (v) => { p.baseUrl = v; markDirty(); }, { placeholder: 'https://api.example.com/v1' });
  baseInput.style.flex = '1 1 auto';
  baseRow.appendChild(baseInput);
  const altHosts = alternateHostsForUi(p.baseUrl);
  if (altHosts.length) {
    baseRow.appendChild(
      button(`改用 ${altHosts[0].host}`, () => {
        p.baseUrl = altHosts[0].url;
        markDirty();
        render();
      }, { small: true, title: `${p.baseUrl} → ${altHosts[0].url}（切到另一个站点）` })
    );
  }
  const baseNote = (() => {
    const host = hostOf(p.baseUrl);
    if (!host) return '自定义域名需要点「申请域名权限」。';
    if (/api\.siliconflow\.cn$/i.test(host)) {
      return '当前是国内站。**必须使用 cloud.siliconflow.cn 申请的 Key**；国际站的 Key 在这里会 401。';
    }
    if (/api\.siliconflow\.com$/i.test(host)) {
      return '当前是国际站。**必须使用 cloud.siliconflow.com 申请的 Key**；国内站的 Key 在这里会 401。';
    }
    return '自定义域名需要点「申请域名权限」。';
  })();
  body.appendChild(field('接口地址（Base URL）', baseRow, baseNote));
  if (kind !== 'search') {
    const modelRow = h('div', { class: 'row tight' });
    const modelInput = textInput(p.model, (v) => { p.model = v; markDirty(); });
    modelInput.style.flex = '1 1 auto';
    modelRow.appendChild(modelInput);
    modelRow.appendChild(
      button('选择模型', () => {
        const models = state.modelCache[p.id] || p.models || [];
        if (!models.length) {
          toast({ title: '还没有模型列表', detail: '先点「探测模型」拉一次，或直接在输入框里填模型名。' }, 'warn', 4000);
          return;
        }
        openOverlay(
          `为「${p.name}」选择模型`,
          h(
            'div',
            { class: 'row tight' },
            models.map((m) =>
              h('span', {
                class: 'tag',
                text: m,
                dataset: { active: String(p.model === m) },
                onclick: () => {
                  p.model = m;
                  markDirty();
                  closeOverlays();
                  rerender();
                }
              })
            )
          ),
          [{ label: '关闭', onClick: () => closeOverlays() }],
          { width: '460px' }
        );
      }, { small: true })
    );
    modelRow.appendChild(
      button('核对模型', async () => {
        try {
          const res = await call('platform.models', { kind, id: p.id }, { timeoutMs: 40000 });
          state.modelCache[p.id] = res.models || [];
          const wanted = String(p.model || '').trim();
          const ok = (res.models || []).includes(wanted);
          // 把「打到了哪个地址、用的是多长的 Key」也报出来：
          // 这是区分「鉴权通过但没有该模型」和「地址/Key 配错」的关键信息。
          const where = res.url ? `· ${res.url}（Key 长度 ${res.keyLength}）` : '';
          if (res.fallback) {
            toast(
              {
                title: '没能从平台拉到模型列表',
                detail: `${res.reason || '请求失败'}${res.detail ? `：${String(res.detail).split('\n')[0]}` : ''}\n${where}\n下面显示的是内置建议，不代表平台真实可用模型。`
              },
              'warn',
              10000
            );
          } else if (ok) {
            toast(
              {
                title: `"${wanted}" 在该平台上可用`,
                detail: `共探测到 ${res.models.length} 个模型\n${where}\n注意：能列出 ≠ 能用于语音识别，仍需「测试连接」确认。`
              },
              'ok',
              8000
            );
          } else {
            const speech = (res.models || []).filter((m) => /audio|asr|whisper|sensevoice|speech|voice|gsr/i.test(m));
            toast(
              {
                title: `"${wanted}" 不在该平台的模型列表里`,
                detail: `${speech.length ? `可用的语音识别模型：${speech.slice(0, 6).join('、')}` : `平台模型（前 20）：${(res.models || []).slice(0, 20).join('、')}`}\n${where}`
              },
              'warn',
              9000
            );
          }
          rerender();
        } catch (err) {
          showError(err, '核对模型失败');
        }
      }, { small: true, title: '向平台拉一次模型列表，确认当前模型名确实存在' })
    );
    body.appendChild(
      field('模型', modelRow, '模型名必须属于这个平台。点「核对模型」可以直接确认；点「选择模型」从平台返回的列表里挑。')
    );
  }

  // 密钥：密码框 + 显示/隐藏 + 掩码提示
  const keyRow = h('div', { class: 'row tight' });
  const visible = !!(store.get().ui.pendingKeyVisibility || {})[p.id];
  const keyInput = h('input', {
    class: 'input',
    type: visible ? 'text' : 'password',
    value: '',
    placeholder: p.apiKeySet || p.apiKey ? `已保存：${p.apiKey || '••••'}（留空表示不改动）` : '粘贴 API Key',
    style: { flex: '1 1 auto' },
    oninput: (e) => {
      p.apiKey = e.target.value;
      markDirty();
    }
  });
  keyRow.appendChild(keyInput);
  keyRow.appendChild(
    button(visible ? '隐藏' : '显示', () => {
      const ui = store.get().ui;
      store.setUi({ pendingKeyVisibility: { ...(ui.pendingKeyVisibility || {}), [p.id]: !visible } });
      rerender();
    }, { small: true })
  );
  if (p.apiKeySet || p.apiKey) {
    keyRow.appendChild(button('清除', () => { p.apiKey = ''; p.apiKeySet = false; markDirty(); rerender(); }, { small: true, danger: true }));
  }
  body.appendChild(
    field('API Key', keyRow, `只保存在本机（不同步）。已保存的只显示掩码；留空保存表示「不改动」。当前：${p.apiKeySet ? '已配置' : '未配置'}`)
  );

  const acts = h('div', { class: 'row tight' });
  acts.appendChild(
    button('测试连接', async () => {
      const btn = acts.querySelector('button');
      btn.disabled = true;
      btn.textContent = '测试中…';
      try {
        await persistDraft({ silent: true });
        const res = await call('platform.test', { kind, id: p.id }, { timeoutMs: 60000 });
        toast({ title: `连接正常（${res.ms}ms）`, detail: res.sample || '' }, 'ok', 5000);
      } catch (err) {
        showError(err, '测试连接失败');
      } finally {
        btn.disabled = false;
        btn.textContent = '测试连接';
      }
    }, { small: true, primary: true })
  );
  acts.appendChild(
    button('探测模型', async () => {
      const btn = Array.from(acts.querySelectorAll('button')).find((b) => b.textContent === '探测模型');
      btn.disabled = true;
      btn.textContent = '探测中…';
      try {
        await persistDraft({ silent: true });
        const res = await call('platform.models', { kind, id: p.id }, { timeoutMs: 40000 });
        state.modelCache[p.id] = res.models || [];
        if (res.fallback) {
          toast({ title: '该平台没有模型列表接口', detail: `已给出常见模型建议${res.reason ? `（${res.reason}）` : ''}` }, 'warn', 5000);
        } else {
          toast({ title: `探测到 ${res.models.length} 个模型` }, 'ok');
        }
        rerender();
      } catch (err) {
        showError(err, '探测模型失败');
      } finally {
        btn.disabled = false;
        btn.textContent = '探测模型';
      }
    }, { small: true })
  );
  acts.appendChild(
    button('申请域名权限', async () => {
      try {
        const res = await call('permission.request', { url: p.baseUrl }, { timeoutMs: 120000 });
        toast({ title: `已授权 ${res.pattern}`, detail: res.already ? '此前已经授权过。' : '现在可以访问该域名。' }, 'ok');
      } catch (err) {
        showError(err, '申请域名权限失败');
      }
    }, { small: true, title: '自定义接口地址需要向浏览器申请该域名的访问权限' })
  );
  acts.appendChild(
    button('连通性诊断', async () => {
      const btn = Array.from(acts.querySelectorAll('button')).find((b) => b.textContent === '连通性诊断');
      btn.disabled = true;
      btn.textContent = '诊断中…';
      try {
        await persistDraft({ silent: true });
        const res = await call('platform.probe', { kind, id: p.id }, { timeoutMs: 120000 });
        const box = h('div');
        box.appendChild(
          h('div', {
            class: 'note',
            text: `Key：长度 ${res.keyLength}，末四位 ${res.keyTail}\n会依次测试每一个可能的地址与传输方式，下面是服务端的真实返回。`
          })
        );
        const table = h('div', { class: 'probe-table' });
        for (const row of res.rows || []) {
          const okMark = row.ok ? '✅' : row.status ? '❌' : '⚠';
          table.appendChild(
            h('div', { class: 'probe-row', dataset: { ok: String(!!row.ok) } }, [
              h('span', { class: 'probe-mark', text: okMark }),
              h('span', { class: 'probe-kind', text: `${row.kind} → ${row.url}` }),
              h('span', { class: 'probe-status', text: row.status == null ? '—' : String(row.status) }),
              h('span', { class: 'probe-note', text: row.note || '' })
            ])
          );
        }
        box.appendChild(table);
        const rows = res.rows || [];
        const modelsOk = rows.filter((r) => /models/.test(r.url) && r.ok);
        const asr500 = rows.filter((r) => /transcriptions|completions/.test(r.url) && r.status >= 500);
        const asr400 = rows.filter((r) => /transcriptions|completions/.test(r.url) && r.status === 400);
        const asr401 = rows.filter((r) => /transcriptions|completions/.test(r.url) && r.status === 401);
        const asrOk = rows.filter((r) => /transcriptions|completions/.test(r.url) && r.ok);
        let verdict;
        if (asrOk.length) {
          verdict = '✅ 有转录请求成功，Key、地址、模型都对。可以直接去「语音转录」。';
        } else if (asr500.length) {
          verdict =
            '⚠ 鉴权是通的（见 ✅ 行），转录请求也**送到了模型**，但服务端在转录这一步内部报错（5xx）。' +
            '这不是参数或权限问题，通常是**音频样本**的问题（静音/格式/时长）。请直接拿真实视频点「语音转录」验证；' +
            '如果真实音频也 5xx，那就是该平台这个模型当前不可用。';
        } else if (modelsOk.length && asr400.length) {
          verdict =
            '⚠ 鉴权是通的（/models 返回 200），但转录接口返回 400 —— **服务端在动模型之前就拒绝了请求**，' +
            '说明这个模型名不被转录接口接受。请把模型换成一个确定的语音识别模型（如 FunAudioLLM/SenseVoiceSmall）再试。';
        } else if (asr401.length && !modelsOk.length) {
          verdict = '⚠ 全部鉴权失败。这个 Key 在这些地址上都不被接受，请确认 Key 与「接口地址」属于同一个站。';
        } else {
          verdict = '请看上面每一行的状态码与响应体。';
        }
        box.appendChild(h('div', { class: 'note', text: verdict }));
        openOverlay('连通性诊断', box, [{ label: '关闭', onClick: () => closeOverlays() }], { width: '620px' });
      } catch (err) {
        showError(err, '连通性诊断失败');
      } finally {
        btn.disabled = false;
        btn.textContent = '连通性诊断';
      }
    }, { small: true, title: '逐个地址、逐个传输方式打一遍，把状态码列出来（不消耗额度）' })
  );
  body.appendChild(acts);

  // 可用模型标签
  const models = state.modelCache[p.id] || p.models || [];
  if (models.length) {
    const tags = h('div', { class: 'row tight model-tags' });
    for (const m of models) {
      tags.appendChild(
        h('span', {
          class: 'tag',
          text: m,
          dataset: { active: String(p.model === m) },
          onclick: () => {
            p.model = m;
            markDirty();
            rerender();
          }
        })
      );
    }
    body.appendChild(field('可用模型（点标签选择）', tags));
  }

  // 高级项：按平台差异收起，避免干扰
  const advanced = h('div');
  if (kind === 'asr') {
    advanced.appendChild(
      field(
        '请求方式',
        select(p.transport || 'multipart', [
          { value: 'multipart', label: 'multipart/form-data（OpenAI / Groq / 硅基流动）' },
          { value: 'base64-json', label: 'base64 JSON（{model, audio}）' },
          { value: 'chat-audio', label: '对话接口（/chat/completions + input_audio）' }
        ], (v) => { p.transport = v; markDirty(); })
      ),
      '不确定就保持 multipart：测试/转录失败时会自动按阶梯尝试其它两种传输方式。'
    );
    advanced.appendChild(field('音频字段名', textInput(p.keyField || 'file', (v) => { p.keyField = v; markDirty(); }), 'multipart 平台通常叫 file；base64 JSON 平台通常叫 audio。'));
    advanced.appendChild(
      field(
        '上传音频格式',
        select(p.audioFormat || 'auto', [
          { value: 'auto', label: '自动（按平台判断）' },
          { value: 'wav', label: 'WAV（16kHz 单声道）' },
          { value: 'm4a', label: 'M4A / MP4-AAC' }
        ], (v) => { p.audioFormat = v; markDirty(); })
      ),
      '硅基流动对 WAV 会返回 500（服务端解码失败），必须用 M4A。浏览器只能实时编码，' +
        '所以选 M4A 时耗时约等于音频时长。'
    );
    advanced.appendChild(
      field(
        '参数风格',
        select(p.paramStyle || 'auto', [
          { value: 'auto', label: '自动（按平台判断）' },
          { value: 'minimal', label: '最小参数：只发 file + model' },
          { value: 'full', label: '完整参数：带 response_format / language' }
        ], (v) => { p.paramStyle = v; markDirty(); })
      ),
      '硅基流动这类只认 file + model 的平台请选「最小参数」；想拿时间戳的 OpenAI 兼容平台选「完整参数」。'
    );
  }
  if (kind === 'search') {
    advanced.appendChild(
      field(
        '服务商类型',
        select(p.kind || 'tavily', [
          { value: 'tavily', label: 'Tavily' },
          { value: 'bocha', label: '博查 Bocha' },
          { value: 'serper', label: 'Serper（Google）' },
          { value: 'custom', label: '通用（?q= / Bearer）' }
        ], (v) => { p.kind = v; markDirty(); })
      )
    );
  }
  advanced.appendChild(field('官网地址', textInput(p.homepage, (v) => { p.homepage = v; markDirty(); }, { placeholder: 'https://' })));
  advanced.appendChild(field('申请 Key 链接', textInput(p.keyUrl, (v) => { p.keyUrl = v; markDirty(); }, { placeholder: 'https://' })));
  body.appendChild(
    collapsible('高级设置', false, (box) => box.appendChild(advanced), {
      stateKey: `platformAdvanced_${p.id}`,
      isOpen: (k, def) => store.groupOpen(k, def),
      onToggle: (k, open) => store.setGroupOpen(k, open)
    })
  );

  card.appendChild(body);
  return card;
}

function promptGroup(d) {
  return groupWrap('prompt', '提示词（可修改 + 多套模板）', false, (body) => {
    const st = store.get();
    const templates = d.prompt.templates || [];
    const active = templates.find((t) => t.id === d.prompt.activeId) || templates[0];
    const tags = h('div', { class: 'row tight' });
    for (const t of templates) {
      tags.appendChild(
        h('span', {
          class: 'tag',
          text: t.name,
          dataset: { active: String(t.id === (active && active.id)) },
          onclick: () => {
            d.prompt.activeId = t.id;
            markDirty();
            render();
          }
        })
      );
    }
    body.appendChild(field('提示词模板', tags));
    if (active) {
      const area = h('textarea', { class: 'input', style: { minHeight: '90px' } });
      area.value = active.text || '';
      area.addEventListener('input', () => {
        active.text = area.value;
        markDirty();
      });
      body.appendChild(field('当前模板内容', area, '默认提示词必须与需求文档一字不差：' + DEFAULT_SYSTEM_PROMPT));
      const row = h('div', { class: 'row tight' });
      row.appendChild(
        button('新建模板', () => {
          promptDialog('新建提示词模板', '我的模板', (name) => {
            d.prompt.templates.push({ id: `tpl_${Date.now().toString(36)}`, name: name || '未命名模板', text: '' });
            markDirty();
            render();
          });
        }, { small: true })
      );
      row.appendChild(
        button('重命名', () => {
          promptDialog('重命名模板', active.name, (name) => {
            active.name = name || active.name;
            markDirty();
            render();
          });
        }, { small: true })
      );
      row.appendChild(
        button('恢复默认文案', () => {
          active.text = DEFAULT_SYSTEM_PROMPT;
          markDirty();
          render();
        }, { small: true })
      );
      row.appendChild(
        button('删除模板', () => {
          d.prompt.templates = d.prompt.templates.filter((t) => t.id !== active.id);
          d.prompt.activeId = (d.prompt.templates[0] || {}).id || 'default';
          markDirty();
          render();
        }, { small: true, danger: true, disabled: active.id === 'default' })
      );
      body.appendChild(row);
    }
    body.appendChild(field('对话附加前缀', textInput(d.prompt.chatPrefix, (v) => { d.prompt.chatPrefix = v; markDirty(); }), '会加在系统提示词之后，用于约束「只依据字幕回答」。'));
  });
}

function rulesGroup(d) {
  return groupWrap('rules', '替换规则组（可保存 / 导出 / 导入 / 切换）', false, (body) => {
    const groups = d.optimize.groups || [];
    const active = groups.find((g) => g.id === d.optimize.activeGroupId) || groups[0];
    const tags = h('div', { class: 'row tight' });
    for (const g of groups) {
      tags.appendChild(
        h('span', {
          class: 'tag',
          text: g.name,
          dataset: { active: String(active && g.id === active.id) },
          onclick: () => {
            d.optimize.activeGroupId = g.id;
            markDirty();
            render();
          }
        })
      );
    }
    body.appendChild(field('规则组', tags));
    if (active) {
      const list = h('div');
      (active.rules || []).forEach((r, i) => {
        const row = h('div', { class: 'row tight', style: { marginBottom: '3px' } });
        row.appendChild(textInput(r.from, (v) => { r.from = v; markDirty(); }, { placeholder: '错误写法' }));
        row.appendChild(h('span', { text: '→' }));
        row.appendChild(textInput(r.to, (v) => { r.to = v; markDirty(); }, { placeholder: '正确写法' }));
        row.appendChild(
          button('删', () => {
            active.rules.splice(i, 1);
            markDirty();
            render();
          }, { small: true, danger: true })
        );
        list.appendChild(row);
      });
      body.appendChild(field('规则（错误写法 → 正确写法）', list));
      const row = h('div', { class: 'row tight' });
      row.appendChild(
        button('添加规则', () => {
          active.rules = active.rules || [];
          active.rules.push({ from: '', to: '' });
          markDirty();
          render();
        }, { small: true })
      );
      row.appendChild(
        button('新建规则组', () => {
          promptDialog('新建规则组', '我的规则组', (name) => {
            const id = `grp_${Date.now().toString(36)}`;
            d.optimize.groups.push({ id, name: name || '未命名', rules: [] });
            d.optimize.activeGroupId = id;
            markDirty();
            render();
          });
        }, { small: true })
      );
      row.appendChild(
        button('导出', () => {
          downloadFile(`字幕替换规则-${active.name}.json`, exportRuleGroups([active]), 'application/json');
          toast({ title: '已导出规则组' }, 'ok');
        }, { small: true })
      );
      row.appendChild(
        button('导入', () => {
          const input = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
          document.body.appendChild(input);
          input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            input.remove();
            if (!file) return;
            try {
              const text = await file.text();
              const imported = parseRuleGroups(text);
              d.optimize.groups.push(...imported);
              d.optimize.activeGroupId = imported[0].id;
              markDirty();
              render();
              toast({ title: `已导入 ${imported.length} 个规则组` }, 'ok');
            } catch (err) {
              showError(err, '导入规则组失败');
            }
          });
          input.click();
        }, { small: true })
      );
      row.appendChild(
        button('删除规则组', () => {
          d.optimize.groups = d.optimize.groups.filter((g) => g.id !== active.id);
          d.optimize.activeGroupId = (d.optimize.groups[0] || {}).id;
          markDirty();
          render();
        }, { small: true, danger: true, disabled: !!active.builtin })
      );
      body.appendChild(row);
    }
    body.appendChild(
      checkbox(d.optimize.useSearch, (v) => { d.optimize.useSearch = v; markDirty(); }, 'AI 优化时联网核对（把检索结果作为判断依据，消耗额度）')
    );
  });
}

function glossaryGroup(d) {
  return groupWrap('glossary', '术语表（专有名词正确答案）', false, (body) => {
    const list = h('div');
    (d.optimize.glossary || []).forEach((g, i) => {
      const row = h('div', { class: 'row tight', style: { marginBottom: '3px' } });
      row.appendChild(textInput(g.term, (v) => { g.term = v; markDirty(); }, { placeholder: '专有名词' }));
      row.appendChild(textInput(g.note, (v) => { g.note = v; markDirty(); }, { placeholder: '说明（可选）' }));
      row.appendChild(
        button('删', () => {
          d.optimize.glossary.splice(i, 1);
          markDirty();
          render();
        }, { small: true, danger: true })
      );
      list.appendChild(row);
    });
    body.appendChild(field('术语', list));
    body.appendChild(
      button('添加术语', () => {
        d.optimize.glossary = d.optimize.glossary || [];
        d.optimize.glossary.push({ term: '', note: '' });
        markDirty();
        render();
      }, { small: true })
    );
    body.appendChild(h('div', { class: 'note', text: '术语表会随 AI 优化请求一起提交，用于自动纠错。' }));
  });
}

function searchGroup(d) {
  return groupWrap('search', '联网检索（两种方式，作用不同）', false, (body) => {
    body.appendChild(
      h('div', { class: 'note', text: '① 服务商检索：走检索 API，结果会作为 AI 的依据，消耗额度。② 直接搜索引擎：只打开结果页，不消耗额度，不进入 AI 上下文。' })
    );
    for (const p of []) void p;
    body.appendChild(platformPicker('search', d));
    body.appendChild(
      field(
        '直接搜索引擎',
        select(d.search.engine, SEARCH_ENGINES.map((e) => ({ value: e.id, label: e.label })), (v) => {
          d.search.engine = v;
          markDirty();
        })
      )
    );
    body.appendChild(field('最大结果数', numberInput(d.search.maxResults, (v) => { d.search.maxResults = Math.max(1, Math.min(20, v)); markDirty(); }, { min: 1, max: 20 })));
    body.appendChild(checkbox(d.search.fetchPageContent, (v) => { d.search.fetchPageContent = v; markDirty(); }, '抓取页面正文（更准，但更慢、更耗额度）'));
    body.appendChild(
      checkbox(
        d.search.autoSearchOnChat,
        (v) => { d.search.autoSearchOnChat = v; markDirty(); },
        '对话时自动联网（问题涉及最新/是谁/多少钱等外部信息时自动检索）'
      )
    );
    body.appendChild(
      checkbox(
        d.search.alwaysSearchOnChat,
        (v) => { d.search.alwaysSearchOnChat = v; markDirty(); },
        '每轮对话都联网检索（最准，但每问一句都会消耗检索额度）'
      )
    );

    // ---- 免费无 Key 引擎（开箱即用）----
    body.appendChild(h('div', { class: 'section-title', text: '免费引擎（无需 Key）' }));
    body.appendChild(
      h('div', {
        class: 'note',
        text:
          '没配检索 Key 时自动使用这些公开引擎 —— 装了扩展就能联网，不必先注册任何服务。\n' +
          '已实测可用：Bing 网页 / AnySearch / Exa（MCP 匿名端点）。\n' +
          '它们是第三方公开服务，不保证长期稳定与额度，所以只作兜底：\n' +
          '配置了自己的检索平台时优先用配置的，它失败才回退到这里。'
      })
    );
    body.appendChild(
      checkbox(
        d.search.keylessFallback !== false,
        (v) => { d.search.keylessFallback = v; markDirty(); },
        '允许使用免费引擎兜底（关闭后：没配 Key 就无法联网）'
      )
    );
    body.appendChild(
      field(
        '结果缓存（分钟，0 = 关闭）',
        numberInput(d.search.cacheMinutes ?? 5, (v) => {
          d.search.cacheMinutes = Math.max(0, Math.min(60, v));
          markDirty();
        }, { min: 0, max: 60, step: 1 })
      )
    );
    body.appendChild(h('div', { class: 'note', text: '同一问题重复提问时直接命中缓存，不再消耗检索额度。' }));

    const st = store.get();
    if ((st.search.results || []).length) {
      body.appendChild(h('div', { class: 'section-title', text: `检索来源面板（${st.search.results.length} 条）` }));
      sortSources(st).forEach((r, i) => {
        body.appendChild(
          h('div', { class: 'src-row' }, [
            h('span', { class: 'cite-count', text: `×${r.__count}` }),
            h('a', { class: 'md-link', href: r.url, target: '_blank', rel: 'noreferrer', text: r.title || r.url }),
            h('span', { class: 'muted', text: (r.snippet || '').slice(0, 60) })
          ])
        );
      });
    }
    // ---- 时间过滤 ----
    body.appendChild(h('div', { class: 'section-title', text: '时间范围' }));
    body.appendChild(
      field(
        '默认时间范围',
        select(
          TIME_PRESETS.some((p) => p.id === (d.search.timeRange || ''))
            ? d.search.timeRange || ''
            : (d.search.timeRange ? '__custom' : ''),
          [
            ...TIME_PRESETS.map((p) => ({ value: p.id, label: p.label })),
            { value: '__custom', label: '自定义（相对时间或绝对日期）' }
          ],
          (v) => {
            if (v === '__custom') {
              const cur = String(d.search.timeRange || '');
              d.search.timeRange = TIME_PRESETS.some((p) => p.id === cur) ? '3d' : cur;
            } else {
              d.search.timeRange = v;
            }
            markDirty();
            render();
          }
        )
      )
    );
    // 自定义输入：支持 12h / 3d / 2w / 6mo / 1y，或绝对日期 2026-01-01（表示该日期之后）
    const customVal = String(d.search.timeRange || '');
    const isCustom = customVal && !TIME_PRESETS.some((p) => p.id === customVal);
    if (isCustom) {
      const tr = normalizeTimeRange(customVal);
      body.appendChild(
        field(
          '自定义时间范围',
          h('input', {
            class: 'input',
            value: customVal,
            placeholder: '例如 3d（近三天）、2w、6mo、2026-01-01',
            oninput: (e) => {
              d.search.timeRange = e.target.value.trim();
              markDirty();
            }
          })
        )
      );
      body.appendChild(
        h('div', {
          class: 'note',
          text: tr
            ? `解析为「${tr.label}」`
            : '无法识别的写法 —— 支持 12h / 3d / 2w / 6mo / 1y，或绝对日期 2026-01-01'
        })
      );
    }
    body.appendChild(
      h('div', {
        class: 'note',
        text:
          '⚠ 免费引擎（Bing 网页 / AnySearch / Exa 匿名端点）实测无法按时间过滤 ——\n' +
          'URL 参数与日期参数都会被服务端忽略。\n' +
          '要严格的时间范围，请配置 Tavily / Exa / 博查 / 智谱 / 秘塔 等检索平台。\n' +
          '本扩展不会假装过滤生效：未生效时结果里会明确标注。'
      })
    );

    const row = h('div', { class: 'row tight' });
    const input = h('input', { class: 'input', placeholder: '检索关键词…', value: st.search.query || '', style: { flex: '1 1 auto' } });
    row.appendChild(input);
    row.appendChild(button('服务商检索', () => doProviderSearch(input.value), { small: true, primary: true, title: '结果会进入 AI 依据（消耗额度）' }));
    row.appendChild(button('直接搜索', () => doEngineSearch(input.value), { small: true, title: '只打开搜索引擎结果页（不消耗额度）' }));
    body.appendChild(field('立即检索', row));
  });
}

function sortSources(st) {
  const results = st.search.results || [];
  const counts = st.search.counts || {};
  return results
    .map((r) => ({ ...r, __count: counts[r.url] || 0 }))
    .sort((a, b) => b.__count - a.__count);
}

function exportGroup(d) {
  return groupWrap('export', '导出（6 格式 × 4 模板）', false, (body) => {
    body.appendChild(
      field(
        '默认格式',
        select(d.exportCfg.format, EXPORT_FORMATS.map((f) => ({ value: f.id, label: f.label })), (v) => {
          d.exportCfg.format = v;
          markDirty();
        })
      )
    );
    body.appendChild(
      field(
        '字幕模板',
        select(d.exportCfg.template, EXPORT_TEMPLATES.map((t) => ({ value: t.id, label: `${t.label} — ${t.desc}` })), (v) => {
          d.exportCfg.template = v;
          markDirty();
        })
      )
    );
    body.appendChild(checkbox(d.exportCfg.includeTimestamps, (v) => { d.exportCfg.includeTimestamps = v; markDirty(); }, '正文里保留时间戳'));
    body.appendChild(checkbox(d.exportCfg.estimateTimestamps, (v) => { d.exportCfg.estimateTimestamps = v; markDirty(); }, '缺少时间戳时自动估算'));
    body.appendChild(field('ASS 字号', numberInput(d.exportCfg.assFontSize, (v) => { d.exportCfg.assFontSize = v; markDirty(); }, { min: 12, max: 120 })));
    body.appendChild(field('文件名模板', textInput(d.exportCfg.filenamePattern, (v) => { d.exportCfg.filenamePattern = v; markDirty(); }, { placeholder: '{title}-{part}' }), '可用占位符：{title} {part} {bvid} {date}'));
  });
}

function batchGroup(d) {
  return groupWrap('batch', '批量队列（串行处理）', false, (body) => {
    const input = h('textarea', { class: 'input', placeholder: '每行一个 B 站视频链接…' });
    body.appendChild(field('视频链接', input));
    body.appendChild(
      button('加入队列', () => {
        batchAdd(input.value);
        input.value = '';
      }, { small: true, primary: true })
    );
    const st = store.get();
    const q = st.queue || [];
    if (q.length) {
      body.appendChild(h('div', { class: 'section-title', text: `队列（${q.filter((x) => x.status === 'queued').length} 待处理 / 共 ${q.length}）` }));
      for (const item of q) {
        body.appendChild(
          h('div', { class: 'queue-row' }, [
            h('div', { class: 't', text: item.title || item.url }),
            h('div', { class: 'muted', text: `状态：${statusLabel(item.status)}${item.error ? ` —— ${item.error}` : ''}` }),
            h('div', { class: 'row tight' }, [
              item.status === 'running' ? h('span', { class: 'pill', text: `${Math.round(item.progress || 0)}%` }) : null,
              button('移除', () => batchRemove(item.id), { small: true, danger: true })
            ])
          ])
        );
      }
    }
    body.appendChild(
      h('div', { class: 'row tight' }, [
        button('暂停队列', () => batchPause(true), { small: true }),
        button('继续队列', () => batchPause(false), { small: true }),
        button('清空已完成', () => batchClearDone(), { small: true })
      ])
    );
  });
}

function statusLabel(s) {
  return { queued: '排队中', running: '处理中', done: '已完成', error: '失败' }[s] || s;
}

function historyGroup(d) {
  return groupWrap('history', '历史记录（查看 / 删除 / 清空）', false, (body) => {
    const st = store.get();
    const rows = st.history || [];
    const head = h('div', { class: 'row tight' });
    head.appendChild(button('刷新', () => loadHistory(), { small: true }));
    head.appendChild(
      button('清空全部', () => {
        confirmDialog('清空历史', '确定清空全部历史记录？此操作不可撤销。', () => clearHistory());
      }, { small: true, danger: true })
    );
    head.appendChild(
      button('清空缓存', () => {
        confirmDialog('清空缓存', '确定清空字幕缓存与音频分块缓存？下次会重新下载。', async () => {
          await call('cache.clear');
          toast({ title: '缓存已清空' }, 'ok');
          render();
        });
      }, { small: true })
    );
    body.appendChild(head);
    if (!rows.length) body.appendChild(h('div', { class: 'note', text: '还没有历史记录。抓取字幕后会自动保存。' }));
    for (const r of rows) {
      body.appendChild(
        h('div', { class: 'history-row' }, [
          h('div', { class: 't', text: `${r.video?.title || '未命名'}${r.video?.partTitle ? ` · ${r.video.partTitle}` : ''}` }),
          h('div', { class: 'muted', text: `${r.video?.bvid || ''} · ${r.source === 'asr' ? '语音转录' : '官方字幕'} · ${r.lines ? r.lines.length : 0} 行 · ${fmtRelative(r.savedAt)}` }),
          h('div', { class: 'row tight' }, [
            button('恢复', () => restoreHistory(r.key), { small: true }),
            button('删除', () => removeHistory(r.key), { small: true, danger: true })
          ])
        ])
      );
    }
    body.appendChild(checkbox(d.behavior.useLocalCache, (v) => { d.behavior.useLocalCache = v; markDirty(); }, '优先使用本地缓存（避免重复花费）'));
    body.appendChild(checkbox(d.behavior.preferOfficial, (v) => { d.behavior.preferOfficial = v; markDirty(); }, '优先使用官方字幕'));
  });
}

function pageGroup(d) {
  return groupWrap('page', '页面内功能', false, (body) => {
    body.appendChild(checkbox(d.page.playerButton, (v) => { d.page.playerButton = v; markDirty(); }, '在播放器上显示「字幕」按钮'));
    body.appendChild(field('按钮触发时使用的提示词', textInput(d.page.playerButtonPrompt, (v) => { d.page.playerButtonPrompt = v; markDirty(); })));
    body.appendChild(checkbox(d.page.overlay, (v) => { d.page.overlay = v; markDirty(); }, '在视频画面上显示字幕'));
    body.appendChild(
      field('画面字幕字号缩放', numberInput(d.page.overlayFontScale, (v) => { d.page.overlayFontScale = Math.max(0.5, Math.min(3, v)); markDirty(); }, { min: 0.5, max: 3, step: 0.1 }))
    );
    body.appendChild(field('画面字幕距底部（%）', numberInput(d.page.overlayBottom, (v) => { d.page.overlayBottom = Math.max(0, Math.min(60, v)); markDirty(); }, { min: 0, max: 60 })));
    body.appendChild(checkbox(d.page.followPlayback, (v) => { d.page.followPlayback = v; markDirty(); }, '跟随播放（把播放时间回传给侧边栏高亮）'));
    body.appendChild(
      button('把当前设置推送到页面', async () => {
        await persistDraft({ silent: true });
        toast({ title: '已推送到 B 站页面' }, 'ok');
      }, { small: true })
    );
  });
}

function advancedGroup(d) {
  return groupWrap('advanced', '诊断与关于', false, (body) => {
    const st = store.get();
    const b = st.build;
    body.appendChild(
      h('div', { class: 'kv' }, [
        h('span', { class: 'kv-key', text: '构建指纹' }),
        h('span', { class: 'kv-val', text: b ? `${b.version} + ${b.modules} 模块 + ${b.buildTime}` : '加载中…' })
      ])
    );
    body.appendChild(h('div', { class: 'kv' }, [h('span', { class: 'kv-key', text: '内容脚本版本' }), h('span', { class: 'kv-val', text: (b && b.contentVersion) || '-' })]));
    const tabs = st.contentTabs || [];
    body.appendChild(h('div', { class: 'section-title', text: '页面脚本检查（扩展更新后旧页面需要刷新）' }));
    if (!tabs.length) body.appendChild(h('div', { class: 'note', text: '没检测到 B 站标签页。' }));
    for (const t of tabs) {
      body.appendChild(
        h('div', { class: 'history-row' }, [
          h('div', { class: 't', text: t.title || t.url }),
          h('div', { class: 'muted', text: `脚本版本：${t.scriptVersion || '未注入'}${t.stale ? '（版本不一致，需要刷新页面）' : ''}` }),
          h('div', { class: 'row tight' }, [
            button('重新注入', async () => {
              try {
                await call('page.reinject', { tabId: t.tabId }, { timeoutMs: 20000 });
                toast({ title: '已重新注入内容脚本' }, 'ok');
                refreshTabs();
              } catch (err) {
                showError(err, '重新注入失败');
              }
            }, { small: true }),
            button('刷新页面', async () => {
              await call('tab.open', { url: t.url, active: true });
              toast({ title: '已打开新标签页', detail: '扩展更新后旧页面必须刷新才会生效。' }, 'warn', 5000);
            }, { small: true })
          ])
        ])
      );
    }
    body.appendChild(button('重新检查', () => refreshTabs(), { small: true }));
    body.appendChild(
      h('div', { class: 'row tight', style: { marginTop: '8px' } }, [
        button('复制诊断信息', async () => {
          try {
            const diag = await call('diagnostics');
            await copyText(JSON.stringify(diag, null, 2));
            toast({ title: '诊断信息已复制到剪贴板' }, 'ok');
          } catch (err) {
            showError(err, '复制诊断信息失败');
          }
        }, { small: true, primary: true }),
        button('查看诊断', () => diagnosticsDialog(), { small: true })
      ])
    );
    body.appendChild(field('字幕缓存保留天数', numberInput(store.get().settings.cache.subtitleTtlDays, (v) => { d.cache.subtitleTtlDays = Math.max(0, v); markDirty(); }, { min: 0, max: 999 })));
    body.appendChild(checkbox(d.cache.keepAudio, (v) => { d.cache.keepAudio = v; markDirty(); }, '保留音频分块（默认关闭，避免占用空间）'));
  });
}

async function refreshTabs() {
  try {
    const out = await call('page.refresh');
    store.set({ contentTabs: out.tabs || [] });
    render();
  } catch (err) {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// 保存 / 重置
// ---------------------------------------------------------------------------

async function persistDraft(opts = {}) {
  const d = draft();
  const saved = await saveSettings(d);
  state.draft = structuredCloneSafe(saved);
  state.dirty = false;
  renderToolbar();
  return saved;
}

async function save() {
  try {
    await persistDraft({ silent: true });
    const saved = await call('settings.get');
    store.set({ settings: saved, readiness: saved.__readiness || { ok: {}, issues: [] } });
    toast({ title: '设置已保存', detail: '密钥等敏感信息只保存在本机。' }, 'ok');
    render();
  } catch (err) {
    showError(err, '保存设置失败');
  }
}

async function reload() {
  const saved = await loadSettings();
  state.draft = structuredCloneSafe(saved);
  state.dirty = false;
  store.set({ settings: saved, readiness: saved.__readiness || { ok: {}, issues: [] } });
  render();
  toast({ title: '已放弃未保存的改动' }, 'ok', 1600);
}

function resetAll() {
  confirmDialog('重置全部设置', '会把所有平台、提示词、规则组恢复为默认值（API Key 也会被清空）。确定继续？', async () => {
    const saved = await call('settings.reset');
    state.draft = structuredCloneSafe(saved);
    state.dirty = false;
    store.set({ settings: saved, readiness: saved.__readiness || { ok: {}, issues: [] } });
    render();
    toast({ title: '已重置为默认设置' }, 'ok');
  });
}

// ---------------------------------------------------------------------------
// 诊断浮层
// ---------------------------------------------------------------------------

export async function diagnosticsDialog() {
  const body = h('div');
  body.appendChild(h('div', { class: 'note', text: '加载中…' }));
  const ov = openOverlay('诊断信息', body, [
    {
      label: '复制全部',
      primary: true,
      onClick: async () => {
        try {
          const diag = await call('diagnostics');
          await copyText(JSON.stringify(diag, null, 2));
          toast({ title: '已复制' }, 'ok');
        } catch (err) {
          showError(err);
        }
      }
    },
    { label: '关闭', onClick: () => closeOverlays() }
  ], { width: '520px' });
  try {
    const diag = await call('diagnostics');
    store.set({ diagnostics: diag });
    clear(body);
    const rows = [
      ['扩展版本', `${diag.extensionVersion}（Manifest V${diag.manifestVersion}）`],
      ['内容脚本版本', diag.contentVersion],
      ['模块数 / 构建时间', `${diag.modules} / ${diag.buildTime}`],
      ['缓存', `字幕 ${diag.cache.subtitleCount} 条（${fmtBytes(diag.cache.approxBytes)}）· 音频 ${diag.cache.audioCount} · 历史 ${diag.cache.historyCount}`],
      ['用户代理', diag.userAgent]
    ];
    for (const [k, v] of rows) body.appendChild(h('div', { class: 'kv' }, [h('span', { class: 'kv-key', text: k }), h('span', { class: 'kv-val', text: String(v) })]));
    body.appendChild(h('div', { class: 'section-title', text: '平台配置（密钥只显示是否已配置）' }));
    for (const [kind, list] of Object.entries(diag.platformSummary || {})) {
      for (const p of list) {
        body.appendChild(
          h('div', { class: 'kv' }, [
            h('span', { class: 'kv-key', text: `${kind} · ${p.name}${p.active ? '（当前）' : ''}` }),
            h('span', { class: 'kv-val', text: `Key:${p.keySet ? '已配置' : '未配置'} 模型:${p.model || '-'} 地址:${p.baseUrl || '-'}` })
          ])
        );
      }
    }
    body.appendChild(h('div', { class: 'section-title', text: '已授权域名' }));
    for (const o of (diag.permissions && diag.permissions.origins) || []) {
      body.appendChild(h('div', { class: 'kv-val', text: o }));
    }
  } catch (err) {
    clear(body);
    body.appendChild(h('div', { text: '读取诊断信息失败：' + (err.payload?.detail || err.message) }));
  }
  return ov;
}
