/**
 * 网页内划词工具条。
 *
 * 通过 CDP 的 `Runtime.addBinding` 把用户动作送回主进程，再转发给 renderer 打开对话。
 * 工具条用 Shadow DOM 隔离，样式全部走 CSSOM，尽量不受站点 CSP 影响。
 */
export const SELECTION_TOOLBAR_SCRIPT = String.raw`
(() => {
  if (window.__bsubSelectionToolbarInstalled) return;

  function install() {
    if (!document.documentElement) {
      document.addEventListener('DOMContentLoaded', install, { once: true });
      return;
    }
    if (window.__bsubSelectionToolbarInstalled) return;
    window.__bsubSelectionToolbarInstalled = true;

    var host = document.createElement('div');
    host.id = '__bsub_selection_toolbar__';
    host.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'display:none',
      'transform:translate(-50%,-100%)', 'pointer-events:auto'
    ].join(';');
    var shadow = host.attachShadow({ mode: 'open' });
    var box = document.createElement('div');
    box.style.cssText = [
      'display:flex', 'gap:2px', 'padding:4px', 'border-radius:10px',
      'background:#1f1f22', 'box-shadow:0 6px 20px rgba(0,0,0,.28)',
      'font:12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'color:#fff', 'user-select:none'
    ].join(';');
    shadow.appendChild(box);

    var actions = [
      { id: 'explain', label: '解释' },
      { id: 'translate', label: '翻译' },
      { id: 'summarize', label: '总结' }
    ];
    actions.forEach(function (action) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.dataset.act = action.id;
      button.style.cssText = [
        'all:unset', 'cursor:pointer', 'padding:6px 9px', 'border-radius:7px',
        'color:#fff', 'font-size:12px', 'line-height:1'
      ].join(';');
      button.addEventListener('mouseenter', function () { button.style.background = '#3a3a40'; });
      button.addEventListener('mouseleave', function () { button.style.background = 'transparent'; });
      box.appendChild(button);
    });

    document.documentElement.appendChild(host);

    var selected = '';
    var hideTimer = 0;

    function hide() {
      window.clearTimeout(hideTimer);
      host.style.display = 'none';
    }

    function show(x, y) {
      var width = 188;
      var left = Math.min(Math.max(8, x), window.innerWidth - width / 2 - 8);
      var top = Math.max(44, y);
      host.style.left = left + 'px';
      host.style.top = top + 'px';
      host.style.display = 'block';
    }

    function isEditable(node) {
      var el = node && (node.nodeType === 3 ? node.parentElement : node);
      if (!el || !el.closest) return false;
      return Boolean(el.closest('input,textarea,[contenteditable="true"],[contenteditable=""]'));
    }

    document.addEventListener('mouseup', function (event) {
      if (host.contains(event.target)) return;
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(function () {
        var selection = window.getSelection();
        var text = String((selection && selection.toString()) || '').trim();
        if (!text || text.length < 2 || isEditable(selection && selection.anchorNode)) {
          hide();
          return;
        }
        selected = text.slice(0, 4000);
        var rect = null;
        try {
          var range = selection.getRangeAt(0);
          rect = range.getBoundingClientRect();
        } catch (error) {
          rect = null;
        }
        var x = rect && rect.width ? rect.left + rect.width / 2 : event.clientX;
        var y = rect && rect.height ? rect.top - 10 : event.clientY - 10;
        show(x, y);
      }, 20);
    });

    document.addEventListener('mousedown', function (event) {
      if (host.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      hide();
    }, true);

    shadow.addEventListener('click', function (event) {
      var target = event.target;
      var action = target && target.dataset ? target.dataset.act : '';
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        if (window.__bsubSelectionAction) {
          window.__bsubSelectionAction(JSON.stringify({ action: action, text: selected }));
        }
      } catch (error) {
        // ignore
      }
      hide();
    });

    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
  }

  install();
})();
`;
