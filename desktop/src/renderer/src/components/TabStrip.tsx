import { useEffect, useRef, useState } from 'react';
import { Globe, Loader2, Moon, Plus, Search, X } from 'lucide-react';
import type { TabInfo } from '../../../shared/types';
import { moveIndexFor } from '../lib/tabs';

interface TabMenuState {
  x: number;
  y: number;
  tab: TabInfo;
}

export function TabStrip({
  tabs,
  onSearch
}: {
  tabs: TabInfo[];
  onSearch?: () => void;
}) {
  const [menu, setMenu] = useState<TabMenuState | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const closeOthers = (keepId: string) => {
    for (const tab of tabs) {
      if (tab.id !== keepId) void window.bsub.closeTab(tab.id);
    }
  };

  const closeToRight = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    for (const tab of tabs.slice(index + 1)) void window.bsub.closeTab(tab.id);
  };

  return (
    <div className="tab-strip">
      <div className="tab-strip-list">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab${tab.active ? ' is-active' : ''}${tab.suspended ? ' is-suspended' : ''}`}
            title={`${tab.title}${tab.suspended ? '（已休眠，点击恢复）' : ''}`}
            draggable
            onDragStart={() => setDraggingId(tab.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (draggingId && draggingId !== tab.id) {
                void window.bsub.moveTab(draggingId, moveIndexFor(tabs, draggingId, tab.id));
              }
              setDraggingId(null);
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                void window.bsub.closeTab(tab.id);
              }
            }}
            onClick={() => void window.bsub.activateTab(tab.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ x: event.clientX, y: event.clientY, tab });
            }}
          >
            <span className="tab-icon">
              {tab.loading ? (
                <Loader2 size={13} className="spin" />
              ) : tab.suspended ? (
                <Moon size={13} />
              ) : (
                <Globe size={13} />
              )}
            </span>
            <span className="tab-title">{tab.title || '新标签页'}</span>
            <button
              className="tab-close"
              title="关闭标签页"
              onClick={(event) => {
                event.stopPropagation();
                void window.bsub.closeTab(tab.id);
              }}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="tab-search"
        title="全局搜索（Ctrl+K）"
        onClick={() => onSearch?.()}
      >
        <Search size={14} />
      </button>
      <button className="tab-new" title="新建标签页" onClick={() => void window.bsub.newTab()}>
        <Plus size={15} />
      </button>

      {menu && (
        <div
          ref={menuRef}
          className="tab-menu"
          style={{ position: 'fixed', left: menu.x, top: menu.y }}
          role="menu"
        >
          <button
            className="tab-menu-item"
            onClick={() => {
              void window.bsub.closeTab(menu.tab.id);
              setMenu(null);
            }}
          >
            关闭
          </button>
          <button
            className="tab-menu-item"
            onClick={() => {
              closeOthers(menu.tab.id);
              setMenu(null);
            }}
          >
            关闭其他
          </button>
          <button
            className="tab-menu-item"
            onClick={() => {
              closeToRight(menu.tab.id);
              setMenu(null);
            }}
          >
            关闭右侧
          </button>
          <button
            className="tab-menu-item"
            onClick={() => {
              void window.bsub.writeClipboard(menu.tab.url);
              setMenu(null);
            }}
          >
            复制链接
          </button>
        </div>
      )}
    </div>
  );
}
