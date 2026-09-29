// DOM 小工具 + 通用格式化。
// 稳定性 #1：控制显示/隐藏的布尔属性一律序列化为 "true"/"false" 字符串。

export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

export function applyAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'className') {
      el.className = String(v);
    } else if (k === 'text') {
      el.textContent = String(v);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(el.style, v);
    } else if (k === 'dataset' && typeof v === 'object') {
      for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = String(dv);
    } else if (k === 'bool') {
      el.setAttribute(String(v), 'true');
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'value') {
      el.value = v;
    } else if (k === 'checked' || k === 'disabled' || k === 'selected') {
      el[k] = !!v;
    } else {
      el.setAttribute(k, String(v));
    }
  }
  return el;
}

// 布尔属性 -> "true"/"false"（绝不用空字符串，见稳定性 #1）
export function setBoolAttr(el, name, value) {
  if (!el) return;
  el.setAttribute(name, value ? 'true' : 'false');
}

export function append(el, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(String(c)));
    else if (c instanceof Node) el.appendChild(c);
  }
  return el;
}

export function clear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

export function iconBtn(label, title, onClick, cls = '') {
  return h('button', {
    class: `btn icon-btn ${cls}`.trim(),
    type: 'button',
    title,
    'aria-label': title,
    onclick: onClick,
    text: label
  });
}

export function button(label, onClick, opts = {}) {
  return h('button', {
    class: `btn ${opts.primary ? 'btn-primary' : ''} ${opts.danger ? 'btn-danger' : ''} ${opts.small ? 'btn-sm' : ''} ${opts.cls || ''}`.trim(),
    type: 'button',
    title: opts.title || label,
    disabled: !!opts.disabled,
    onclick: onClick,
    text: label
  });
}

export function field(labelText, control, hint) {
  return h('label', { class: 'field' }, [
    h('span', { class: 'field-label', text: labelText }),
    control,
    hint ? h('span', { class: 'field-hint', text: hint }) : null
  ]);
}

export function textInput(value, onInput, opts = {}) {
  return h('input', {
    class: 'input',
    type: opts.password ? 'password' : 'text',
    value: value == null ? '' : value,
    placeholder: opts.placeholder || '',
    disabled: !!opts.disabled,
    oninput: onInput ? (e) => onInput(e.target.value, e) : undefined,
    onchange: opts.onChange ? (e) => opts.onChange(e.target.value, e) : undefined
  });
}

export function numberInput(value, onInput, opts = {}) {
  return h('input', {
    class: 'input',
    type: 'number',
    value: value == null ? '' : value,
    min: opts.min,
    max: opts.max,
    step: opts.step || 1,
    oninput: onInput ? (e) => onInput(Number(e.target.value), e) : undefined
  });
}

export function select(value, options, onChange) {
  const el = h('select', { class: 'input', onchange: (e) => onChange(e.target.value, e) });
  for (const o of options) {
    el.appendChild(
      h('option', { value: o.value, text: o.label, selected: String(o.value) === String(value) })
    );
  }
  return el;
}

export function checkbox(checked, onChange, labelText) {
  const input = h('input', {
    type: 'checkbox',
    checked: !!checked,
    onchange: (e) => onChange(e.target.checked, e)
  });
  return h('label', { class: 'check' }, [input, h('span', { text: labelText || '' })]);
}

export function collapsible(title, openDefault, bodyFn, opts = {}) {
  const key = opts.stateKey || title;
  const wrap = h('section', { class: 'group' });
  const head = h('button', {
    class: 'group-head',
    type: 'button',
    onclick: () => {
      const body = wrap.querySelector('.group-body');
      const now = body.getAttribute('data-open') !== 'true';
      setBoolAttr(body, 'data-open', now);
      body.style.display = now ? 'block' : 'none';
      setBoolAttr(head, 'data-open', now);
      if (opts.onToggle) opts.onToggle(key, now);
    }
  });
  head.appendChild(h('span', { class: 'group-title', text: title }));
  head.appendChild(h('span', { class: 'group-caret', text: '▾' }));
  const body = h('div', { class: 'group-body' });
  const open = typeof opts.isOpen === 'function' ? opts.isOpen(key, openDefault) : openDefault;
  setBoolAttr(body, 'data-open', !!open);
  setBoolAttr(head, 'data-open', !!open);
  body.style.display = open ? 'block' : 'none';
  wrap.appendChild(head);
  wrap.appendChild(body);
  if (bodyFn) bodyFn(body);
  return wrap;
}

// ---------------------------------------------------------------------------
// 格式化
// ---------------------------------------------------------------------------

export function fmtTime(seconds, opts = {}) {
  const s = Math.max(0, Number(seconds) || 0);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const pad = (n) => String(n).padStart(2, '0');
  if (opts.ms) {
    const ms = Math.floor((s - Math.floor(s)) * 1000);
    return `${pad(hh)}:${pad(mm)}:${pad(ss)}.${String(ms).padStart(3, '0')}`;
  }
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

export function fmtSrtTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)},${pad(ms, 3)}`;
}

export function fmtVttTime(seconds) {
  return fmtSrtTime(seconds).replace(',', '.');
}

export function fmtAssTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${hh}:${pad(mm)}:${pad(ss)}.${pad(cs)}`;
}

export function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtRelative(ts) {
  if (!ts) return '-';
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return new Date(ts).toLocaleString('zh-CN');
}

export function copyText(text) {
  const s = String(text == null ? '' : text);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(s).catch(() => fallbackCopy(s));
  }
  return Promise.resolve(fallbackCopy(s));
}

function fallbackCopy(s) {
  try {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return true;
  } catch (err) {
    return false;
  }
}

export function downloadFile(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 500);
  return { filename, bytes: blob.size };
}

export function debounce(fn, ms = 200) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function toast(message, kind = 'info', ms = 2600) {
  let host = document.getElementById('__bsub_toasts__');
  if (!host) {
    host = h('div', { id: '__bsub_toasts__', class: 'toasts' });
    document.body.appendChild(host);
  }
  const el = h('div', { class: `toast toast-${kind}` }, [
    h('div', { class: 'toast-title', text: message.title || message }),
    message.detail ? h('div', { class: 'toast-detail', text: message.detail }) : null,
    message.action ? h('div', { class: 'toast-action', text: message.action }) : null
  ]);
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, ms);
  return el;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
