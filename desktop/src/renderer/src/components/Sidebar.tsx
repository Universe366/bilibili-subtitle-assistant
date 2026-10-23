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
import type { BridgeStatus, JobRecord, Section, TabInfo } from '../../../shared/types';
import { SubtitlesPanel } from './SubtitlesPanel';
import { ChatPanel } from './ChatPanel';
import { BatchPanel } from './BatchPanel';
import { HistoryPanel } from './HistoryPanel';
import { LibraryPanel } from './LibraryPanel';
import { SummaryPanel } from './SummaryPanel';
import { SettingsPanel } from './SettingsPanel';
import { TaskCenter } from './TaskCenter';

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
  onToggleCollapse,
  onDragSnapshot,
  onOpenSummary,
  onOpenChapters,
  hasUpdate = false
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
  onDragSnapshot?: (snapshot: string | null) => void;
  onOpenSummary?: () => void;
  onOpenChapters?: () => void;
  hasUpdate?: boolean;
}) {
  const [version, setVersion] = useState('');
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [taskOpen, setTaskOpen] = useState(false);
  const [visited, setVisited] = useState<Set<Section>>(() => new Set([section]));
  const dragActiveRef = useRef(false);

  // 底部状态以前是写死的「插件未连接」；桥由设置控制，也可能中途重启，
  // 所以按真实状态展示，并定期刷新。
  useEffect(() => {
    let alive = true;
    const sync = () => {
      void window.bsub.getBridgeStatus().then((response) => {
        if (alive && response.ok) setBridge(response.data);
      });
    };
    sync();
    const timer = window.setInterval(sync, 20000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void window.bsub.listJobs().then((response) => {
      if (alive && response.ok) setJobs(response.data);
    });
    const off = window.bsub.onJobsChanged((next) => setJobs(next));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const activeJobCount = jobs.filter(
    (job) => job.status === 'running' || job.status === 'paused'
  ).length;

  const bridgeLabel = (() => {
    if (!bridge) return '桥状态未知';
    if (!bridge.enabled) return '本地桥已关闭';
    if (bridge.running) return `插件已连接 · ${bridge.port}`;
    return bridge.error ? '插件桥未启动' : '插件未连接';
  })();

  // 面板首次显示后保持挂载：切换导航只切显示，正在跑的任务/会话状态不会丢。
  useEffect(() => {
    setVisited((previous) =>
      previous.has(section) ? previous : new Set(previous).add(section)
    );
  }, [section]);

  const beginViewDrag = () => {
    dragActiveRef.current = true;
    void window.bsub.beginSidebarDrag().then((response) => {
      if (!dragActiveRef.current) return;
      if (response.ok && response.data) onDragSnapshot?.(response.data);
    });
    window.setTimeout(() => {
      if (dragActiveRef.current) endViewDrag();
    }, 12000);
  };

  const endViewDrag = () => {
    dragActiveRef.current = false;
    onDragSnapshot?.(null);
    void window.bsub.endSidebarDrag();
  };
  useEffect(() => {
    void window.bsub.getSettings().then((response) => {
      if (response.ok) setVersion(response.data.version);
    });
  }, []);

  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    beginViewDrag();
    let restored = false;
    const restoreView = () => {
      if (restored) return;
      restored = true;
      endViewDrag();
    };
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

      restoreView();
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', restoreView);
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', restoreView, { once: true });
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
            {id === 'settings' && hasUpdate && <span className="side-update-dot" />}
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
        <div className={`side-panel${section === 'subtitles' ? ' is-active' : ''}`}>
          {visited.has('subtitles') && (
            <SubtitlesPanel
              activeTab={activeTab}
              active={section === 'subtitles' && !collapsed}
              onOpenSummary={onOpenSummary}
              onOpenChapters={onOpenChapters}
            />
          )}
        </div>

        <div className={`side-panel${section === 'chat' ? ' is-active' : ''}`}>
          {visited.has('chat') && (
            <ChatPanel activeTab={activeTab} onOpenSettings={() => onSelect('settings')} />
          )}
        </div>

        <div className={`side-panel${section === 'summary' ? ' is-active' : ''}`}>
          {visited.has('summary') && (
            <SummaryPanel activeTab={activeTab} onOpenSettings={() => onSelect('settings')} />
          )}
        </div>

        <div className={`side-panel${section === 'library' ? ' is-active' : ''}`}>
          {visited.has('library') && <LibraryPanel />}
        </div>

        <div className={`side-panel${section === 'batch' ? ' is-active' : ''}`}>
          {visited.has('batch') && <BatchPanel />}
        </div>

        <div className={`side-panel${section === 'history' ? ' is-active' : ''}`}>
          {visited.has('history') && <HistoryPanel />}
        </div>

        <div className={`side-panel${section === 'settings' ? ' is-active' : ''}`}>
          {visited.has('settings') && <SettingsPanel />}
        </div>
      </div>

      <div className="side-footer" title={bridge?.error || bridgeLabel}>
        <span className={`dot${bridge?.running ? ' is-on' : ''}`} />
        <span>{bridgeLabel}</span>
        {tabCount > 0 && <span>· {tabCount} 标签</span>}
        <button
          className={`task-toggle${activeJobCount ? ' is-active' : ''}`}
          title={activeJobCount ? `${activeJobCount} 个任务进行中` : '任务中心'}
          onClick={() => setTaskOpen((value) => !value)}
        >
          <ListChecks size={12} />
          {activeJobCount > 0 && <span className="task-count">{activeJobCount}</span>}
        </button>
        <span className="side-version">{version ? `v${version}` : ''}</span>
      </div>

      {!collapsed && (
        <TaskCenter open={taskOpen} jobs={jobs} onClose={() => setTaskOpen(false)} />
      )}
    </aside>
  );
}
