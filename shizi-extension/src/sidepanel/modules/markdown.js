// 安全 Markdown 渲染器：全部用 createElement / textContent 构建，绝不使用 innerHTML。
// 支持：标题、粗体、斜体、行内代码、代码块、表格、有序/无序列表、引用块、
//       高亮块（:::note / [!NOTE] / ==mark==）、分隔线、链接、图片、删除线。
// AI 输出不可信，因此所有文本都走 textContent，URL 走白名单。
//
// 行内解析用「一次性 token 扫描 + 定界符匹配」，不使用会灾难性回溯的惰性表达式
// （例如 `\*(?<t>[\s\S]*?)\*` 在含多个 * 的文本上会指数级回溯，直接卡死界面）。

const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

export function safeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    try {
      const u = new URL(s);
      if (!SAFE_PROTOCOLS.includes(u.protocol)) return null;
      return u.href;
    } catch (err) {
      return null;
    }
  }
  if (s.startsWith('#')) return s;
  return null;
}

// 行内 token 扫描：每类结构都用「排除定界符」的定长表达式，保证线性时间。
// 注意：必须使用「非全局」正则 + 手动推进扫描位置，因为本函数是递归的，
// 若共用带 lastIndex 的全局正则，内层递归会把外层的游标重置，导致死循环。
const TOKEN_RE = new RegExp(
  [
    '\\\\(?<esc>[\\\\`*_[\\]()~=#>!-])', // 反斜杠转义
    '`(?<codeBody2>[^`]*)`', // 单反引号行内代码
    '(?<code>`+)(?<codeBody>[^`]*?)\\k<code>', // 多反引号行内代码
    '(?<img>!\\[(?<imgAlt>[^\\]\\n]*)\\]\\((?<imgUrl>[^)\\s]+)(?:\\s+"[^"\\n]*")?\\))',
    '(?<link>\\[(?<linkText>[^\\]\\n]*)\\]\\((?<linkUrl>[^)\\s]+)(?:\\s+"[^"\\n]*")?\\))',
    '(?<bold>\\*\\*(?<boldText>[^\\n]+?)\\*\\*)',
    '(?<ul>__(?<ulText>[^\\n]+?)__)',
    '(?<del>~~(?<delText>[^\\n]+?)~~)',
    '(?<mark>==(?<markText>[^\\n]+?)==)',
    '(?<em>\\*(?<emText>[^*\\n]+)\\*)',
    '(?<em2>_(?<emText2>[^_\\n]+)_)',
    '(?<auto>https?://[^\\s<>()"\\]]+)'
  ].join('|')
);

export function renderInline(text, ctx = {}) {
  const frag = document.createDocumentFragment();
  renderInlineInto(frag, String(text == null ? '' : text), ctx, 0);
  return frag;
}

