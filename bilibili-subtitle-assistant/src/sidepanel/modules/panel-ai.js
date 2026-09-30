// AI 面板：总结（流式 + Markdown 真正渲染）、对话（流式 + 渲染 + 重置 + 建议问题 +
// 拖拽导入文件），生成中可中止。

import { h, clear, button, fmtTime, toast, copyText, setBoolAttr } from './dom.js';
import { store } from './store.js';
import { app, showError, saveHistory, doProviderSearch, doEngineSearch, recountCitations, activePromptText } from './context.js';
import { renderMarkdownInto, renderInline } from './markdown.js';
import { selectContext, linesToTranscript } from './subtitles.js';
import { searchContextBlockGuarded, engineLabel } from './search.js';
import { Stream } from './bridge.js';
import { promptDialog } from './ui.js';

const SUGGESTIONS = [
  '用 5 句话总结这期视频',
  '列出本期提到的所有数字与结论',
  '有哪些值得立刻行动的建议？',
  '用表格整理主要观点及其依据',
  '这期视频有哪些专有名词需要留意？',
  '把内容整理成学习笔记大纲'
];

const state = {
  root: null,
  summaryHost: null,
  chatHost: null,
  inputHost: null,
  attachments: [],
  // 当前选中的技能（Skill）。发送消息时会把它作为附加指令带上。
  activeSkillId: null,
  streaming: false,
  stream: null,
  summaryStreaming: false,
  lastSignature: ''
};

// ---------------------------------------------------------------------------
// 挂载
// ---------------------------------------------------------------------------

export function init(container) {
  const root = h('div', { class: 'pane', style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' } });
  const toolbar = h('div', { class: 'pane-toolbar', id: 'ai-toolbar' });
  const scrollHost = h('div', { class: 'scroll-host', id: 'ai-scroll' });
  const body = h('div', { class: 'ai-scroll' });
  scrollHost.appendChild(body);
  const inputWrap = h('div', { class: 'chat-input-wrap', id: 'chat-input-wrap' });

  root.appendChild(toolbar);
  root.appendChild(scrollHost);
  root.appendChild(inputWrap);
  container.appendChild(root);

  state.root = root;
  state.summaryHost = h('div', { id: 'summary-host' });
  state.chatHost = h('div', { class: 'chat-list', id: 'chat-host' });
  body.appendChild(h('div', { class: 'section-title', text: 'AI 总结' }));
  body.appendChild(state.summaryHost);
  body.appendChild(h('div', { class: 'section-title', text: '与 AI 对话' }));
  body.appendChild(state.chatHost);

  scrollHost.addEventListener('scroll', () => {
    store.setScroll('ai', scrollHost.scrollTop);
  });
  state.scrollHost = scrollHost;

  setupDropZone(root, inputWrap);

  render();
  requestAnimationFrame(() => {
    scrollHost.scrollTop = store.scrollOf('ai', 0);
  });
  return {
    render,
    focusInput,
    sendPending,
    generateSummary,
    sendMessage,
    resetChat,
    stopStream,
    copySummary
  };
}

function setupDropZone(root, inputWrap) {
  const hint = document.getElementById('drag-hint');
  let depth = 0;
  const show = (on) => {
    setBoolAttr(inputWrap, 'data-drop', on);
    if (hint) {
      setBoolAttr(hint, 'data-visible', on);
      hint.style.display = on ? 'flex' : 'none';
    }
  };
  root.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth += 1;
    show(true);
  });
  root.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  root.addEventListener('dragleave', (e) => {
    e.preventDefault();
    depth = Math.max(0, depth - 1);
    if (!depth) show(false);
  });
  root.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    show(false);
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (!files.length) return;
    await addFiles(files);
  });
}

// ---------------------------------------------------------------------------
// 文件导入（图片、文本等）
// ---------------------------------------------------------------------------

async function addFiles(files) {
  for (const file of files) {
    try {
      const item = await readFileAsAttachment(file);
      if (item) state.attachments.push(item);
    } catch (err) {
      toast({ title: `无法读取 ${file.name}`, detail: String(err.message || err) }, 'warn');
    }
  }
  renderInput();
  toast({ title: `已加入 ${state.attachments.length} 个附件`, detail: '发送时会一并提交给 AI' }, 'ok', 1800);
}

async function readFileAsAttachment(file) {
  const type = file.type || '';
  if (type.startsWith('image/')) {
    const dataUrl = await downscaleImage(file, 1280, 0.82);
    return { kind: 'image', name: file.name, size: file.size, dataUrl, mime: 'image/jpeg' };
  }
  const textTypes = ['text/', 'application/json', 'application/xml', 'application/x-subrip'];
  const looksText = textTypes.some((t) => type.startsWith(t)) || /\.(txt|md|markdown|json|csv|srt|vtt|log|yaml|yml)$/i.test(file.name);
  if (looksText || file.size < 512 * 1024) {
    const text = await file.text();
    return { kind: 'text', name: file.name, size: file.size, text: text.slice(0, 20000) };
  }
  // 其它二进制：只记录名字，提示无法读取
  return { kind: 'binary', name: file.name, size: file.size };
}

