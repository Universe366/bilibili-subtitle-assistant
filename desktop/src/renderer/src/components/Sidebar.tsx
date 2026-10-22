import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import {
  Captions,
  History as HistoryIcon,
  Library,
  ListChecks,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Settings,
  Sparkles
} from 'lucide-react';
import type { Section, TabInfo } from '../../../shared/types';
import { SubtitlesPanel } from './SubtitlesPanel';
import { ChatPanel } from './ChatPanel';
import { BatchPanel } from './BatchPanel';
import { HistoryPanel } from './HistoryPanel';
import { LibraryPanel } from './LibraryPanel';
import { SummaryPanel } from './SummaryPanel';
import { SettingsPanel } from './SettingsPanel';

type IconComponent = ComponentType<{ size?: number | string; className?: string }>;

const items: Array<{ id: Section; label: string; icon: IconComponent; hint: string }> = [
  { id: 'subtitles', label: '字幕', icon: Captions, hint: '当前视频的字幕与翻译' },
  { id: 'chat', label: '对话', icon: MessageSquare, hint: '基于字幕向 AI 提问' },
  { id: 'summary', label: '总结', icon: Sparkles, hint: 'AI 总结、章节与问答' },
  { id: 'library', label: '库', icon: Library, hint: '已入库的视频与笔记' },
  { id: 'batch', label: '批量', icon: ListChecks, hint: '勾选库内视频批量生成总结' },
  { id: 'history', label: '历史', icon: HistoryIcon, hint: '查看、打开或删除总结历史' },
  { id: 'settings', label: '设置', icon: Settings, hint: '平台、Key、提示词' }
];

export function Sidebar({
  section,
  onSelect,
  activeTab,
  tabCount,
  fontScale = 1,
  sidebarWidth = 320,
  onWidthChange,
  onWidthCommit,
  collapsed = false,
  position = 'left',
  onDockChange,
  onToggleCollapse
}: {
  section: Section;
  onSelect: (section: Section) => void;
  activeTab: TabInfo | null;
  tabCount: number;
  fontScale?: number;
  sidebarWidth?: number;
  onWidthChange?: (width: number) => void;
  onWidthCommit?: (width: number) => void;
  collapsed?: boolean;
  position?: 'left' | 'right';
  onDockChange?: (position: 'left' | 'right') => void;
  onToggleCollapse?: (collapsed: boolean) => void;
}) {
  const [version, setVersion] = useState('');
  const [dragSnapshot, setDragSnapshot] = useState<{
    src: string;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const dragActiveRef = useRef(false);

  const beginViewDrag = () => {
    const rect = document.querySelector('.browser-stage')?.getBoundingClientRect();
    dragActiveRef.current = true;
    void window.bsub.beginSidebarDrag().then((response) => {
      if (!dragActiveRef.current) return;
      if (response.ok && response.data && rect) {
        setDragSnapshot({
          src: response.data,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        });
      }
    });
  };

  const endViewDrag = () => {
    dragActiveRef.current = false;
    setDragSnapshot(null);
    void window.bsub.endSidebarDrag();
  };
  useEffect(() => {
    void window.bsub.getSettings().then((response) => {
      if (response.ok) setVersion(response.data.version);
    });
  }, []);

  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const startPosition = position;
    const crossedAt = (clientX: number) =>
      startPosition === 'left'
        ? clientX > window.innerWidth * 0.62
        : clientX < window.innerWidth * 0.38;
    const rawWidthAt = (clientX: number) => {
      const delta = startPosition === 'left' ? clientX - startX : startX - clientX;
      return startWidth + delta;
    };
    const move = (moveEvent: MouseEvent) => {
      const raw = rawWidthAt(moveEvent.clientX);
      const width = crossedAt(moveEvent.clientX)
        ? startWidth
        : Math.min(560, Math.max(260, raw));
      onWidthChange?.(width);
    };
    const up = (upEvent: MouseEvent) => {
      const crossed = crossedAt(upEvent.clientX);
      const raw = rawWidthAt(upEvent.clientX);
      if (raw < 190) {
        onToggleCollapse?.(true);
      } else if (crossed) {
        onDockChange?.(startPosition === 'left' ? 'right' : 'left');
      } else {
        onWidthCommit?.(Math.min(560, Math.max(260, raw)));
      }

      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const startDockDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;
    event.preventDefault();
    beginViewDrag();
    let restored = false;
    const restoreView = () => {
      if (restored) return;
      restored = true;
      endViewDrag();
    };
    const startX = event.clientX;
    let moved = false;
    const move = (moveEvent: MouseEvent) => {
      if (Math.abs(moveEvent.clientX - startX) > 4) moved = true;
    };
    const up = (upEvent: MouseEvent) => {
      if (moved) {
        const crossed =
          position === 'left'
            ? upEvent.clientX > window.innerWidth * 0.62
            : upEvent.clientX < window.innerWidth * 0.38;
        if (crossed) onDockChange?.(position === 'left' ? 'right' : 'left');
      }
      restoreView();
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', restoreView);
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', restoreView, { once: true });
  };

  const CollapseIcon = collapsed
    ? position === 'left'
      ? ChevronRight
      : ChevronLeft
    : position === 'left'
      ? ChevronLeft
      : ChevronRight;

  return (
    <aside
      className={`sidebar${collapsed ? ' is-collapsed' : ''}`}
      style={{ width: collapsed ? 56 : sidebarWidth }}
    >
      <div
        className="brand"
        onMouseDown={startDockDrag}
        title="按住标题栏拖动到另一侧"
      >
        <div className="brand-mark">字</div>
        <div className="brand-text">
          <div className="brand-name">字幕助手</div>
          <div className="brand-sub">Desktop</div>
        </div>
        <button
          className="sidebar-collapse"
          title={collapsed ? '展开侧栏' : '折叠侧栏'}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => onToggleCollapse?.(!collapsed)}
        >
          <CollapseIcon size={15} />
        </button>
      </div>

      <nav className="side-nav">
        {items.map(({ id, label, icon: Icon, hint }) => (
          <button
            key={id}
            className={`side-nav-item${section === id ? ' is-active' : ''}`}
            title={hint}
            onClick={() => onSelect(id)}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {!collapsed && (
        <div
          className="sidebar-resizer"
          onMouseDown={startResize}
          onDoubleClick={() => onToggleCollapse?.(true)}
          title="拖动调宽；拖得很窄会折叠；双击折叠；拖标题栏换边"
        />
      )}
      <div className="side-content" style={{ zoom: fontScale }}>
        {section === 'subtitles' && <SubtitlesPanel activeTab={activeTab} />}

        {section === 'chat' && (
          <ChatPanel activeTab={activeTab} onOpenSettings={() => onSelect('settings')} />
        )}

        {section === 'summary' && (
          <SummaryPanel activeTab={activeTab} onOpenSettings={() => onSelect('settings')} />
        )}

        {section === 'library' && <LibraryPanel />}

        {section === 'batch' && <BatchPanel />}

        {section === 'history' && <HistoryPanel />}

        {section === 'settings' && <SettingsPanel />}
      </div>

      {dragSnapshot && (
        <img
          className="drag-snapshot"
          src={dragSnapshot.src}
          alt=""
          style={{
            left: dragSnapshot.left,
            top: dragSnapshot.top,
            width: dragSnapshot.width,
            height: dragSnapshot.height
          }}
        />
      )}

      <div className="side-footer">
        <span className={`dot${tabCount > 0 ? ' is-on' : ''}`} />
        <span>插件未连接</span>
        <span className="side-version">{version ? `v${version}` : ''}</span>
      </div>
    </aside>
  );
}
