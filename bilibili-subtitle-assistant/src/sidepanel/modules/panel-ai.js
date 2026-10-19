// AI 面板：总结（流式 + Markdown 真正渲染）、对话（流式 + 渲染 + 重置 + 建议问题 +
// 拖拽导入文件），生成中可中止。

import { h, clear, button, fmtTime, toast, copyText, setBoolAttr } from './dom.js';
import { store } from './store.js';
import { app, showError, saveHistory, doProviderSearch, doEngineSearch, recountCitations, activePromptText, setLines } from './context.js';
import { renderMarkdownInto, renderInline } from './markdown.js';
import { selectContext, linesToTranscript, fmtClock } from './subtitles.js';
import { searchContextBlockGuarded, engineLabel } from './search.js';
import * as OPT from './optimize.js';
import { extractVerifyItems, verifyItems, verifyContextBlock } from '../../shared/verify.js';
import { Stream, call } from './bridge.js';
import * as jobs from './jobs.js';
import { TASK_LABEL } from '../../shared/constants.js';
import { promptDialog, popoverMenu } from './ui.js';

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
  // 长视频「分段总结」不走流式；用 rid 让用户仍然能点「停止」，
  // 后台 cancel 会 abort 当前那段 ai.chat，下一次循环前检查标记退出。
  summaryRid: '',
  summaryAbortRequested: false,
  lastSignature: '',
  // 生成中排队的消息（当前回合结束后自动发出；中止则还回输入框）
  queue: [],
  // 思维链展开状态：用户点过就以他的选择为准，否则用设置里的默认值
  reasonOpen: null,
  reasonClosed: null
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
  const changed = (st.optimize && st.optimize.corrections ? st.optimize.corrections.length : 0) || 0;
  const canRevert = (st.subtitlesOriginal || []).length > 0 && hasLines;

  // 主操作 + 常用操作直接摆出来（用户要求：复制/导出/重置从 ⋯ 里拿出来）。
  // ⋯ 里只留低频的「回退字幕」（它需要先校对过才有意义）。
  //
  // 主按钮要**如实标出这次会不会先校对**：
  // 以前它永远叫「生成总结」，用户点下去才发现还要先联网核对、
  // 多花一轮 AI + 若干次检索。现在按当前设置直接写在按钮上。
  const searchCfg = (st.settings && st.settings.search) || {};
  const proofreadReady = searchCfg.verifyOnSummary !== false && searchCapabilityOf(st.settings || {}).webCapable;
  const willProofread = hasLines && proofreadReady;
  bar.appendChild(
    button(state.summaryStreaming ? '生成中…' : willProofread ? '生成总结（先校对）' : '生成总结', () => generateSummary(), {
      small: true,
      primary: true,
      disabled: !hasLines || state.streaming,
      title: hasLines
        ? willProofread
          ? '先联网校对字幕（术语/逻辑/时间/事实），再用更正后的字幕生成总结；想跳过请点「⚡ 快速总结」'
          : '直接用现有字幕生成总结（未开启联网校对，或检索不可用）'
        : '需要先有字幕'
    })
  );
  if (state.streaming || state.summaryStreaming) {
    bar.appendChild(button('停止', () => stopStream(), { small: true, danger: true }));
  }
  bar.appendChild(button('复制总结', () => copySummary(), { small: true, disabled: !st.summary, title: '复制总结全文（Markdown）' }));
  bar.appendChild(button('导出总结', () => exportSummary(), { small: true, disabled: !st.summary, title: '下载为 Markdown 文件' }));
  bar.appendChild(
    button('⚡ 快速总结', () => generateSummary({ skipProofread: true }), {
      small: true,
      disabled: !hasLines || state.streaming,
      title: '跳过联网校对，直接用现有字幕生成总结（更快，但不会修正字幕里的术语/时间/事实错误）'
    })
  );
  bar.appendChild(button('重置对话', () => resetChat(), { small: true, title: '清空对话历史（不影响字幕与总结）' }));
  bar.appendChild(
    popoverMenu(
      [
        {
          icon: '↩️',
          label: canRevert ? `回退字幕${changed ? `（已改 ${changed} 处）` : ''}` : '回退字幕',
          title: '把字幕恢复到 AI 更正之前的样子',
          disabled: !canRevert,
          onClick: () => revertSubtitles()
        }
      ],
      {
        label: '⋯',
        title: '更多操作',
        // 生成总结前这些都没有内容，点开只看到一片灰字会以为菜单坏了 ——
        // 与其留一堆禁用项，不如直接说清「先做什么」。
        emptyText: !hasLines ? '还没有字幕' : '暂无更多操作',
        emptyHint: !hasLines
          ? '先获取字幕或做语音转录'
          : '生成后这里会出现：复制 / 导出 / 回退字幕 / 重置会话'
      }
    )
  );
  bar.appendChild(h('span', { class: 'spacer' }));
  if (!st.readiness?.ok?.ai) bar.appendChild(h('span', { class: 'muted', text: 'AI 未就绪' }));
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

// 思维链折叠块。
//
// 参考 obsidian-yolo 的 AssistantMessageReasoning 设计：三个阶段
//   · requesting —— 已发出请求、还没吐字        →「正在请求…」
//   · thinking   —— 正在输出思维链、正文还没开始 →「思考中…」+ 单行滚动预览
//   · settled    —— 正文开始/结束               →「已思考 N 秒」，可展开看全文
//
// 关键：**默认折叠**。思维链动辄上千字，默认展开会把回答挤到屏幕外。
// 折叠时不渲染正文内容（yolo 也是这么做的：上万字的子树留着只是白占布局）。
export function buildReasoningBlock(msg) {
  const st = store.get();
  const text = String(msg.reasoning || '');
  const hasText = text.trim().length > 0;
  const streaming = !!msg.streaming;
  const hasAnswer = !!(msg.text && msg.text.trim());
  const stage = streaming && !hasText && !hasAnswer ? 'requesting' : streaming && !hasAnswer ? 'thinking' : 'settled';
  const expandedDefault = !!(st.settings && st.settings.ai && st.settings.ai.expandReasoning);
  // 用户手动点过就以用户的选择为准（同一会话内记住）
  const key = msg.reasonId || (msg.reasonId = `r${Math.random().toString(36).slice(2, 8)}`);
  const expanded = state.reasonOpen && state.reasonOpen.has(key) ? true : state.reasonClosed && state.reasonClosed.has(key) ? false : expandedDefault;

  const wrap = h('div', { class: `reason-block is-${stage}`, dataset: { stage } });
  const btn = h('button', { class: 'reason-head', type: 'button' });

  let label;
  if (stage === 'requesting') label = '正在请求…';
  else if (stage === 'thinking') label = '思考中…';
  else if (msg.reasonMs) label = `已思考 ${Math.max(1, Math.round(msg.reasonMs / 1000))} 秒`;
  else label = '思考过程';

  btn.appendChild(h('span', { class: 'reason-icon', text: stage === 'settled' ? '💭' : '🧠' }));
  btn.appendChild(h('span', { class: 'reason-label', text: label }));
  if (hasText) {
    btn.appendChild(h('span', { class: 'reason-chevron', text: expanded ? '▾' : '▸' }));
  }
  btn.disabled = !hasText;
  wrap.appendChild(btn);

  // 折叠时的单行滚动预览：让用户知道模型在想什么，又不占地方
  if (hasText && !expanded) {
    const preview = h('div', { class: 'reason-preview' });
    // 只取末尾一段（思考内容可能很长）
    const tail = text.replace(/\s+/g, ' ').trim().slice(-260);
    preview.textContent = tail;
    wrap.appendChild(preview);
  }

  // 展开态才挂载全文 —— 折叠时留着整棵子树只是白占布局
  if (hasText && expanded) {
    const body = h('div', { class: 'reason-body' });
    renderMarkdownInto(body, text);
    wrap.appendChild(body);
  }

  if (hasText) {
    btn.addEventListener('click', () => {
      state.reasonOpen = state.reasonOpen || new Set();
      state.reasonClosed = state.reasonClosed || new Set();
      if (expanded) {
        state.reasonOpen.delete(key);
        state.reasonClosed.add(key);
      } else {
        state.reasonClosed.delete(key);
        state.reasonOpen.add(key);
      }
      renderChat();
    });
  }
  return wrap;
}