function downscaleImage(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const hh = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = hh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, hh);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解码失败'));
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

export function render() {
  const st = store.get();
  if (!state.root) return;
  renderToolbar();
  renderSummary();
  renderChat();
  renderInput();
}

function renderToolbar() {
  const st = store.get();
  const bar = state.root.querySelector('#ai-toolbar');
  if (!bar) return;
  clear(bar);
  const hasLines = (st.subtitles || []).length > 0;
  bar.appendChild(
    button(state.summaryStreaming ? '生成中…' : '生成总结', () => generateSummary(), {
      small: true,
      primary: true,
      disabled: !hasLines || state.streaming,
      title: hasLines ? '按当前系统提示词生成总结' : '需要先有字幕'
    })
  );
  bar.appendChild(button('停止', () => stopStream(), { small: true, danger: true, disabled: !state.streaming }));
  bar.appendChild(button('复制总结', () => copySummary(), { small: true, disabled: !st.summary }));
  bar.appendChild(button('导出总结', () => exportSummary(), { small: true, disabled: !st.summary }));
  bar.appendChild(button('重置会话', () => resetChat(), { small: true }));
  bar.appendChild(h('span', { class: 'spacer' }));
  bar.appendChild(
    h('span', {
      class: 'muted',
      text: st.readiness?.ok?.ai ? '' : 'AI 未就绪'
    })
  );
}

function renderSummary() {
  const st = store.get();
  const host = state.summaryHost;
  if (!host) return;
  if (state.summaryStreaming) {
    setBoolAttr(host, 'data-streaming', true);
    host.textContent = '';
    const box = h('div', { class: 'summary-box', dataset: { streaming: 'true' } });
    const pre = h('pre', { class: 'plain-stream' });
    pre.textContent = st.summaryStream || '正在生成…';
    box.appendChild(pre);
    host.appendChild(box);
    return;
  }
  setBoolAttr(host, 'data-streaming', false);
  if (!st.summary) {
    host.textContent = '';
    host.appendChild(
      h('div', { class: 'empty', text: (st.subtitles || []).length ? '还没有总结。点上方「生成总结」。' : '「生成总结」需要先有字幕；但下方对话可以直接提问，不需要字幕。' })
    );
    return;
  }
  host.textContent = '';
  const box = h('div', { class: 'summary-box' });
  renderMarkdownInto(box, st.summary);
  // 章节列表（可点击跳转）
  const chapters = (st.video && st.video.chapters) || [];
  if (chapters.length) {
    const chapBox = h('div', { class: 'summary-box' });
    chapBox.appendChild(h('div', { class: 'section-title', text: '章节（点击跳转）' }));
    chapters.forEach((c) => {
      chapBox.appendChild(
        h('div', { class: 'row tight' }, [
          h('button', {
            class: 'btn btn-sm',
            type: 'button',
            text: fmtTime(c.start),
            title: '跳到这一章',
            onclick: () => app.panels.actions && app.panels.actions.seek(c.start)          }),
          h('span', { text: c.title }),
          c.summary ? h('span', { class: 'muted', text: c.summary }) : null
        ])
      );
    });
    host.appendChild(chapBox);
  }
  host.appendChild(box);
}

function renderChat() {
  const st = store.get();
  const host = state.chatHost;
  if (!host) return;
  host.textContent = '';
  if (!st.chat.length) {
    host.appendChild(h('div', { class: 'empty', text: '基于当前视频的字幕提问，回复会按 Markdown 渲染。' }));
  }
  for (const msg of st.chat) {
    const el = h('div', { class: 'msg', dataset: { role: msg.role } });
    el.appendChild(h('div', { class: 'msg-role', text: msg.role === 'user' ? '我' : msg.role === 'assistant' ? 'AI' : '系统' }));
    if (msg.role === 'assistant' && msg.streaming) {
      setBoolAttr(el, 'data-streaming', true);
      const pre = h('pre', { class: 'plain-stream' });
      pre.textContent = msg.text || '…';
      el.appendChild(pre);
    } else if (msg.role === 'user') {
      el.appendChild(h('div', { style: { whiteSpace: 'pre-wrap' }, text: msg.text }));
    } else {
      const body = h('div');
      renderMarkdownInto(body, msg.text || '');
      el.appendChild(body);
    }
    if (msg.attachments && msg.attachments.length) {
      const row = h('div', { class: 'attachments' });
      for (const a of msg.attachments) {
        if (a.kind === 'image') {
          const img = h('img', { class: 'md-img', src: a.dataUrl, alt: a.name, style: { maxHeight: '80px' } });
          row.appendChild(img);
        } else {
          row.appendChild(h('span', { class: 'attach', text: a.name }));
        }
      }
      el.appendChild(row);
    }
    host.appendChild(el);
  }
}

