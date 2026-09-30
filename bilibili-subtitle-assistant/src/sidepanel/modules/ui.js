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
  const close = () => {
    if (!open) return;
    open = false;
    wrap.removeAttribute('data-open');
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const onDocClick = (ev) => {
    if (!wrap.contains(ev.target)) close();
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      close();
      trigger.focus();
    }
  };
  const openMenu = () => {
    if (open) return;
    open = true;
    wrap.setAttribute('data-open', 'true');
    // 捕获阶段监听，保证点别处先于其它处理器关闭菜单
    setTimeout(() => {
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  };

  for (const it of items) {
    if (!it) continue;
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
  const actionable = items.filter((x) => x && !x.divider && !x.disabled);
  if (!actionable.length) {
    // 把「禁用」改成「暂时不可用」的说明，而不是留一堆灰按钮
    panel.textContent = '';
    panel.appendChild(h('div', { class: 'menu-empty', text: opts.emptyText || '暂时没有可用的操作' }));
    if (opts.emptyHint) panel.appendChild(h('div', { class: 'menu-empty-hint', text: opts.emptyHint }));
  }

  trigger.addEventListener('click', (ev) => {
    ev.stopPropagation();
    open ? close() : openMenu();
  });

  wrap.appendChild(trigger);
  wrap.appendChild(panel);
  return wrap;
}

export function openOverlay(title, body, buttons = [], opts = {}) {
  const root = document.getElementById('overlay-root');
  if (!root) return null;
  root.textContent = '';
  const card = h('div', { class: 'overlay-card' });
  if (opts.width) card.style.width = opts.width;
  const head = h('div', { class: 'overlay-head' }, [
    h('span', { text: title }),
    h('button', { class: 'btn btn-sm icon-btn', type: 'button', title: '关闭', text: '×', onclick: () => closeOverlays() })
  ]);
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