// 「是否真的还在生成」。
//
// `state.streaming` 是个纯内存标志。如果某条流既没收到 onEnd、也没收到 onError
// （例如 service worker 被回收、页面被挂起、连接静默断开），这个标志会**永远卡在
// true** —— 后果是回车变成「排队」、发送按钮一直不可用，用户完全没法继续对话。
//
// 这里做个自愈：如果标志为 true，但既没有 stream 对象、又超过一段时间没有新内容，
// 就判定它已经失效并复位。
const BUSY_STALE_MS = 15000;
function isBusy() {
  if (!state.streaming) return false;
  const stale = !state.stream && Date.now() - (state.lastStreamActivity || 0) > BUSY_STALE_MS;
  if (stale) {
    state.streaming = false;
    state.stream = null;
  }
  return state.streaming;
}

function touchStream() {
  state.lastStreamActivity = Date.now();
}

// 测试用：把生成状态复位（真实环境里由 onEnd / onError 负责）
export function resetStreamStateForTest() {
  state.streaming = false;
  state.stream = null;
  state.queue = [];
  state.lastStreamActivity = 0;
}

// ---------------------------------------------------------------------------
// 消息级操作
// ---------------------------------------------------------------------------

function msgAction(label, onclick) {
  return h('button', { class: 'msg-action', type: 'button', text: label, onclick });
}

async function copyMessage(msg) {
  await copyText(msg.text || '');
  toast({ title: '已复制这条回复' }, 'ok', 1500);
}

// 重新生成：删掉这条 AI 回复及其之后的对话，用最后一条用户消息重跑
export async function regenerateAt(msg) {
  if (state.streaming) {
    toast({ title: '正在生成中，请先停止' }, 'warn', 2000);
    return;
  }
  const st = store.get();
  const idx = st.chat.indexOf(msg);
  if (idx < 0) return;
  // 往前找最近的用户消息
  let userIdx = -1;
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (st.chat[i].role === 'user') {
      userIdx = i;
      break;
    }
  }
  if (userIdx < 0) {
    toast({ title: '找不到对应的问题', detail: '无法重新生成。' }, 'warn', 2500);
    return;
  }
  const question = st.chat[userIdx].text || '';
  // 截断到该问题之前，然后重新问 —— 相当于「从这条消息重跑」
  store.set({ chat: st.chat.slice(0, userIdx) });
  await sendMessage(question, { alreadyInHistory: false, regenerating: true });
}

// 编辑重发：把用户消息放回输入框，并截断其后所有对话
export function editAndResend(msg) {
  if (state.streaming) {
    toast({ title: '正在生成中，请先停止' }, 'warn', 2000);
    return;
  }
  const st = store.get();
  const idx = st.chat.indexOf(msg);
  if (idx < 0) return;
  const text = msg.text || '';
  // 截断这条消息**及其之后**的所有内容，让用户改完重新走一遍
  store.set({ chat: st.chat.slice(0, idx) });
  if (state.inputArea) {
    state.inputArea.value = text;
    state.inputArea.focus();
  }
  render();
  toast({ title: '已取回输入框', detail: '修改后回车重新发送（其后的对话已清除）' }, 'ok', 3000);
}