function renderInput() {
  const wrap = state.root.querySelector('#chat-input-wrap');
  if (!wrap) return;
  clear(wrap);
  if (state.attachments.length) {
    const row = h('div', { class: 'attachments' });
    state.attachments.forEach((a, i) => {
      const chip = h('span', { class: 'attach' }, [
        h('span', { text: `${a.kind === 'image' ? '🖼' : '📄'} ${a.name}` }),
        h('button', {
          type: 'button',
          text: '×',
          title: '移除',
          onclick: () => {
            state.attachments.splice(i, 1);
            renderInput();
          }
        })
      ]);
      row.appendChild(chip);
    });
    wrap.appendChild(row);
  }

  const suggest = h('div', { class: 'suggestions' });
  for (const s of SUGGESTIONS.slice(0, 4)) {
    suggest.appendChild(h('button', { class: 'q-btn', type: 'button', text: s, onclick: () => sendMessage(s) }));
  }
  wrap.appendChild(suggest);

  const row = h('div', { class: 'row tight' });
  const area = h('textarea', {
    class: 'input',
    id: 'chat-input',
    placeholder: (store.get().subtitles || []).length
      ? '基于这期视频提问…（Ctrl+Enter 发送，可粘贴或拖入图片 / 文本文件）'
      : '直接提问即可 —— 没有字幕也能聊（可联网、可上传文件、可调用 MCP 工具）',
    style: { flex: '1 1 auto', minHeight: '52px' }
  });
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendMessage(area.value);
      area.value = '';
    }
  });
  area.addEventListener('paste', async (e) => {
    const items = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (items.length) {
      e.preventDefault();
      await addFiles(items);
    }
  });
  row.appendChild(area);
  const col = h('div', { class: 'row tight' }, [
    button('发送', () => {
      sendMessage(area.value);
      area.value = '';
    }, { small: true, primary: true }),
    button('停止', () => stopStream(), { small: true, danger: true, disabled: !state.streaming })
  ]);
  row.appendChild(col);
  wrap.appendChild(row);

  // ---- 工具条：上传文件 / 联网 / Skills / MCP + 模型切换 ----
  wrap.appendChild(buildChatToolbar());
  state.inputArea = area;
}

// 对话输入区下方的工具条。
// 四个图标分别是：📎 上传文件、🌐 联网、✨ Skills、🔌 MCP；
// 右侧是当前模型下拉（可直接切换已配置的 AI 平台 / 模型）。
function buildChatToolbar() {
  const st = store.get();
  const s = st.settings || {};
  // 首次渲染时 settings 可能还没加载好 —— 工具条退化为「只有上传文件」，
  // 不要让整个对话面板挂掉。
  const search = s.search || {};
  const skills = s.skills || { items: [] };
  const mcp = s.mcp || { enabled: false, servers: [] };
  const ai = s.ai || { platforms: [] };
  const bar = h('div', { class: 'chat-toolbar' });

  // 📎 上传文件
  const fileInput = h('input', {
    type: 'file',
    multiple: true,
    style: { display: 'none' }
  });
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    if (files.length) await addFiles(files);
    fileInput.value = '';
  });
  bar.appendChild(fileInput);
  bar.appendChild(
    iconBtn('📎', '上传文件（也可直接拖入或粘贴）', () => fileInput.click(), {
      badge: state.attachments.length ? String(state.attachments.length) : ''
    })
  );

  // 🌐 联网
  const webOn = search.autoSearchOnChat !== false || search.alwaysSearchOnChat === true;
  bar.appendChild(
    iconBtn('🌐', webOn ? '联网：开（点击关闭）' : '联网：关（点击开启）', () => {
      const cur = store.get().settings;
      const next = !(cur.search.autoSearchOnChat !== false || cur.search.alwaysSearchOnChat === true);
      updateSettings((cfg) => {
        cfg.search.autoSearchOnChat = next;
        if (!next) cfg.search.alwaysSearchOnChat = false;
      });
      toast({ title: next ? '已开启联网' : '已关闭联网', detail: next ? '提问涉及外部信息时会自动检索网页' : '对话将只基于字幕回答' }, 'ok', 2500);
      render();
    }, { active: webOn })
  );

  // ✨ Skills
  const skillCount = (skills.items || []).length;
  bar.appendChild(
    iconBtn('✨', `Skills（${skillCount} 个可用）`, () => openSkillPicker(), { active: !!state.activeSkillId, badge: state.activeSkillId ? '1' : '' })
  );

  // 🔌 MCP
  const mcpOn = !!mcp.enabled;
  const mcpCount = (mcp.servers || []).filter((x) => x.enabled !== false).length;
  bar.appendChild(
    iconBtn('🔌', mcpOn ? `MCP：开（${mcpCount} 个服务）` : 'MCP：关（点击开启）', () => {
      const cur = store.get().settings;
      const next = !(cur.mcp && cur.mcp.enabled);
      updateSettings((cfg) => {
        cfg.mcp.enabled = next;
      });
      toast({
        title: next ? '已开启 MCP' : '已关闭 MCP',
        detail: next ? (mcpCount ? '下次提问将把工具交给模型' : '还没有配置服务，请到 设置 → MCP 服务 添加') : '模型将不再调用外部工具'
      }, next && !mcpCount ? 'warn' : 'ok', 3500);
      render();
    }, { active: mcpOn, disabled: false })
  );

  // 模型切换
  const platforms = ai.platforms || [];
  const cur = platforms.find((p) => p.id === ai.activeId) || platforms[0];
  const sel = h('select', { class: 'model-select', title: '切换 AI 平台 / 模型' });
  for (const p of platforms) {
    const models = Array.isArray(p.models) && p.models.length ? p.models : [p.model].filter(Boolean);
    for (const m of models) {
      const opt = h('option', { value: `${p.id}::${m}`, text: `${p.id === ai.activeId ? '' : `${p.name} · `}${m}` });
      if (p.id === (cur && cur.id) && m === (cur && cur.model)) opt.selected = true;
      sel.appendChild(opt);
    }
  }
  sel.addEventListener('change', () => {
    const [pid, model] = String(sel.value).split('::');
    updateSettings((cfg) => {
      cfg.ai.activeId = pid;
      const target = cfg.ai.platforms.find((x) => x.id === pid);
      if (target && model) target.model = model;
    });
    toast({ title: '已切换模型', detail: `${pid} · ${model}` }, 'ok', 2200);
    render();
  });
  bar.appendChild(sel);

  return bar;
}