function renderInlineInto(parent, src, ctx, depth) {
  if (depth > 6) {
    parent.appendChild(document.createTextNode(src));
    return parent;
  }
  let last = 0;
  for (;;) {
    const m = TOKEN_RE.exec(src.slice(last));
    if (!m) break;
    const at = last + m.index;
    if (at > last) parent.appendChild(document.createTextNode(src.slice(last, at)));
    const g = m.groups || {};
    if (g.esc !== undefined) {
      parent.appendChild(document.createTextNode(g.esc));
    } else if (g.codeBody !== undefined || g.codeBody2 !== undefined) {
      const code = document.createElement('code');
      code.className = 'md-code-inline';
      code.textContent = g.codeBody !== undefined ? g.codeBody : g.codeBody2;
      parent.appendChild(code);
    } else if (g.imgUrl !== undefined) {
      const url = safeUrl(g.imgUrl);
      if (url) {
        const img = document.createElement('img');
        img.className = 'md-img';
        img.src = url;
        img.alt = g.imgAlt || '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        parent.appendChild(img);
      } else {
        parent.appendChild(document.createTextNode(g.imgAlt || '图片'));
      }
    } else if (g.linkUrl !== undefined) {
      const url = safeUrl(g.linkUrl);
      if (url) {
        const a = document.createElement('a');
        a.className = 'md-link';
        a.href = url;
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        renderInlineInto(a, g.linkText || url, ctx, depth + 1);
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(g.linkText || g.linkUrl || ''));
      }
    } else if (g.auto !== undefined) {
      const url = safeUrl(g.auto);
      if (url) {
        const a = document.createElement('a');
        a.className = 'md-link';
        a.href = url;
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        a.textContent = g.auto;
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(g.auto));
      }
    } else if (g.boldText !== undefined || g.ulText !== undefined) {
      const b = document.createElement('strong');
      renderInlineInto(b, g.boldText !== undefined ? g.boldText : g.ulText, ctx, depth + 1);
      parent.appendChild(b);
    } else if (g.delText !== undefined) {
      const d = document.createElement('del');
      renderInlineInto(d, g.delText, ctx, depth + 1);
      parent.appendChild(d);
    } else if (g.markText !== undefined) {
      const mk = document.createElement('mark');
      mk.className = 'md-mark';
      renderInlineInto(mk, g.markText, ctx, depth + 1);
      parent.appendChild(mk);
    } else if (g.emText !== undefined || g.emText2 !== undefined) {
      const i = document.createElement('em');
      renderInlineInto(i, g.emText !== undefined ? g.emText : g.emText2, ctx, depth + 1);
      parent.appendChild(i);
    }
    last = at + (m[0].length || 1);
    if (last >= src.length) break;
  }
  if (last < src.length) parent.appendChild(document.createTextNode(src.slice(last)));
  return parent;
}

// 行内文本 -> 纯字符串（搜索、复制用）
// ---------------------------------------------------------------------------
// 块级解析
// ---------------------------------------------------------------------------

function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i += 1;
      continue;
    }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function isDelimiterRow(line) {
  if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) return false;
  if (!line.includes('-')) return false;
  return splitTableRow(line).every((c) => /^:?-{2,}:?$/.test(c.trim()) || c.trim() === '');
}

