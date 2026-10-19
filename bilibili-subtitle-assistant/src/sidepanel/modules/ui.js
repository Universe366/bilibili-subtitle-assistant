// 浮层基础设施。
// 稳定性 #3：全屏遮罩背景必须 pointer-events: none，内部卡片单独设回 auto，
// 否则滚轮和点击会被吃掉。

import { h, button, setBoolAttr } from './dom.js';

// ---------------------------------------------------------------------------
// 溢出菜单（把一堆次要按钮收进一个「⋯」里）
//
// 为什么要做：界面上按钮太多会让人不知道该点哪个。
// 参照通行做法 —— 每屏只留 1 个主操作 + 少量常用操作，
// 其余按语义收进菜单。
//
// items 支持分隔线：传 { divider: true } 即可。
// 也支持分组小标题：传 { heading: '获取内容' }（不可点击，纯分组）。
// ---------------------------------------------------------------------------
export function popoverMenu(items, opts = {}) {
  const wrap = h('div', { class: 'menu-wrap' });
  const trigger = h('button', {
    class: `btn btn-sm menu-trigger${opts.primary ? ' btn-primary' : ''}`,
    type: 'button',
    title: opts.title || '更多操作',
    text: opts.label || '⋯'
  });
  const panel = h('div', { class: 'menu-panel' });
  panel.setAttribute('role', 'menu');

  let open = false;

  // 用 **pointerdown** 统一处理开关，而不是 click。
  //
  // 为什么：pointerdown 先于 click 触发。若「打开」和「点外部关闭」都挂在
  // click 上，同一次点击会先在文档上判为「外部」把菜单关掉，再触发触发器
  // 把它打开 —— 顺序一乱就表现为「点了没反应」。
  // 全部改到 pointerdown，两者都在同一个事件里判定，没有先后竞态。
  const close = () => {
    if (!open) return;
    open = false;
    wrap.removeAttribute('data-open');
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close, true);
  };
  const onDocDown = (ev) => {
    // wrap 里同时包含触发器与面板，两者都算「内部」
    if (!wrap.contains(ev.target)) close();
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      close();
      trigger.focus();
    }
  };

  // 把面板**夹进视口**。
  //
  // 只靠「左对齐 / 右对齐」不够：触发器在工具栏里可能靠右，
  // 而面板比它宽得多，两边对齐都可能越界。
  // 实测 320px 视口下：左对齐 → 右边缘 316（差一点点）、右对齐 → left=-32（越界）。
  //
  // 注意坐标系：`panel.style.left` 是相对**定位祖先**（.menu-wrap）的，
  // 而 getBoundingClientRect() 是相对视口的 —— 两者必须换算，
  // 否则会整体偏移一个 wrap.left（这个坑我踩了一次）。
  const align = () => {
    const pw = panel.offsetWidth || 0;
    if (!pw) return;
    const vw = window.innerWidth || 360;
    const wrapRect = wrap.getBoundingClientRect();
    const r = trigger.getBoundingClientRect();
    // 默认让面板左边与触发器左边对齐（相对视口）
    let viewportLeft = r.left;
    // 夹进视口，留 8px 边距
    const maxLeft = vw - pw - 8;
    if (viewportLeft > maxLeft) viewportLeft = maxLeft;
    if (viewportLeft < 8) viewportLeft = 8;
    // 换算成相对 wrap 的偏移；wrap 本身是 position:relative
    panel.style.left = `${Math.round(viewportLeft - wrapRect.left)}px`;
    panel.style.right = 'auto';
  };

  const openMenu = () => {
    if (open) return;
    open = true;
    wrap.setAttribute('data-open', 'true');
    setTimeout(() => {
      align();
      document.addEventListener('pointerdown', onDocDown, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', close, true);
    }, 0);
  };
  const toggle = (ev) => {
    if (ev) ev.preventDefault();
    open ? close() : openMenu();
  };

  for (const it of items) {
    if (!it) continue;
    if (it.heading) {
      // 分组小标题：菜单项多起来之后，一大串平铺很难扫读。
      // 用小标题按流程分组，比加更多分隔线更清楚。
      panel.appendChild(h('div', { class: 'menu-heading', text: it.heading }));
      continue;
    }
    if (it.divider) {
      panel.appendChild(h('div', { class: 'menu-divider' }));
      continue;
    }
    const btn = h('button', {
      class: `menu-item${it.danger ? ' is-danger' : ''}`,
      type: 'button',
      title: it.title || it.label,
      onclick: () => {
        close();
        it.onClick && it.onClick();
      }
    });
    if (it.icon) btn.appendChild(h('span', { class: 'menu-icon', text: it.icon }));
    btn.appendChild(h('span', { class: 'menu-label', text: it.label }));
    if (it.disabled) btn.disabled = true;
    if (it.hint) btn.appendChild(h('span', { class: 'menu-hint', text: it.hint }));
    panel.appendChild(btn);
  }

  // 所有条目都不可用时给一句原因 —— 否则用户点开只看到一片灰字，
  // 很容易以为「菜单是空的 / 坏了」。
  const actionable = items.filter((x) => x && !x.divider && !x.heading && !x.disabled);
  if (!actionable.length) {
    // 把「禁用」改成「暂时不可用」的说明，而不是留一堆灰按钮
    panel.textContent = '';
    panel.appendChild(h('div', { class: 'menu-empty', text: opts.emptyText || '暂时没有可用的操作' }));
    if (opts.emptyHint) panel.appendChild(h('div', { class: 'menu-empty-hint', text: opts.emptyHint }));
  }

  // 触发器：用 pointerdown 开关（与关闭监听同一事件类型，无竞态）
  trigger.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation();
    toggle();
  });
  // 键盘可达性：回车/空格也能开关
  trigger.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      toggle();
    }
  });

  wrap.appendChild(trigger);
  wrap.appendChild(panel);
  return wrap;
}