// 全局 Esc 停止生成（参考 obsidian-yolo：Esc 全局取消所有在跑的 AI 任务）
if (typeof document !== 'undefined' && !document.__bsubEscBound) {
  document.__bsubEscBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.streaming) {
      e.preventDefault();
      stopStream();
    }
  });
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

    // 思维链：**独立折叠块**，与最终回答彻底分开
    if (msg.role === 'assistant' && (msg.reasoning || (msg.streaming && !msg.text))) {
      el.appendChild(buildReasoningBlock(msg));
    }

    if (msg.role === 'assistant' && msg.streaming) {
      setBoolAttr(el, 'data-streaming', true);
      // 有思维链时正文还没开始 —— 上面那块已经在显示「思考中」，这里不必再占位
      if (msg.text) {
        const pre = h('pre', { class: 'plain-stream' });
        pre.textContent = msg.text;
        el.appendChild(pre);
      }
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

    // 消息级操作（参考 obsidian-yolo 的「停止/重试/编辑问题」）：
    //   · AI 消息 → 复制、重新生成
    //   · 用户消息 → 编辑后重新发送（会截断其后的对话）
    if (!msg.streaming) {
      const acts = h('div', { class: 'msg-actions' });
      if (msg.role === 'assistant' && msg.text) {
        acts.appendChild(msgAction('复制', () => copyMessage(msg)));
        acts.appendChild(msgAction('重新生成', () => regenerateAt(msg)));
      }
      if (msg.role === 'user') {
        acts.appendChild(msgAction('编辑重发', () => editAndResend(msg)));
      }
      if (acts.childNodes.length) el.appendChild(acts);
    }

    host.appendChild(el);
  }
  renderQueueBar(host);
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
      ? '基于这期视频提问…（回车发送，Shift+回车换行）'
      : '直接提问即可 —— 没有字幕也能聊（回车发送，Shift+回车换行）',
    style: { flex: '1 1 auto', minHeight: '52px' }
  });
  // 回车行为可配置（参考 obsidian-yolo 的「Use Enter to start a new line」）：
  //   默认 sendOnEnter = true  → 回车发送、Shift+回车换行
  //   改成 false               → 回车换行、Ctrl/Cmd+回车发送
  const sendOnEnter = !(store.get().settings?.ai?.sendOnEnter === false);
  area.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const mod = e.ctrlKey || e.metaKey;
    if (sendOnEnter) {
      // Shift / Alt 换行；Ctrl+回车保留为兼容（老手感）
      if (e.shiftKey || e.altKey) return;
      e.preventDefault();
      submit();
      return;
    }
    // 反过来的模式：回车换行，只有 Ctrl/Cmd+回车才发送
    if (mod && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      submit();
    }
  });
  function submit() {
    const v = area.value;
    if (!String(v || '').trim()) return;
    // 正在生成时**不丢弃**，而是排队 —— 参考 yolo：可以继续输入并发送，
    // 消息排在当前回合结束后自动发出。
    if (isBusy()) {
      enqueueMessage(v);
      area.value = '';
      return;
    }
    sendMessage(v);
    area.value = '';
  }
  area.addEventListener('paste', async (e) => {
    const items = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (items.length) {
      e.preventDefault();
      await addFiles(items);
    }
  });
  row.appendChild(area);
  const col = h('div', { class: 'row tight' }, [
    button('发送', () => submit(), { small: true, primary: true, title: '回车发送 / Shift+回车换行' }),
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
  //
  // 只列**已配置**的平台（填过 API Key 的）——
  // 之前把所有内置平台和它们的种子模型都列出来，几十个用不了的条目
  // 混在一起，等于没有筛选。当前正在用的平台始终保留在列表里，
  // 否则用户会看到下拉框里选不中自己当前用的模型。
  const platforms = ai.platforms || [];
  const cur = platforms.find((p) => p.id === ai.activeId) || platforms[0];
  const configured = platforms.filter(
    (p) => String(p.apiKey || '').trim() || (cur && p.id === cur.id)
  );
  const sel = h('select', { class: 'model-select', title: '切换已配置的 AI 平台 / 模型' });
  if (!configured.length) {
    const opt = h('option', { value: '', text: '尚未配置任何 AI 平台' });
    opt.disabled = true;
    opt.selected = true;
    sel.appendChild(opt);
  }
  for (const p of configured) {
    // 关键：把**当前实际在用的模型**并进候选列表。
    // 否则当 p.model 不在 p.models 里（例如用户手填过模型名、
    // 或选过一个后来被清出种子列表的模型）时：
    //   · 下拉框显示的是 p.models 的第一项
    //   · 而真实请求用的是 p.model
    // 于是「对话里显示的模型 ≠ 实际用的模型」—— 这就是用户报的
    // 「对话旁边的模型名与设置里选的不一样」。
    const raw = Array.isArray(p.models) && p.models.length ? p.models.slice() : [];
    if (p.model && !raw.includes(p.model)) raw.unshift(p.model);
    const models = raw.length ? raw : [p.model].filter(Boolean);
    const hasKey = !!String(p.apiKey || '').trim();
    for (const m of models) {
      const opt = h('option', {
        value: `${p.id}::${m}`,
        text: `${p.id === ai.activeId ? '' : `${p.name} · `}${m}${hasKey ? '' : '（未配 Key）'}${m === p.model ? '' : ''}`
      });
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
  // 复用 AI Key 的平台（DeepSeek 搜索）：AI 那边填了 Key 就等于检索已配置
  let reusedKey = '';
  if (active && active.reuseAiKey) {
    const ai = ((settings.ai && settings.ai.platforms) || []).find((p) => p.id === active.reuseAiKey);
    reusedKey = (ai && ai.apiKey) || '';
  }
  const hasSearchKey = !!(active && (String(active.apiKey || '').trim() || String(reusedKey).trim()));
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

// 判断「这个问题值不值得联网检索」。
//
// 除了时效/事实类关键词，还专门覆盖两类容易漏掉的提问：
//   · 用户直接问「你能联网吗 / 帮我查一下」—— 这时他就是要联网，
//     不搜的话模型只能回答「我查不到」，体验很差
//   · 要求核实/求证（「对不对」「准确吗」「核实一下」）
export function needsWebSearch(question) {
  const q = String(question || '');
  if (!q.trim()) return false;
  // ① 明确要求检索 / 询问联网能力
  const asksToSearch = /查一下|搜一下|帮我查|搜索一下|上网查|联网|上网|能不能查|可以查/i;
  if (asksToSearch.test(q)) return true;
  // ② 要求核实 / 求证
  const asksToVerify = /核实|求证|验证|确认一下|准确吗|对不对|是真的吗|有没有错|事实核查|查证/i;
  if (asksToVerify.test(q)) return true;
  // ③ 明确的「外部事实/时效」信号。
  // 这里刻意**不放**「为什么 / 多少 / 对比 / 区别」这类泛问句 ——
  // 它们大多能靠视频字幕回答，搜了反而是一堆无关网页。
  const recencyOrFact =
    /最新|最近|现在|目前|今年|今天|今日|昨天|本周|本月|新闻|动态|进展|价格|股价|汇率|多少人|是谁|什么时候|哪一年|几点|官网|地址|链接|出处|来源/i;
  if (recencyOrFact.test(q)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// 阶段 1：校对字幕
// ---------------------------------------------------------------------------

// 对字幕做「术语 / 逻辑 / 时间 / 事实」校对，并**把修正写回字幕**。
//
// 用户明确要求的流程：
//   点生成总结 → 查字幕里的错误（联网）→ 更正 → 用更正后的字幕生成总结
//   且「原有字幕文件已经发生修改，但是可以回退至原有的字幕」
//
// 因此这里做三件事：
//   ① 把**原始字幕**备份到 `st.subtitlesOriginal`（回退用，只备份一次，
//      避免二次校对把「已更正版」当成原文备份）
//   ② 抽出待核实项 → 联网逐条核对 → 让模型给出修正
//   ③ 应用修正并写回 store，同时生成一份「改了哪些」的报告
export async function proofreadSubtitles(lines, settings, opts = {}) {
  const hasLines = Array.isArray(lines) && lines.length;
  if (!hasLines) return null;
  const st = store.get();
  const cap = searchCapabilityOf(settings);
  // 阶段回调：让调用方能把进度显示到进度条上
  const onStage = typeof opts.onStage === 'function' ? opts.onStage : null;

  // 联网核对（可选）
  let verify = [];
  if (cap.webCapable && cap.searchOn) {
    const items = extractVerifyItems(lines, settings.search?.verifyItemCount || settings.optimize?.verifyItemCount || 8);
    if (items.length) {
      try {
        verify = await verifyItems(
          items,
          // ephemeral：连续多条搜索，不能冲掉用户上次的检索面板结果
          (q, o) => doProviderSearch(q, { ...o, quiet: true, ephemeral: true }),
          {
            maxItems: settings.search?.verifyItemCount || 8,
            perItem: 3,
            // 逐条报告进度，界面能显示「正在核对 3/6：DeepSeek」
            onProgress: (i, total, item) => onStage && onStage('verify', i, total, item)
          }
        );
      } catch (err) {
        /* 核对失败仍可做纯文本校对 */
      }
    }
  }
  if (onStage) onStage('correct', 0, 1, null);

  const messages = OPT.buildOptimizeMessages({
    lines,
    glossary: settings.optimize?.glossary,
    verify,
    useSearch: false,
    videoTitle: (st.video && st.video.title) || ''
  });
  const res = await call('ai.chat', { messages, temperature: 0.1, maxTokens: 4000 }, { timeoutMs: 300000 });
  const corrections = OPT.parseOptimizeResult(res.text);
  if (!corrections.length) return { corrections: [], applied: { changed: 0 }, lines, report: '' };

  const applied = OPT.applyCorrections(lines, corrections);

  // 备份原始字幕（只在还没有备份时备份，保住「最初的那一份」）
  if (!st.subtitlesOriginal || !st.subtitlesOriginal.length) {
    store.set({ subtitlesOriginal: lines.map((l) => ({ ...l })) });
  }
  setLines(applied.lines, { label: 'AI 校对并更正字幕', detail: `更正 ${applied.changed} 处` });
  await saveHistory();

  // 生成「改了哪些」的报告，用于总结顶部与提示
  const rows = [];
  const seen = new Set();
  for (const c of corrections) {
    const key = `${c.wrong}→${c.right}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(`- ${c.kind ? `[${c.kind}] ` : ''}${c.wrong} → ${c.right}${c.reason ? `（${c.reason}）` : ''}`);
  }
  const report = rows.join('\n');

  const byKind = {};
  for (const c of corrections) {
    const k = c.kind || '其他';
    byKind[k] = (byKind[k] || 0) + 1;
  }
  const kindText = Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(' · ');

  if (!opts.quiet) {
    toast(
      {
        title: `字幕已更正 ${applied.changed} 处`,
        detail: `${kindText}。原字幕已备份，可随时回退。`
      },
      'ok',
      5000
    );
  }
  return { corrections, applied, lines: applied.lines, report, kindText };
}

// 回退到原始字幕（校对前的那一份）
export async function revertSubtitles() {
  const st = store.get();
  const orig = st.subtitlesOriginal;
  if (!orig || !orig.length) {
    toast({ title: '没有可回退的原始字幕' }, 'warn');
    return false;
  }
  setLines(orig.map((l) => ({ ...l })), { label: '回退字幕到原始版本' });
  store.set({ optimize: { ...(st.optimize || {}), corrections: [], pending: false } });
  await saveHistory();
  toast({ title: '已回退到原始字幕', detail: 'AI 的更正已撤销。' }, 'ok', 3000);
  render();
  return true;
}

// ---------------------------------------------------------------------------
// 阶段 2：生成总结
// ---------------------------------------------------------------------------

// 总结的格式约束。
//
// 用户指定的提示词（原句）已经是 constants.js 里的 DEFAULT_SYSTEM_PROMPT：
//   「整理这期视频的内容（可以用表格、代码块、高亮块、引用、超链接、公式、
//     图片等飞书支持的格式输出，可以加上一些图标增加可读性）」
//
// 下面这段是给模型的**格式细则**，目的只有一个：让输出的 Markdown
// 是飞书文档能正确识别的。飞书文档支持的标准 Markdown 子集：
//   标题 / 粗体斜体删除线 / 有序无序列表 / 任务列表 / 引用 /
//   围栏代码块（带语言）/ 表格 / 链接 / 分割线 / LaTeX 公式
//
// ⚠ 诚实说明：飞书官方文档站是 JS 渲染的，抓不到正文。这份清单基于既有知识，
// **没有对着官方规范逐条核对**。因此设计上做了防御 ——
// 即使某个语法飞书不认，它也只是显示成纯文本，不会让总结出错或用不了。
export const FEISHU_FORMAT_RULES = [
  '【输出风格：做成一份信息密度高的图文笔记，不要平铺直叙的流水账】',
  '',
  '飞书文档能渲染丰富结构，请**主动使用**，不要只用「标题 + 段落」：',
  '',
  '1. **先给一句话结论**，紧接一个「速览」表格（3~6 行），让读者 10 秒抓住重点。',
  '2. **该用表格就用表格** —— 对比、参数、时间线、优劣、步骤一律用管道表格，',
  '   不要写成句子。必须有表头与 `---` 分隔行。',
  '3. **引用块（行首 `> `）用来强调关键判断或原话**，例如 `> **结论**：…`。',
  '   飞书会把引用渲染成高亮块样式，是视觉最强的一种。',
  '4. **代码块**（三个反引号 + 语言）用于命令、配置、代码、数据样例。',
  '5. **超链接**写成 `[文字](https://…)`。**只链接字幕里明确出现过、'
    + '或你确信真实存在的 URL**，**绝对不要编造**。',
  '6. **公式**用 LaTeX：行内 `$…$`、块级 `$$…$$`。',
  '7. **任务列表** `- [ ]` / `- [x]` 用于待办、检查项、可执行建议。',
  '8. **分割线** `---` 用于分节。',
  '9. **emoji 做小标题前缀**提升可读性（如 `## 🎯 核心结论`），但不要每行都加。',
  '10. **图片无法通过文本携带**。某个位置适合配图时，用一行',
  '    `> 🖼️ 建议配图：<放什么图>` 占位，不要输出假的图片语法。',
  '',
  '【硬性要求】',
  '· 内容必须**全部来自字幕**（以及下方给出的简介/评论），不要引入字幕里没有的信息。',
  '· **不要输出**内嵌 HTML、脚注、自定义容器语法、base64 图片。',
  '· 标题最多三级（`#` / `##` / `###`），不要跳级。',
  '',
  '【详细程度：宁可详细，不要简略】',
  '· 这是一份**完整的观看笔记**，不是摘要提纲，请充分展开。',
  '· 每个要点都要写清「是什么 + 为什么 + 怎么做/结论」，不要只写一句短语。',
  '· 视频里出现的**具体数字、名称、命令、步骤、参数、结论**都要保留；',
  '  有流程就逐步列出，有对比就做成表格，有坑就写清现象与原因。',
  '· 按内容自然分节，不要为了短而合并章节；长视频写长一些是正常的。',
  '· 唯一要避免的是**重复与灌水** —— 不要为了凑长度而复述同一件事。'
].join('\n');

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
  //
  // 这段措辞必须与**实际行为**一致。之前写「会自动检索网页，结果会附在下面」，
  // 但检索是按关键词触发的 —— 问题没命中关键词时模型收到空资料，
  // 只能回一句「系统提示说会附参考资料，但这次并没有」。
  // 那是我们的提示在撒谎，不是模型出错。
  if (webCapable && searchOn) {
    const channel = hasSearchKey
      ? `已配置检索平台${searchProviderName ? `（${searchProviderName}）` : ''}`
      : '使用免费检索引擎（Bing / AnySearch / Exa，无需 Key）';
    if (searchUsed && searchResultCount > 0) {
      lines.push(`· 联网检索：**可用**（${channel}），**本轮已经检索过**，${searchResultCount} 条来源见下方参考资料。`);
    } else if (alwaysSearch) {
      lines.push(`· 联网检索：**可用**（${channel}），已设为每轮都检索。下方参考资料若为空说明这次检索失败。`);
    } else {
      lines.push(
        `· 联网检索：**可用**（${channel}）。` +
          '检索是按需触发的：只有提问含外部/时效信息时才自动检索。\n' +
          '  └ **本轮没有进行检索，所以下面不会有网页资料**。' +
          '如果确实需要联网，请告诉用户「这需要联网确认」，建议他把问题问得更明确（例如加「查一下」）；' +
          '否则就基于已有知识回答，并说明可能过时。**绝对不要声称自己查过网页。**'
      );
    }
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

// ---------------------------------------------------------------------------
// 消息队列（生成中继续输入）
// ---------------------------------------------------------------------------
//
// 参考 obsidian-yolo：生成过程中可以继续打字并发送，消息排队，
// 当前回合结束后自动发出；**中止时未发出的消息要还回输入框**，不能丢。

function enqueueMessage(text) {
  const q = state.queue || (state.queue = []);
  q.push({ id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text });
  toast({ title: '已排队', detail: '当前回答结束后会自动发送' }, 'ok', 2000);
  renderChat();
}

function dequeueNext() {
  const q = state.queue || [];
  const next = q.shift();
  state.queue = q;
  return next || null;
}

// 中止时把队列还回输入框（而不是静默丢弃）
function restoreQueueToInput() {
  const q = state.queue || [];
  if (!q.length) return;
  const text = q.map((x) => x.text).join('\n\n');
  state.queue = [];
  if (state.inputArea) {
    state.inputArea.value = state.inputArea.value ? `${state.inputArea.value}\n\n${text}` : text;
  }
  toast({ title: '已把排队的消息放回输入框', detail: `${q.length} 条未发送` }, 'warn', 3000);
}

// 渲染队列条（显示待发送的消息，可单条移除）
function renderQueueBar(host) {
  const q = state.queue || [];
  if (!q.length) return;
  const bar = h('div', { class: 'queue-bar' });
  bar.appendChild(h('span', { class: 'queue-title', text: `排队中 ${q.length} 条` }));
  for (const item of q) {
    const row = h('div', { class: 'queue-item' });
    row.appendChild(h('span', { class: 'queue-text', text: item.text }));
    row.appendChild(
      h('button', {
        class: 'queue-del',
        type: 'button',
        title: '移除这条',
        text: '×',
        onclick: () => {
          state.queue = (state.queue || []).filter((x) => x.id !== item.id);
          renderChat();
        }
      })
    );
    bar.appendChild(row);
  }
  host.appendChild(bar);
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

// 生成总结。
//
// opts.skipProofread：跳过阶段 1 的联网校对，直接用现有字幕生成。
//   为什么要有这个开关：联网核对要逐条搜索，是最耗时的一段（可能几十秒）。
//   用户要求加一个「快速总结」按钮来跳过它。
// ---------------------------------------------------------------------------
// 长视频的分段总结（map-reduce）
// ---------------------------------------------------------------------------
//
// 用户报：「2 小时的视频官方字幕是全的，但总结到某个时间点后就没有了。」
//
// 根因就在下面这行（曾经写的）：
//     const ctx = selectContext(correctedLines, '', 40000);
// 传空问题时 `selectContext` 会走
//     return { text: full.slice(0, maxChars), truncated: true }
// 也就是**只取前 40000 字符**。
// 2 小时视频的字幕转写约 6.6 万字符 → 只喂进去约 61%，
// 于是总结自然只覆盖到大约 73 分钟处。
//
// 字幕本身是**完整的**（validateLines 只校验覆盖率，从不截断），
// 截断完全发生在「喂给 AI」这一步。
//
// 修法：超过上限就**分段总结再合并**（map-reduce），
// 而不是把剩下的部分丢掉。

// 按行分段，每段不超过 maxChars，尽量在行边界切
export function chunkTranscript(lines, maxChars = 40000, onProgress) {
  const chunks = [];
  let cur = [];
  let size = 0;
  for (const l of lines) {
    const row = `[${fmtClock(l.from)}] ${String(l.text || '')}`;
    // 单行超长（罕见）：独占一段，硬切
    if (row.length > maxChars) {
      if (cur.length) {
        chunks.push({ text: cur.join('\n'), lines: cur });
        cur = [];
        size = 0;
      }
      chunks.push({ text: row.slice(0, maxChars), lines: [l] });
      continue;
    }
    if (size + row.length + 1 > maxChars && cur.length) {
      chunks.push({ text: cur.join('\n') });
      cur = [];
      size = 0;
    }
    cur.push(row);
    size += row.length + 1;
    if (onProgress) onProgress(chunks.length);
  }
  if (cur.length) chunks.push({ text: cur.join('\n') });
  return chunks;
}

// 每段的提取指令：保留要点与时间线索，供最终合并使用
const CHUNK_SYSTEM = '你是视频字幕整理助手。用户会给你**一部长视频中的一段**字幕。' +
  '请只针对这一段做结构化提取，不要臆测其它段落的内容，也不要写“本段/接下来”这类过渡语。';

function chunkUserPrompt({ title, part, index, total, fromLabel, toLabel, text }) {
  return [
    title ? `视频：${title}${part ? ` · ${part}` : ''}` : '',
    `这是第 ${index}/${total} 段字幕，时间范围约 ${fromLabel} ~ ${toLabel}。`,
    '请按下面的格式提取这一段的内容（Markdown，用中文）：',
    '- `### <小标题>`：这一段的主题',
    '- 要点列表（尽量具体：数字、结论、步骤、例子、人物）',
    '- 若出现值得原样保留的说法，用 `> 引用` 格式直接摘录',
    // ⚠ 这里**不要**要求"每条要点都带时间"。
    // 曾经要求过「在关键处标注时间戳」，结果模型几乎每行都塞一个
    // [mm:ss]，整篇总结被时间戳淹没（用户反馈：「里面有很多时间，影响阅读」）。
    // 时间只在**少数真正需要跳转**的位置才有价值。
    '不要给每条要点都标时间；只有极少数确实需要跳转的位置才写 `[mm:ss]`（整段最多一两处）。',
    '不要写总结性的收尾语，直接给提取结果。',
    '下面是这一段字幕原文：',
    text
  ]
    .filter(Boolean)
    .join('\n\n');
}

// 计算「这份字幕实际覆盖的时间范围」。
//
// 为什么必须把它显式告诉模型：合并提示词里给了视频总时长，
// 而各段的时间标签只到最后一句字幕 —— 模型会**自己推断**
// 「后面那段没有字幕」，于是写出
//    「字幕覆盖 00:00–1:43:39，之后约 14 分钟字幕未提供」
// 这种**看起来有据可依、实际是它自己脑补**的句子（我们的代码里
// 没有任何地方产生这行字）。把真实范围直接给它，并禁止它发表
// 关于字幕完整性的议论，才能从源头堵住这种编造。
export function subtitleSpan(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  if (!arr.length) return null;
  let first = Infinity;
  let last = 0;
  let count = 0;
  for (const l of arr) {
    const from = Number(l && l.from);
    if (Number.isFinite(from)) {
      if (from < first) first = from;
      if (from > last) last = from;
      count += 1;
    }
    const to = Number(l && l.to);
    if (Number.isFinite(to) && to > last) last = to;
  }
  if (!count) return null;
  return { first: first === Infinity ? 0 : first, last, count };
}

// 时长为 [时:分:秒]（超过 1 小时时带小时）。
// 不能直接用 fmtClock —— 它输出 [分:秒]，2 小时视频会变成「103:43」，
// 读起来不像时间点。
export function hmsClock(s) {
  const v = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(v / 3600);
  const mm = String(Math.floor((v % 3600) / 60)).padStart(2, '0');
  const ss = String(v % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function describeSpan(span, durationSeconds) {
  if (!span) return '';
  const dur = Number(durationSeconds) || 0;
  const head = `本视频**已获取到**的字幕时间范围：${hmsClock(span.first)} ~ ${hmsClock(span.last)}（共 ${span.count} 行）`;
  const tail = dur ? `；视频总时长 ${hmsClock(dur)}` : '';
  return head + tail;
}

// 把各段摘要合并成最终总结
function mergeUserPrompt({ title, part, duration, chunkCount, chunkSummaries, fixReport, extraContext, spanText }) {
  return [
    title ? `视频：${title}${part ? ` · ${part}` : ''}` : '',
    duration ? `时长：${duration}` : '',
    spanText,
    extraContext,
    `下面是这部视频**分成 ${chunkCount} 段**分别提取的内容，请把它们**合并成一篇完整、连贯的总结**。`,
    '要求：',
    '- 按时间顺序组织，覆盖**全片**（不要只写开头，也不要遗漏后面的段落）',
    '- 合并重复内容，保持逻辑连贯；同一主题分散在多段的要归并到一起',
    '- 保留具体数字、结论、步骤与例子',
    // 同上：不要命令模型"保留关键时间点"。只在真正需要跳转时给几处。
    '- **不要**在正文里大量标注时间。时间只保留在**极少数**真正需要跳转的位置（全篇最多 2~3 处），' +
      '其余一律不写时间，保持正文可读。',
    fixReport ? `- 字幕本轮已校对更正 ${(fixReport.match(/^- /gm) || []).length} 处` : '',
    // 禁止模型自作主张议论「字幕缺失」——
    // 它只能看到我们给的文本，看不到字幕源文件，任何关于
    // 「某段没有字幕 / 字幕未提供」的说法都是它的**推测**，不是事实。
    '- **不要**写任何关于「字幕是否完整 / 某段字幕未提供 / 字幕只覆盖到某处」的说明。' +
      '你无法判断字幕来源的完整性，这类结论只会误导用户。',
    '各段提取结果如下：',
    chunkSummaries
  ]
    .filter(Boolean)
    .join('\n\n');
}

// 分段总结（map）→ 合并（reduce）。
//
// 为什么不用流式：分段时每一段都要单独拿到完整结果才能进入下一段，
// 所以这里用普通 `ai.chat` 调用。合并那一步也用普通调用 ——
// 它可能很长，但比"丢内容"要好。
async function summarizeInChunks({ lines, systemBase, video, extraContext, fixReport, settings, task, totalSteps, onChunkSummary }) {
  const CHUNK_CHARS = 40000;
  const chunks = chunkTranscript(lines, CHUNK_CHARS);
  const totalCount = chunks.length;
  const title = (video && video.title) || '';
  const part = (video && video.partTitle) || '';
  const durationText = video && video.duration ? fmtTime(video.duration) : '';
  const maxTokens = Number(settings.ai.maxTokens) || 8192;
  const spanText = describeSpan(subtitleSpan(lines), (video && video.duration) || 0);

  const summaries = [];
  const durSec = (video && video.duration) || 0;
  for (let i = 0; i < totalCount; i += 1) {
    if (state.summaryAbortRequested) {
      const e = new Error('已终止');
      e.name = 'AbortError';
      throw e;
    }
    const c = chunks[i];
    // 该段首末时间（用于提示模型"这是哪一段"）
    const fromT = chunkStartSeconds(c, i, lines, durSec);
    const toT = i + 1 < totalCount ? chunkStartSeconds(chunks[i + 1], i + 1, lines, durSec) : durSec;
    task.set(
      60 + (i / (totalCount + 1)) * 25,
      `第 ${totalSteps}/${totalSteps} 步：分段总结 ${i + 1}/${totalCount}（全片 ${Math.round((fromT / 60) * 10) / 10} 分钟起）`
    );
    // rid 让「停止」能真正 abort 当前这段请求（后台 cancel 按 rid 找 controller）
    const rid = `sum_${Date.now().toString(36)}_${i}`;
    state.summaryRid = rid;
    const res = await call(
      'ai.chat',
      {
        rid,
        messages: [
          { role: 'system', content: systemBase ? `${systemBase}\n\n${CHUNK_SYSTEM}` : CHUNK_SYSTEM },
          {
            role: 'user',
            content: chunkUserPrompt({
              title,
              part,
              index: i + 1,
              total: totalCount,
              fromLabel: fmtClock(fromT),
              toLabel: fmtClock(toT),
              text: c.text
            })
          }
        ],
        platformId: settings.ai.activeId,
        temperature: settings.ai.temperature,
        maxTokens
      },
      { timeoutMs: 600000 }
    );
    const text = String((res && res.text) || '').trim();
    if (!text) throw new Error(`第 ${i + 1}/${totalCount} 段总结为空`);
    summaries.push({ index: i + 1, from: fromT, text });
    if (onChunkSummary) {
      onChunkSummary(`（分段总结进行中 ${summaries.length}/${totalCount}）\n\n` + summaries.map((s) => s.text).join('\n\n---\n\n'));
    }
  }

  task.set(88, `第 ${totalSteps}/${totalSteps} 步：合并 ${totalCount} 段为完整总结…`);
  const chunkSummaries = summaries
    .map((s) => `【第 ${s.index}/${totalCount} 段 · 起于 ${fmtClock(s.from)}】\n${s.text}`)
    .join('\n\n---\n\n');
  if (state.summaryAbortRequested) {
    const e = new Error('已终止');
    e.name = 'AbortError';
    throw e;
  }
  const mergeRid = `sum_${Date.now().toString(36)}_merge`;
  state.summaryRid = mergeRid;
  const res2 = await call(
    'ai.chat',
    {
      rid: mergeRid,
      messages: [
        { role: 'system', content: systemBase },
        {
          role: 'user',
          content: mergeUserPrompt({
            title,
            part,
            duration: durationText,
            chunkCount: totalCount,
            chunkSummaries,
            fixReport,
            extraContext,
            spanText
          })
        }
      ],
      platformId: settings.ai.activeId,
      temperature: settings.ai.temperature,
      maxTokens
    },
    { timeoutMs: 600000 }
  );
  const text = String((res2 && res2.text) || '').trim();
  if (!text) throw new Error('合并总结为空');
  return { text, chunks: totalCount };
}

// 取某一段的起始秒数：优先解析该段第一行的时间戳（形如 "[12:34] 文本"）。
// 解析不到就按「第几段 / 总段数 × 时长」估算，绝不用 0 ——
// 全返回 0 会让进度提示全部显示「0.0 分钟起」，等于没有信息。
function chunkStartSeconds(chunk, index, allLines, durationSeconds) {
  const m = /^\[(\d+):(\d{2})\]\s?/.exec((chunk && chunk.text) || '');
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Array.isArray(allLines) ? allLines.length : 0;
  const dur = Number(durationSeconds) || 0;
  if (!n || !dur) return 0;
  return Math.round((index / n) * dur);
}

export async function generateSummary(opts = {}) {
  const skipProofread = opts.skipProofread === true;
  const st = store.get();
  if (!(st.subtitles || []).length) {
    toast(
      {
        title: '生成总结需要字幕',
        detail: '请先获取字幕（顶部「获取字幕」）或做语音转录。如果只是想提问，直接在下方对话框输入即可（不需要字幕）。'
      },
      'warn',
      5000
    );
    return;
  }
  const settings = st.settings;
  const promptText = activePromptText();

  // 整个总结流程挂一个可取消的任务，进度显示在全局进度条上。
  // 之前总结时界面只有「生成中…」，用户不知道卡在哪一步、还剩多久。
  const task = jobs.beginTask(TASK_LABEL.summarize, { detail: '准备中…' });

  // ---- 阶段 1：校对字幕（联网核对术语/逻辑/时间/事实），并**实际更正字幕** ----
  //
  // 用户要求的流程：点「生成总结」时先查字幕里的错误 → 联网核对 → 更正字幕
  // （原字幕可回退）→ 用**更正后的字幕**生成总结。
  //
  // 早先的做法是把核对证据塞进总结的上下文里让模型「边说边改」，
  // 那样校正和总结混在一起，用户既看不清改了什么，也没法回退。
  // 现在拆成两个阶段，并真的把修正写回字幕。
  const capSearch = searchCapabilityOf(settings);
  // 是否真的执行阶段 1：只由「总结校对开关 + 检索是否可用」决定。
  // 以前这里还要求 capSearch.searchOn（即「对话时自动联网」），
  // 于是用户一关对话自动联网，总结的校对也跟着停了 —— 两个无关的开关被串在一起。
  const willProofread =
    !skipProofread &&
    settings.search.verifyOnSummary !== false &&
    capSearch.webCapable &&
    st.subtitles.length > 0;
  let correctedLines = st.subtitles;
  let fixReport = '';
  const totalSteps = willProofread ? 3 : 2;
  if (skipProofread) {
    task.set(5, '快速总结：跳过联网校对');
  } else if (willProofread) {
    try {
      task.set(2, `第 1/${totalSteps} 步：准备校对字幕`);
      const out = await proofreadSubtitles(st.subtitles, settings, {
        quiet: false,
        onStage: (stage, i, total, item) => {
          if (stage === 'verify') {
            // 核对占总进度的 5%→50%（几步而已，但这是最耗时的一段）
            const pct = 5 + (total ? (i / total) * 45 : 0);
            task.set(pct, `第 2/${totalSteps} 步：联网核对 ${Math.min(i + 1, total)}/${total}${item ? ` · ${String(item).slice(0, 18)}` : ''}`);
          } else if (stage === 'correct') {
            task.set(52, `第 2/${totalSteps} 步：让 AI 给出字幕更正…`);
          }
        }
      });
      if (out && out.applied && out.applied.changed) {
        correctedLines = out.lines;
        fixReport = out.report;
      }
      task.set(58, out && out.applied && out.applied.changed
        ? `第 2/${totalSteps} 步：已更正 ${out.applied.changed} 处`
        : `第 2/${totalSteps} 步：字幕未发现需要更正的地方`);
    } catch (err) {
      const detail = (err && err.payload && err.payload.title) || (err && err.message) || '校对失败';
      toast({ title: '字幕校对失败，将用原字幕生成总结', detail }, 'warn', 4000);
    }
  } else {
    const why = settings.search.verifyOnSummary === false ? '设置里已关闭「总结前联网核对」' : '检索能力未就绪';
    task.set(5, `第 1/${totalSteps} 步：跳过联网校对（${why}）`);
  }

  let ctx = selectContext(correctedLines, '', 40000);
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
  // ---- 视频简介 + 热门评论（用户希望总结时结合）----
  let extraContext = '';
  if (st.video && settings.summary && settings.summary.useVideoMeta !== false) {
    const bits = [];
    const desc = String(st.video.desc || '').trim();
    if (desc) bits.push(`【视频简介】\n${desc.slice(0, 2000)}`);
    // 评论按需抓取（失败不影响总结）
    if (settings.summary.useComments === true && (st.video.aid || st.video.bvid)) {
      try {
        const out = await call(
          'bili.comments',
          { aid: st.video.aid, bvid: st.video.bvid, pageUrl: st.video.url, limit: 10 },
          { timeoutMs: 20000 }
        );
        if (out && out.ok && out.comments && out.comments.length) {
          const rows = out.comments.map((c, i) => `${i + 1}. [${c.like}赞] ${c.user}：${c.text}`);
          bits.push(`【热门评论（供参考，不代表事实）】\n${rows.join('\n')}`);
        }
      } catch (err) {
        /* 评论拿不到就不放 */
      }
    }
    if (bits.length) extraContext = bits.join('\n\n');
  }

  const messages = [
    {
      role: 'system',
      content: [
        activeSkill ? `${promptText}\n\n【当前技能：${activeSkill.name}】\n${activeSkill.body}` : promptText,
        capBlock,
        FEISHU_FORMAT_RULES,
        // 字幕已在本轮校对过 —— 告诉模型「这是更正后的版本」，
        // 并附上改了哪些，让它不要在总结里再纠结原文
        fixReport
          ? '【本次字幕已校对并更正】\n' +
            '下面给你的**已经是更正后的字幕**，请直接据此整理，不要再提「字幕可能有误」。\n' +
            `本轮更正了 ${(fixReport.match(/^- /gm) || []).length} 处：\n${fixReport}\n\n` +
            '如果这些更正确实影响了对内容的理解，可在总结末尾用一行「⚠️ 字幕已更正」简要说明。'
          : ''
      ].filter(Boolean).join('\n\n')
    },
    {
      role: 'user',
      content: [
        st.video ? `视频：${st.video.title || ''}${st.video.partTitle ? ` · ${st.video.partTitle}` : ''}` : '',
        st.video && st.video.owner ? `UP：${st.video.owner}` : '',
        st.video && st.video.duration ? `时长：${fmtTime(st.video.duration)}` : '',
        // 把字幕的**真实**覆盖范围交给模型，并禁止它议论字幕完整性 ——
        // 否则它会拿「视频总时长」与「最后一句字幕的时间」作差，
        // 自己脑补出「之后 N 分钟字幕未提供」这种不存在的结论。
        describeSpan(subtitleSpan(correctedLines), st.video && st.video.duration),
        extraContext,
        '下面是这期视频的字幕原文（**已提供的全部**，请据此整理，不要推测缺失部分）：',
        ctx.text
      ]
        .filter(Boolean)
        .join('\n\n')
    }
  ];

  state.summaryAbortRequested = false;
  state.summaryRid = '';
  state.summaryStreaming = true;
  state.streaming = true;
  store.set({ summaryStream: '' });
  render();

  // ---- 长视频：分段总结再合并（不能只取前 40000 字符）----
  //
  // 这是用户报的「2 小时视频总结到某个时间点就没有了」的修复点。
  // 字幕是完整的，但之前只把前 40000 字符喂给 AI。
  if (ctx.truncated) {
    try {
      const result = await summarizeInChunks({
        lines: correctedLines,
        systemBase: [activeSkill ? `${promptText}\n\n【当前技能：${activeSkill.name}】\n${activeSkill.body}` : promptText, capBlock, FEISHU_FORMAT_RULES]
          .filter(Boolean)
          .join('\n\n'),
        video: st.video,
        extraContext,
        fixReport,
        settings,
        task,
        totalSteps,
        onChunkSummary: (text) => {
          // 让用户看得见进度：把各段中间结果先落进 summaryStream
          store.set({ summaryStream: text });
          renderSummary();
        }
      });
      const finalText = result && result.text ? result.text : '';
      if (!finalText) throw new Error('分段总结没有返回内容');
      state.summaryStreaming = false;
      state.streaming = false;
      state.stream = null;
      state.summaryRid = '';
      state.summaryAbortRequested = false;
      store.set({ summary: finalText, summaryStream: '' });
      recountCitations(finalText);
      await saveHistory();
      task.set(100, `完成（${finalText.length} 字，覆盖全片 ${result.chunks} 段）`);
      task.end();
      render();
      toast(
        {
          title: '总结完成',
          detail: `视频较长，已分段总结并合并（共 ${result.chunks} 段），覆盖全片。`
        },
        'ok',
        5000
      );
      return;
    } catch (err) {
      const aborted = state.summaryAbortRequested || (err && err.name === 'AbortError');
      state.summaryStreaming = false;
      state.streaming = false;
      state.stream = null;
      state.summaryRid = '';
      state.summaryAbortRequested = false;
      task.end();
      const payload = (err && err.payload) || {};
      const partial = store.get().summaryStream || '';
      if (aborted) {
        if (partial) {
          store.set({ summary: partial, summaryStream: '' });
          toast({ title: '已终止分段总结', detail: '已保留已经生成的部分', }, 'warn', 4000);
        } else {
          toast({ title: '已终止分段总结' }, 'warn', 2500);
        }
      } else if (partial) {
        store.set({ summary: partial, summaryStream: '' });
        toast({ title: '分段总结中断，已保留已生成的部分', detail: payload.detail || String(err.message || err) }, 'warn', 6000);
      } else {
        showError(Object.assign(new Error(payload.title || String((err && err.message) || err)), { payload }));
      }
      render();
      return;
    }
  }

  task.set(60, `第 ${totalSteps}/${totalSteps} 步：正在生成总结…`);
  const stream = new Stream();
  state.stream = stream;
  // 生成阶段无法预知总长度，所以用「已输出 N 字」做温和推进：
  // 60% → 95%，永不假装到 100%（收尾时才置满）。
  let streamedChars = 0;
  stream.start(
    'ai.summarize',
    { messages, platformId: settings.ai.activeId, temperature: settings.ai.temperature, maxTokens: settings.ai.maxTokens },
    {
      onDelta: (text) => {
        const cur = store.get();
        store.set({ summaryStream: (cur.summaryStream || '') + text });
        streamedChars += text.length;
        task.set(Math.min(95, 60 + Math.log10(streamedChars + 1) * 11), `第 ${totalSteps}/${totalSteps} 步：生成中（已 ${streamedChars} 字）`);
        renderSummary();
        scrollAiBottom();
      },
      onEnd: async () => {
        const finalText = store.get().summaryStream || '';
        state.summaryStreaming = false;
        state.streaming = false;
        state.stream = null;
        state.summaryRid = '';
        state.summaryAbortRequested = false;
        store.set({ summary: finalText, summaryStream: '' });
        recountCitations(finalText);
        await saveHistory();
        task.set(100, `完成（${finalText.length} 字）`);
        task.end();
        render();
        toast({ title: '总结完成', detail: `已按 Markdown 渲染（${finalText.length} 字）` }, 'ok');
      },
      onError: (payload) => {
        state.summaryStreaming = false;
        state.streaming = false;
        state.stream = null;
        state.summaryRid = '';
        state.summaryAbortRequested = false;
        task.end();
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
  // 长视频分段总结没有流式对象，靠 rid 让后台 abort 当前那段 ai.chat。
  // 以前的「停止」在这种情况下完全没反应 —— 按钮在、点了什么都不发生。
  if (state.summaryStreaming && !state.stream && state.summaryRid) {
    state.summaryAbortRequested = true;
    call('cancel', { rid: state.summaryRid }, { timeoutMs: 8000 }).catch(() => {});
    toast({ title: '正在终止分段总结…' }, 'warn', 1500);
    return;
  }
  if (state.stream) {
    state.stream.cancel();
    // 中止时把队列还回输入框（参考 yolo：不丢排队的消息）
    restoreQueueToInput();
    renderChat();
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
    const needsWeb = needsWebSearch(question);
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
  touchStream();
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
        touchStream();
        const cur = store.get();
        const chat = [...cur.chat];
        const last = chat[chat.length - 1];
        if (last && last.role === 'assistant') {
          const prefix = streamedTools.length && !last.toolTrace
            ? `> 🔧 已调用工具：${streamedTools.map((x) => x.name).join('、')}\n\n`
            : '';
          chat[chat.length - 1] = {
            ...last,
            // 正文一开始输出，就说明「思考阶段」结束了 → 记下耗时
            reasonMs: last.reasonMs || (last.reasoning ? Date.now() - (last.reasonStart || Date.now()) : 0),
            toolTrace: streamedTools.length ? streamedTools.map((x) => x.name) : last.toolTrace,
            text: (last.text || '') + (prefix || '') + text2
          };
          store.set({ chat });
        }
        renderChat();
        scrollAiBottom();
      },
      // 思维链单独累加，绝不混进正文
      onReasoning: (piece) => {
        touchStream();
        const cur = store.get();
        const chat = [...cur.chat];
        const last = chat[chat.length - 1];
        if (last && last.role === 'assistant') {
          chat[chat.length - 1] = {
            ...last,
            reasoning: (last.reasoning || '') + piece,
            reasonStart: last.reasonStart || Date.now()
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
        if (last && last.role === 'assistant') {
          chat[chat.length - 1] = {
            ...last,
            streaming: false,
            reasonMs: last.reasonMs || (last.reasoning ? Date.now() - (last.reasonStart || Date.now()) : 0)
          };
        }
        state.streaming = false;
        state.stream = null;
        store.set({ chat });
        recountCitations(chat.map((c) => c.text).join('\n'));
        render();
        await saveHistory();
        // 队列里还有消息 → 自动发出下一条
        const next = dequeueNext();
        if (next) {
          renderChat();
          setTimeout(() => sendMessage(next.text), 120);
        }
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