function iconBtn(icon, title, onclick, opts = {}) {
  const b = h('button', {
    class: `chat-icon${opts.active ? ' active' : ''}`,
    type: 'button',
    title,
    text: icon,
    onclick
  });
  if (opts.disabled) b.disabled = true;
  if (opts.badge) b.appendChild(h('span', { class: 'chat-icon-badge', text: opts.badge }));
  return b;
}

// 对话界面里的小开关（联网 / MCP / 模型）需要即时生效并持久化。
// 设置页的草稿机制在这里不适用（用户期望点一下立刻生效），所以直接改后保存。
async function updateSettings(mutator) {
  const st = store.get();
  const next = structuredCloneSafe(st.settings);
  mutator(next);
  delete next.__readiness;
  store.set({ settings: next });
  try {
    await call('settings.set', { settings: next });
  } catch (err) {
    toast({ title: '设置保存失败', detail: (err && err.message) || '稍后可在设置页重试' }, 'warn', 3500);
  }
}

function structuredCloneSafe(v) {
  try {
    return structuredClone(v);
  } catch (err) {
    return JSON.parse(JSON.stringify(v));
  }
}

// ---------------------------------------------------------------------------
// 判断「联网能力」的真实状态。对话与总结共用，避免两处判断不一致。
export function searchCapabilityOf(settings) {
  const search = (settings && settings.search) || {};
  const platforms = search.platforms || [];
  const active = platforms.find((p) => p.id === search.activeId) || platforms[0] || null;
  const hasSearchKey = !!(active && String(active.apiKey || '').trim());
  const keylessOn = search.keylessFallback !== false;
  return {
    active,
    hasSearchKey,
    keylessOn,
    webCapable: hasSearchKey || keylessOn,
    searchOn: search.autoSearchOnChat !== false,
    alwaysSearch: search.alwaysSearchOnChat === true,
    providerName: active ? active.name || '' : ''
  };
}

// 能力自述
// ---------------------------------------------------------------------------

