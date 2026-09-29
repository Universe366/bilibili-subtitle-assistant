// 任务与进度：进度条必须显示「任务名 + 百分比」（第七章），并能随时终止。

import { h, setBoolAttr, clear, button, fmtTime } from './dom.js';

const tasks = new Map();
let host = null;
let onChange = null;

export function setJobsHost(el, cb) {
  host = el;
  onChange = cb || null;
  render();
}

export function activeTasks() {
  return Array.from(tasks.values());
}

export function beginTask(name, opts = {}) {
  const id = `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
  const controller = new AbortController();
  const task = {
    id,
    name,
    detail: opts.detail || '',
    percent: 0,
    startedAt: Date.now(),
    controller,
    cancellable: opts.cancellable !== false,
    onCancel: opts.onCancel || null,
    total: opts.total || null
  };
  tasks.set(id, task);
  render();
  return {
    id,
    signal: controller.signal,
    set(percent, detail) {
      const t = tasks.get(id);
      if (!t) return;
      t.percent = Math.max(0, Math.min(100, Number(percent) || 0));
      if (detail !== undefined) t.detail = detail;
      render();
    },
    step(i, total, detail) {
      const pct = total ? (i / total) * 100 : 0;
      this.set(pct, detail === undefined ? `第 ${i}/${total} 片` : detail);
    },
    detail(text) {
      const t = tasks.get(id);
      if (t) {
        t.detail = text;
        render();
      }
    },
    end() {
      tasks.delete(id);
      render();
    },
    abort() {
      const t = tasks.get(id);
      if (t) {
        t.aborted = true;
        t.controller.abort();
        render();
      }
    }
  };
}

export function cancelAll() {
  for (const [, t] of tasks) t.controller.abort();
}

export function cancelTask(id) {
  const t = tasks.get(id);
  if (t) {
    t.controller.abort();
    if (t.onCancel) {
      try {
        t.onCancel();
      } catch (err) {
        /* ignore */
      }
    }
    tasks.delete(id);
    render();
  }
}

export function activeLabel() {
  if (!tasks.size) return '';
  const list = Array.from(tasks.values());
  const t = list[list.length - 1];
  return `${t.name}${t.detail ? ` · ${t.detail}` : ''}　${Math.round(t.percent)}%`;
}

function render() {
  if (!host) return;
  clear(host);
  if (!tasks.size) {
    setBoolAttr(host, 'data-visible', false);
    host.style.display = 'none';
  } else {
    setBoolAttr(host, 'data-visible', true);
    host.style.display = 'block';
  }
  for (const t of tasks.values()) {
    const row = h('div', { class: 'job' });
    row.appendChild(
      h('div', { class: 'job-head' }, [
        h('span', { class: 'job-name', text: t.detail ? `${t.name} · ${t.detail}` : t.name }),
        h('span', { class: 'job-percent', text: `${Math.round(t.percent)}%` }),
        t.cancellable
          ? button('终止', () => cancelTask(t.id), { small: true, danger: true, title: '终止该任务' })
          : null
      ])
    );
    const bar = h('div', { class: 'bar' });
    const fill = h('div', { class: 'bar-fill' });
    fill.style.width = `${Math.round(t.percent)}%`;
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(h('div', { class: 'job-foot', text: `已运行 ${fmtTime((Date.now() - t.startedAt) / 1000)}` }));
    host.appendChild(row);
  }
  if (onChange) onChange(activeTasks());
}

// 定时刷新「已运行」时长
setInterval(() => {
  if (tasks.size) render();
}, 1000);