let activeDismissable = true;

export function openOverlay(title, body, buttons = [], opts = {}) {
  const root = document.getElementById('overlay-root');
  if (!root) return null;
  root.textContent = '';
  activeDismissable = opts.dismissable !== false;
  const card = h('div', { class: 'overlay-card' });
  if (opts.width) card.style.width = opts.width;
  const headChildren = [h('span', { text: title })];
  // 「不可取消」的浮层（例如首次向导）不提供 ×；否则 × 与 Esc 会绕过
  // 「跳过 / 完成」流程，wizardDone 永远不会被写入。
  if (activeDismissable) {
    headChildren.push(h('button', { class: 'btn btn-sm icon-btn', type: 'button', title: '关闭', text: '×', onclick: () => closeOverlays() }));
  }
  const head = h('div', { class: 'overlay-head' }, headChildren);
  const bodyEl = h('div', { class: 'overlay-body' });
  if (typeof body === 'string') bodyEl.textContent = body;
  else bodyEl.appendChild(body);
  card.appendChild(head);
  card.appendChild(bodyEl);
  if (buttons.length) {
    const foot = h('div', { class: 'overlay-foot' });
    for (const b of buttons) foot.appendChild(button(b.label, b.onClick, { small: true, primary: !!b.primary }));
    card.appendChild(foot);
  }
  root.appendChild(card);

  setBoolAttr(root, 'data-open', true);
  root.style.display = 'flex';
  root.style.pointerEvents = 'none'; // 关键
  card.style.pointerEvents = 'auto'; // 内部卡片单独设回
  root.onclick = (e) => {
    if (e.target === root && opts.dismissable !== false) closeOverlays();
  };
  return { root, card, body: bodyEl, close: closeOverlays };
}

export function closeOverlays() {
  const root = document.getElementById('overlay-root');
  if (!root) return;
  setBoolAttr(root, 'data-open', false);
  root.style.display = 'none';
  root.textContent = '';
  root.onclick = null;
  activeDismissable = true;
}

// 当前浮层是否允许用 Esc / 点遮罩关闭（向导这类流程页不允许）
export function canDismissOverlay() {
  const root = document.getElementById('overlay-root');
  if (!root || root.getAttribute('data-open') !== 'true') return true;
  return activeDismissable;
}

export function confirmDialog(title, message, onConfirm, opts = {}) {
  const body = h('div');
  body.appendChild(h('div', { text: message }));
  return openOverlay(
    title,
    body,
    [
      { label: opts.cancelLabel || '取消', onClick: () => closeOverlays() },
      {
        label: opts.confirmLabel || '确定',
        primary: true,
        onClick: () => {
          closeOverlays();
          onConfirm();
        }
      }
    ],
    { width: '360px' }
  );
}

export function promptDialog(title, value, onOk, opts = {}) {
  const body = h('div');
  const input = h('input', { class: 'input', value: value == null ? '' : value, placeholder: opts.placeholder || '' });
  const area = opts.multiline ? h('textarea', { class: 'input', style: { minHeight: '120px' } }) : null;
  if (area) area.value = value == null ? '' : value;
  body.appendChild(area || input);
  if (opts.hint) body.appendChild(h('div', { class: 'note', text: opts.hint }));
  const get = () => (area ? area.value : input.value);
  const submit = () => {
    closeOverlays();
    onOk(get());
  };
  const ov = openOverlay(
    title,
    body,
    [
      { label: '取消', onClick: () => closeOverlays() },
      { label: '确定', primary: true, onClick: submit }
    ],
    { width: '420px' }
  );
  (area || input).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (!area && !e.shiftKey))) {
      e.preventDefault();
      submit();
    }
  });
  setTimeout(() => (area || input).focus(), 30);
  return ov;
}