// 拼出「我当前有什么能力」这一段系统提示。
//
// 为什么需要：用户问「你能不能联网」时，模型原本只能凭训练印象猜，
// 于是答「我是语言模型，不能联网」—— 而扩展明明可以联网。
// 根因是**模型看不到自己的运行时能力**（联网开关、检索结果、MCP 工具）。
// 这里把当前真实状态如实告诉它，能力类问题才能答对。
//
// 原则：只描述**此刻确实成立**的事实，绝不夸大 ——
// 不能说「你可以联网」而实际上关了联网。
export function buildCapabilityBlock(info = {}) {
  const {
    webCapable = false,
    searchOn = true,
    alwaysSearch = false,
    hasSearchKey = false,
    searchProviderName = '',
    searchUsed = false,
    searchResultCount = 0,
    searchFailNote = '',
    hasSubtitles = false,
    subtitleCount = 0,
    attachmentCount = 0,
    mcpOn = false,
    mcpServerCount = 0,
    skillsCount = 0,
    activeSkill = ''
  } = info;

  const lines = [];
  lines.push('【你当前的能力（这是事实描述；关于「你能不能…」的问题请据此回答，不要凭训练印象否认）】');

  // 联网
  if (webCapable && searchOn) {
    const channel = hasSearchKey
      ? `已配置检索平台${searchProviderName ? `（${searchProviderName}）` : ''}`
      : '使用免费检索引擎（Bing / AnySearch / Exa，无需 Key）';
    lines.push(
      `· 联网检索：**可用**（${channel}）。${
        alwaysSearch ? '本轮对话已自动检索网页' : '当提问涉及外部信息时（最新、是谁、多少钱、查一下等）会自动检索网页'
      }，检索结果会作为参考资料附在下面。`
    );
  } else if (webCapable && !searchOn) {
    lines.push('· 联网检索：**用户已关闭**（对话区的 🌐 开关处于关闭状态）。需要时请提示用户打开它。');
  } else {
    lines.push(
      '· 联网检索：**当前不可用**（既没有配置检索平台的 Key，也关闭了免费引擎兜底）。' +
        '如果用户需要联网，请引导他到 设置 → 联网检索 填 Key 或开启「免费引擎兜底」。'
    );
  }
  if (searchFailNote) {
    lines.push(`  └ 注意：本轮尝试联网但失败了（${searchFailNote}），所以这次没有网页资料可用。`);
  } else if (searchUsed && searchResultCount) {
    lines.push(`  └ 本轮已检索到 ${searchResultCount} 条来源，已附在下方「联网检索到的参考资料」里。`);
  }

  // 视频字幕
  if (hasSubtitles) {
    lines.push(`· 视频字幕：**已加载**（${subtitleCount} 行），已在下方给出原文，你可以基于视频内容回答。`);
  } else {
    lines.push('· 视频字幕：**尚未加载**，所以你现在看不到视频内容；不要编造视频里说过的话。');
  }

  // 附件
  if (attachmentCount > 0) {
    lines.push(`· 用户本轮上传了 ${attachmentCount} 个文件/图片，已作为消息附件发送。`);
  }

  // MCP 工具
  if (mcpOn && mcpServerCount > 0) {
    lines.push(
      `· 外部工具（MCP）：**已启用**，连接了 ${mcpServerCount} 个服务。` +
        '你能调用的工具见请求里的 tools 定义；需要外部数据或操作时请直接调用，不要声称自己做不到。'
    );
  } else if (mcpServerCount > 0) {
    lines.push('· 外部工具（MCP）：已配置但**用户关闭了**（对话区的 🔌 开关）。');
  } else {
    lines.push('· 外部工具（MCP）：未配置。');
  }

  // Skills
  if (activeSkill) {
    lines.push(`· 技能：本轮已选定「${activeSkill}」，请按该技能的正文要求执行。`);
  } else if (skillsCount > 0) {
    lines.push(`· 技能：有 ${skillsCount} 个可用技能（对话区点 ✨ 选择），本轮未选定。`);
  }

  lines.push(
    '注意：上面只是「这个浏览器扩展能给模型提供什么」。' +
      '你本身仍然是语言模型；请准确区分「我能推理」与「这个扩展给我接了联网/工具」。'
  );
  return lines.join('\n');
}

// Skills 选择面板
function openSkillPicker() {
  const s = store.get().settings || {};
  const overlay = h('div', { class: 'skill-overlay' });
  const box = h('div', { class: 'skill-box' });
  box.appendChild(h('div', { class: 'skill-head', text: '选择技能（点击即填入并发送）' }));
  box.appendChild(
    h('button', {
      class: 'q-btn',
      type: 'button',
      text: '✖ 不使用技能',
      onclick: () => {
        state.activeSkillId = null;
        overlay.remove();
        render();
      }
    })
  );
  for (const sk of (s.skills && s.skills.items) || []) {
    const item = h('button', {
      class: `skill-item${state.activeSkillId === sk.id ? ' active' : ''}`,
      type: 'button',
      onclick: () => {
        state.activeSkillId = sk.id;
        overlay.remove();
        const area = state.inputArea;
        const text = area && area.value.trim() ? `${sk.body}\n\n${area.value.trim()}` : sk.body;
        if (area) area.value = '';
        sendMessage(text);
        render();
      }
    });
    item.appendChild(h('span', { class: 'skill-icon', text: sk.icon || '✨' }));
    const mid = h('span', { class: 'skill-mid' });
    mid.appendChild(h('span', { class: 'skill-name', text: sk.name || sk.id }));
    if (sk.desc) mid.appendChild(h('span', { class: 'skill-desc', text: sk.desc }));
    item.appendChild(mid);
    box.appendChild(item);
  }
  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  render();
}

export function focusInput() {
  if (state.inputArea) state.inputArea.focus();
}