function alignmentsOf(line) {
  return splitTableRow(line).map((c) => {
    const t = c.trim();
    const left = t.startsWith(':');
    const right = t.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

// 解析为 DOM 片段
export function renderMarkdown(text, opts = {}) {
  const frag = document.createDocumentFragment();
  renderBlocksInto(frag, String(text == null ? '' : text), opts, 0);
  return frag;
}

function renderBlocksInto(frag, text, opts, depth) {
  if (depth > 5) {
    const p = document.createElement('p');
    p.className = 'md-p';
    p.textContent = text;
    frag.appendChild(p);
    return frag;
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const push = (el) => frag.appendChild(el);

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/);
    if (fence) {
      const marker = fence[1][0].repeat(3);
      const lang = fence[2] || '';
      const body = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s*${marker}`).test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      const pre = document.createElement('pre');
      pre.className = 'md-pre';
      const code = document.createElement('code');
      if (lang) code.setAttribute('data-lang', lang);
      code.textContent = body.join('\n');
      pre.appendChild(code);
      if (lang) {
        const tag = document.createElement('span');
        tag.className = 'md-lang';
        tag.textContent = lang;
        pre.appendChild(tag);
      }
      push(pre);
      continue;
    }

    // 分隔线
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      const hr = document.createElement('hr');
      hr.className = 'md-hr';
      push(hr);
      i += 1;
      continue;
    }

    // 标题
    const hd = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (hd) {
      const level = Math.min(6, hd[1].length);
      const el = document.createElement(`h${level}`);
      el.className = `md-h md-h${level}`;
      el.appendChild(renderInline(hd[2]));
      push(el);
      i += 1;
      continue;
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      const head = splitTableRow(line);
      const aligns = alignmentsOf(lines[i + 1]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      const wrap = document.createElement('div');
      wrap.className = 'md-table-wrap';
      const table = document.createElement('table');
      table.className = 'md-table';
      const thead = document.createElement('thead');
      const htr = document.createElement('tr');
      head.forEach((cell, ci) => {
        const th = document.createElement('th');
        if (aligns[ci]) th.style.textAlign = aligns[ci];
        th.appendChild(renderInline(cell));
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (const r of rows) {
        const tr = document.createElement('tr');
        for (let ci = 0; ci < head.length; ci += 1) {
          const td = document.createElement('td');
          if (aligns[ci]) td.style.textAlign = aligns[ci];
          td.appendChild(renderInline(r[ci] == null ? '' : r[ci]));
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      push(wrap);
      continue;
    }

    // 引用块 / 高亮块（> [!NOTE]）
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      const joined = body.join('\n');
      const callout = joined.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i);
      const box = document.createElement('div');
      if (callout) {
        box.className = `md-callout md-callout-${callout[1].toLowerCase()}`;
        renderBlocksInto(box, joined.slice(callout[0].length), opts, depth + 1);
      } else {
        box.className = 'md-quote';
        renderBlocksInto(box, joined, opts, depth + 1);
      }
      push(box);
      continue;
    }

    // 冒号高亮块 :::note ... :::
    const admon = line.match(/^\s*:::\s*([A-Za-z]+)?\s*$/);
    if (admon) {
      const kind = (admon[1] || 'note').toLowerCase();
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*:::\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      const box = document.createElement('div');
      box.className = `md-callout md-callout-${kind}`;
      renderBlocksInto(box, body.join('\n'), opts, depth + 1);
      push(box);
      continue;
    }

    // 列表
    const listMatch = line.match(/^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[2]);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      list.className = 'md-list';
      if (ordered) list.start = Number(String(listMatch[2]).replace(/[.)]$/, '')) || 1;
      while (i < lines.length) {
        const cur = lines[i];
        const lm = cur.match(/^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/);
        if (!lm) {
          if (/^\s{2,}\S/.test(cur) && list.lastElementChild) {
            list.lastElementChild.appendChild(document.createTextNode(' '));
            list.lastElementChild.appendChild(renderInline(cur.trim()));
            i += 1;
            continue;
          }
          break;
        }
        if (/^\d/.test(lm[2]) !== ordered) break;
        const li = document.createElement('li');
        li.className = 'md-li';
        const task = lm[3].match(/^\[( |x|X)\]\s*(.*)$/);
        if (task) {
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.disabled = true;
          cb.checked = task[1].toLowerCase() === 'x';
          cb.className = 'md-task';
          li.appendChild(cb);
          li.appendChild(renderInline(task[2]));
        } else {
          li.appendChild(renderInline(lm[3]));
        }
        list.appendChild(li);
        i += 1;
        if (i < lines.length && /^\s+([-*+]|\d{1,9}[.)])\s+/.test(lines[i])) {
          const sub = [];
          while (i < lines.length && /^\s+([-*+]|\d{1,9}[.)])\s+/.test(lines[i])) {
            sub.push(lines[i].replace(/^\s{2,}/, ''));
            i += 1;
          }
          renderBlocksInto(li, sub.join('\n'), opts, depth + 1);
        }
      }
      push(list);
      continue;
    }

    // 空行
    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }

    // 段落
    const para = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^\s*(```+|~~~+)/.test(lines[i]) &&
      !/^\s{0,3}#{1,6}\s/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^(\s*)([-*+]|\d{1,9}[.)])\s+/.test(lines[i]) &&
      !/^\s*:::\s*[A-Za-z]*\s*$/.test(lines[i]) &&
      !/^\s*([-*_])\s*(\1\s*){2,}$/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isDelimiterRow(lines[i + 1]))
    ) {
      para.push(lines[i]);
      i += 1;
    }
    if (para.length) {
      const p = document.createElement('p');
      p.className = 'md-p';
      para.forEach((seg, idx) => {
        if (idx) p.appendChild(document.createElement('br'));
        p.appendChild(renderInline(seg));
      });
      push(p);
    } else {
      i += 1;
    }
  }
  return frag;
}

export function renderMarkdownInto(container, text, opts = {}) {
  container.textContent = '';
  container.appendChild(renderMarkdown(text, opts));
  return container;
}
