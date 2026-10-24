/** 注入到每个页面：全局播放倍速（视频/音频）+ 快捷键 + 小 HUD。 */
export const MEDIA_CONTROL_SCRIPT = String.raw`
(() => {
  if (window.__shiziMediaControl) return;
  window.__shiziMediaControl = true;

  let rate = 1;
  let hideTimer = null;

  const ensureHud = () => {
    let hud = document.getElementById('shizi-rate-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'shizi-rate-hud';
      hud.style.cssText = [
        'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
        'padding:4px 9px', 'border-radius:999px', 'background:rgba(20,20,24,.78)',
        'color:#fff', 'font:12px/1.4 system-ui,sans-serif', 'pointer-events:none',
        'opacity:0', 'transition:opacity .18s ease'
      ].join(';');
      document.documentElement.appendChild(hud);
    }
    return hud;
  };

  const showHud = () => {
    const hud = ensureHud();
    hud.textContent = '倍速 ' + rate.toFixed(2) + '×';
    hud.style.opacity = '1';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { hud.style.opacity = '0'; }, 1200);
  };

  const videos = () => Array.from(document.querySelectorAll('video, audio'));

  const apply = () => {
    for (const item of videos()) {
      try {
        if (Math.abs(item.playbackRate - rate) > 0.001) item.playbackRate = rate;
      } catch {
        // ignore
      }
    }
  };

  window.__shiziSetRate = (value) => {
    const next = Math.min(4, Math.max(0.25, Number(value) || 1));
    rate = next;
    apply();
    showHud();
  };
  window.__shiziGetRate = () => rate;

  // Alt+Shift+↑/↓ 调速，Alt+Shift+0 复位；避免和 B 站 D/F 等快捷键冲突。
  window.addEventListener('keydown', (event) => {
    if (!event.altKey || !event.shiftKey) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      window.__shiziSetRate(rate + 0.25);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      window.__shiziSetRate(rate - 0.25);
    } else if (event.key === '0' || event.key === ')') {
      event.preventDefault();
      event.stopPropagation();
      window.__shiziSetRate(1);
    }
  }, true);

  document.addEventListener('play', () => {
    apply();
    if (rate !== 1) showHud();
  }, true);

  // 有些站点在播放开始后重置 playbackRate，低频兜底。
  setInterval(() => {
    if (rate === 1) return;
    for (const item of videos()) {
      if (Math.abs(item.playbackRate - rate) > 0.01) {
        try { item.playbackRate = rate; } catch { /* ignore */ }
      }
    }
  }, 3000);
})();
`;