export function sendPending() {
  const st = store.get();
  const last = st.chat[st.chat.length - 1];
  if (last && last.role === 'user') {
    // 由 askAboutLine 预置了问题：直接发送最后一条用户消息
    sendMessage(last.text, { alreadyInHistory: true });
  }
}

// ---------------------------------------------------------------------------
// 总结
// ---------------------------------------------------------------------------

export async function generateSummary() {
  const st = store.get();
  if (!(st.subtitles || []).length) {
    toast(
      {
        title: '生成总结需要字幕',
        detail: '请先抓取官方字幕或做语音转录。如果只是想提问，直接在下方对话框输入即可（不需要字幕）。'
      },
      'warn',
      5000
    );
    return;
  }
  const settings = st.settings;
  const promptText = activePromptText();
  const ctx = selectContext(st.subtitles, '', 40000);
  const searchBlock = searchContextBlockGuarded(st.search.results || [], st.search.counts);
  // 若在对话区选过技能，总结也按该技能的指令走
  const activeSkill = ((settings.skills && settings.skills.items) || []).find((x) => x.id === state.activeSkillId);
  // 总结也带上能力自述：用户可能在总结里问「这个结果是联网查的吗」
  const cap = searchCapabilityOf(settings);
  const capBlock = buildCapabilityBlock({
    webCapable: cap.webCapable,
    searchOn: cap.searchOn,
    hasSearchKey: cap.hasSearchKey,
    searchProviderName: cap.providerName,
    searchResultCount: (st.search.results || []).length,
    hasSubtitles: (st.subtitles || []).length > 0,
    subtitleCount: (st.subtitles || []).length,
    mcpOn: !!(settings.mcp && settings.mcp.enabled),
    mcpServerCount: ((settings.mcp && settings.mcp.servers) || []).filter((x) => x.enabled !== false).length,
    skillsCount: ((settings.skills && settings.skills.items) || []).length,
    activeSkill: activeSkill ? activeSkill.name : ''
  });
  const messages = [
    {
      role: 'system',
      content: [
        activeSkill ? `${promptText}\n\n【当前技能：${activeSkill.name}】\n${activeSkill.body}` : promptText,
        capBlock
      ].filter(Boolean).join('\n\n')
    },
    {
      role: 'user',
      content: [
        st.video ? `视频：${st.video.title || ''}${st.video.partTitle ? ` · ${st.video.partTitle}` : ''}` : '',
        st.video && st.video.owner ? `UP：${st.video.owner}` : '',
        st.video && st.video.duration ? `时长：${fmtTime(st.video.duration)}` : '',
        '下面是这期视频的字幕原文：',
        ctx.text,
        searchBlock
      ]
        .filter(Boolean)
        .join('\n\n')
    }
  ];
  if (searchBlock) {
    // 检索结果作为依据进入上下文
    messages.push({ role: 'system', content: '回答时如引用了「参考资料」，请在正文里用 [来源 N] 标注。' });
  }

  state.summaryStreaming = true;
  state.streaming = true;
  store.set({ summaryStream: '' });
  render();
  const stream = new Stream();
  state.stream = stream;
  stream.start(
    'ai.summarize',
    { messages, platformId: settings.ai.activeId, temperature: settings.ai.temperature, maxTokens: settings.ai.maxTokens },
    {
      onDelta: (text) => {
        const cur = store.get();
        store.set({ summaryStream: (cur.summaryStream || '') + text });
        renderSummary();
        scrollAiBottom();
      },
      onEnd: async () => {
        const finalText = store.get().summaryStream || '';
        state.summaryStreaming = false;
        state.streaming = false;
        state.stream = null;
        store.set({ summary: finalText, summaryStream: '' });
        recountCitations(finalText);
        await saveHistory();
        render();
        toast({ title: '总结完成', detail: `已按 Markdown 渲染（${finalText.length} 字）` }, 'ok');
      },
      onError: (payload) => {
        state.summaryStreaming = false;
        state.streaming = false;
        state.stream = null;
        const partial = store.get().summaryStream || '';
        if (partial) {
          store.set({ summary: partial, summaryStream: '' });
          toast({ title: '总结中断，已保留已生成的部分', detail: payload.detail }, 'warn', 5000);
        } else {
          showError(Object.assign(new Error(payload.title), { payload }));
        }
        render();
      }
    }
  );
}

function stopStream() {
  if (state.stream) {
    state.stream.cancel();
    toast({ title: '已请求终止生成' }, 'warn', 1500);
  }
}

async function copySummary() {
  const st = store.get();
  await copyText(st.summary || '');
  toast({ title: '已复制总结' }, 'ok', 1500);
}

async function exportSummary() {
  const st = store.get();
  const { downloadFile } = await import('./dom.js');
  const name = `${(st.video?.title || '视频').replace(/[\\/:*?"<>|]/g, '_')}-总结.md`;
  downloadFile(name, st.summary || '', 'text/markdown;charset=utf-8');
  toast({ title: `已导出 ${name}` }, 'ok');
}

