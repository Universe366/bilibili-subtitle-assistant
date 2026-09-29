// 浮层基础设施。
// 稳定性 #3：全屏遮罩背景必须 pointer-events: none，内部卡片单独设回 auto，
// 否则滚轮和点击会被吃掉。

import { h, button, setBoolAttr } from './dom.js';

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