// ---------------------------------------------------------------------------
// 对话
// ---------------------------------------------------------------------------

export function resetChat() {
  if (state.streaming) stopStream();
  store.set({ chat: [] });
  render();
  toast({ title: '会话已重置', detail: '字幕与总结不受影响。' }, 'ok');
}

export async function sendMessage(text, opts = {}) {
  const question = String(text || '').trim();
  if (!question) return;
  const st = store.get();
  if (!st.readiness?.ok?.ai) {
    const issue = (st.readiness?.issues || []).find((i) => i.area === 'ai');
    showError(
      Object.assign(new Error('AI 未配置'), {
        payload: {
          kind: 'nokey',
          title: 'AI 暂时不可用',
          detail: issue ? issue.text : '当前 AI 平台缺少 API Key、模型或接口地址。',
          action: '打开 设置 → AI 平台，补齐配置后点「测试连接」。'
        }
      })
    );
    return;
  }
  // 字幕不是必须的 —— 没有字幕时也能正常对话（纯问答 / 联网检索 /
  // 归纳粘贴内容 / 调用 MCP 工具）。有字幕时才把字幕作为上下文附加。
  const hasSubtitles = (st.subtitles || []).length > 0;

  const attachments = state.attachments.slice();
  state.attachments = [];
  const history = opts.alreadyInHistory ? st.chat : [...st.chat, { role: 'user', text: question, attachments }];
  if (opts.alreadyInHistory) {
    history[history.length - 1] = { ...history[history.length - 1], attachments };
  }
  const placeholderIndex = history.length;
  store.set({ chat: [...history, { role: 'assistant', text: '', streaming: true }] });
  state.streaming = true;
  render();
  scrollAiBottom();

  const settings = st.settings;
  const ctx = selectContext(st.subtitles, question, 30000);

  // 「联网到底能不能用」的真实判断：
  //   配了检索平台的 Key        → 能（走用户的正式渠道）
  //   没配 Key 但开了免费引擎兜底 → 也能（Bing/AnySearch/Exa）
  //   两者都没有                 → 真的不能
  const cap = searchCapabilityOf(settings);

  // 对话时按需自动检索。
  // 之前这里只是读取 `st.search.results`（上一次搜索结果），
  // 也就是说**必须先前手动搜过一次**才会有资料 —— 对话本身从不联网，
  // 用户看到的自然就是「对话不能联网」。
  let searchResults = st.search.results || [];
  let searchUsed = false;
  let searchFailNote = '';
  if (settings.search.autoSearchOnChat !== false && question) {
    const needsWeb = /最新|现在|目前|今年|今天|新闻|价格|多少人|是谁|什么时候|为什么|查一下|搜一下|官网|地址|链接|资料|出处|来源|对比|区别|多少|几点|哪一年/i.test(
      question
    );
    // 问题里有明显的外部信息需求时，或用户希望每轮都搜时，才真正发起检索
    const shouldSearch = needsWeb || settings.search.alwaysSearchOnChat === true;
    if (shouldSearch && !cap.webCapable) {
      // 明确告知「为什么没联网」，而不是静默跳过
      toast(
        {
          title: '未能联网：没有可用的检索方式',
          detail: '打开 设置 → 联网检索，填入 Key，或开启「免费引擎兜底」（无需 Key 即可联网）。'
        },
        'warn',
        6000
      );
    } else if (shouldSearch) {
      try {
        // 复用已有的检索流程（它自己会写回 store.search）
        await doProviderSearch(question);
        const after = store.get().search || {};
        if (Array.isArray(after.results) && after.results.length) {
          searchResults = after.results;
          searchUsed = true;
        }
      } catch (err) {
        // 检索失败不影响对话本身，但要让模型知道「这次没查到」
        const detail = (err && err.payload && err.payload.title) || (err && err.message) || '检索失败';
        searchFailNote = detail;
        toast({ title: '联网检索失败，已跳过', detail }, 'warn', 3500);
      }
    }
  }
  const searchBlock = searchContextBlockGuarded(searchResults, store.get().search.counts);
  // 系统提示按「有没有字幕」分两种形态。
  // 没有字幕时不再注入空字幕块，并如实告知模型当前没有字幕 ——
  // 这样它不会瞎编视频内容，而是当作普通问答来回答。
  const systemParts = [activePromptText(), settings.prompt.chatPrefix || ''];

  // ---- 能力自述 ----
  // 用户问「你能不能联网」时，模型只能凭训练印象猜，然后答「不能」——
  // 因为它**看不到**扩展里其实有联网开关和检索结果。
  // 这里把「当前实际可用的能力」如实告诉它，它才能正确回答能力类问题。
  systemParts.push(
    buildCapabilityBlock({
      webCapable: cap.webCapable,
      searchOn: cap.searchOn,
      alwaysSearch: cap.alwaysSearch,
      hasSearchKey: cap.hasSearchKey,
      keylessOn: cap.keylessOn,
      searchProviderName: searchUsed ? store.get().search.provider || '' : '',
      searchUsed,
      searchResultCount: (searchResults || []).length,
      searchFailNote,
      hasSubtitles,
      subtitleCount: (st.subtitles || []).length,
      attachmentCount: attachments.length,
      mcpOn: !!(settings.mcp && settings.mcp.enabled),
      mcpServerCount: ((settings.mcp && settings.mcp.servers) || []).filter((x) => x.enabled !== false).length,
      skillsCount: ((settings.skills && settings.skills.items) || []).length,
      activeSkill: (((settings.skills && settings.skills.items) || []).find((x) => x.id === state.activeSkillId) || {}).name || ''
    })
  );

  if (hasSubtitles) {
    if (ctx.truncated) systemParts.push('（字幕较长，已按与问题的相关性截取）');
    systemParts.push(`【视频字幕原文】\n${ctx.text}`);
  } else {
    systemParts.push(
      '【当前没有这期视频的字幕】\n' +
        '用户尚未提取字幕。请把它当作普通对话来回答：可以凭借你已有的知识、联网检索结果或用户提供的内容作答；' +
        '不要编造视频里没有出现过的具体内容。'
    );
  }
  if (searchBlock) systemParts.push(searchBlock);
  const messages = [
    {
      role: 'system',
      content: systemParts.filter(Boolean).join('\n\n')
    }
  ];
  const recent = history.filter((m) => m.role !== 'system').slice(-14);
  for (const m of recent) {
    if (m === history[history.length - 1] && m.role === 'user') {
      messages.push({ role: 'user', content: buildUserContent(m.text, attachments) });
    } else {
      messages.push({ role: m.role, content: m.text });
    }
  }

  const stream = new Stream();
  state.stream = stream;
  const streamedTools = [];
  stream.start(
    'ai.chat',
    { messages, platformId: settings.ai.activeId, temperature: settings.ai.temperature, maxTokens: settings.ai.maxTokens },
    {
      // MCP 工具运行时，服务端会先推来一段「工具调用过程」文本；这里把它
      // 折叠成一行留痕，而不是混进正文 —— 用户能看到「模型动了手」，
      // 又不影响阅读回答。
      onTool: (ev) => {
        streamedTools.push(ev);
      },
      onDelta: (text2) => {
        const cur = store.get();
        const chat = [...cur.chat];
        const last = chat[chat.length - 1];
        if (last && last.role === 'assistant') {
          const prefix = streamedTools.length && !last.toolTrace
            ? `> 🔧 已调用工具：${streamedTools.map((x) => x.name).join('、')}\n\n`
            : '';
          chat[chat.length - 1] = {
            ...last,
            toolTrace: streamedTools.length ? streamedTools.map((x) => x.name) : last.toolTrace,
            text: (last.text || '') + (prefix || '') + text2
          };
          store.set({ chat });
        }
        renderChat();
        scrollAiBottom();
      },
      onEnd: async () => {
        const cur = store.get();
        const chat = [...cur.chat];
        const last = chat[chat.length - 1];
        if (last && last.role === 'assistant') chat[chat.length - 1] = { ...last, streaming: false };
        state.streaming = false;
        state.stream = null;
        store.set({ chat });
        recountCitations(chat.map((c) => c.text).join('\n'));
        render();
        await saveHistory();
      },
      onError: (payload) => {
        const cur = store.get();
        const chat = [...cur.chat];
        const last = chat[chat.length - 1];
        if (last && last.role === 'assistant') {
          chat[chat.length - 1] = {
            ...last,
            streaming: false,
            text: (last.text || '') + `\n\n> ⚠️ ${payload.title}：${payload.detail || ''}`
          };
        }
        state.streaming = false;
        state.stream = null;
        store.set({ chat });
        render();
        if (!(last && last.text)) showError(Object.assign(new Error(payload.title), { payload }));
      }
    }
  );
}

function buildUserContent(text, attachments) {
  if (!attachments.length) return text;
  const parts = [{ type: 'text', text }];
  for (const a of attachments) {
    if (a.kind === 'image') parts.push({ type: 'image_url', image_url: { url: a.dataUrl } });
    else if (a.kind === 'text') parts.push({ type: 'text', text: `【附件 ${a.name}】\n${a.text}` });
    else parts.push({ type: 'text', text: `【附件 ${a.name}】（二进制文件，无法直接读取）` });
  }
  return parts;
}

function scrollAiBottom() {
  const host = state.scrollHost;
  if (!host) return;
  host.scrollTop = host.scrollHeight;
  store.setScroll('ai', host.scrollTop);
}
