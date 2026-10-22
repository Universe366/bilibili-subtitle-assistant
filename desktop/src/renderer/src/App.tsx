import { useEffect, useMemo, useState } from 'react';
import type { FindResult, Section, TabInfo } from '../../shared/types';
import { TabStrip } from './components/TabStrip';
import { AddressBar } from './components/AddressBar';
import { FindBar } from './components/FindBar';
import { Sidebar } from './components/Sidebar';
import { BrowserStage } from './components/BrowserStage';

export default function App() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [section, setSection] = useState<Section>(() => {
    const value = new URLSearchParams(window.location.search).get('section');
    return value === 'chat' ||
      value === 'summary' ||
      value === 'library' ||
      value === 'batch' ||
      value === 'history' ||
      value === 'settings' ||
      value === 'subtitles'
      ? value
      : 'subtitles';
  });
  const [addressFocus, setAddressFocus] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResult, setFindResult] = useState<FindResult | null>(null);
  const [fontScale, setFontScale] = useState(1);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [sidebarPosition, setSidebarPosition] = useState<'left' | 'right'>('left');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dragSnapshot, setDragSnapshot] = useState<string | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);

  const applyLayout = (snapshot: { settings: { general: { sidebarWidth: number; sidebarPosition: 'left' | 'right'; sidebarCollapsed: boolean } } }) => {
    setSidebarWidth(snapshot.settings.general.sidebarWidth);
    setSidebarPosition(snapshot.settings.general.sidebarPosition);
    setSidebarCollapsed(snapshot.settings.general.sidebarCollapsed);
  };

  useEffect(() => {
    const apply = (state: string) =>
      setHasUpdate(['available', 'downloading', 'downloaded'].includes(state));
    void window.bsub.getUpdateStatus().then((response) => {
      if (response.ok) apply(response.data.state);
    });
    return window.bsub.onUpdateStatus((status) => apply(status.state));
  }, []);

  const commitSidebarWidth = (width: number) => {
    setSidebarWidth(width);
    void window.bsub.setSidebarLayout({ width }).then((response) => {
      if (response.ok) applyLayout(response.data);
    });
  };

  const commitSidebarPosition = (position: 'left' | 'right') => {
    setSidebarPosition(position);
    void window.bsub.setSidebarLayout({ position }).then((response) => {
      if (response.ok) applyLayout(response.data);
    });
  };

  const commitSidebarToggle = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    void window.bsub.setSidebarLayout({ collapsed }).then((response) => {
      if (response.ok) applyLayout(response.data);
    });
  };

  const active = useMemo(() => tabs.find((tab) => tab.active) ?? null, [tabs]);

  useEffect(() => {
    let alive = true;
    window.bsub
      .listTabs()
      .then((list) => {
        if (alive) setTabs(list);
      })
      .catch(() => {
        // 主进程尚未就绪时忽略，后续事件会补上
      });
    const off = window.bsub.onTabs((list) => setTabs(list));
    return () => {
      alive = false;
      off();
    };
  }, []);

  useEffect(() => {
    void window.bsub.getSettings().then((response) => {
      if (response.ok) {
        setFontScale(response.data.settings.general.fontScale || 1);
        applyLayout(response.data);
      }
    });
    return window.bsub.onSettingsChanged((snapshot) => {
      setFontScale(snapshot.settings.general.fontScale || 1);
      applyLayout(snapshot);
    });
  }, []);

  useEffect(() => {
    return window.bsub.onFindResult((result) => {
      if (active && result.tabId === active.id) setFindResult(result);
    });
  }, [active]);

  useEffect(() => {
    if (!findOpen) return;
    if (!findQuery) {
      setFindResult(null);
      void window.bsub.stopFind();
      return;
    }
    const timer = window.setTimeout(() => {
      void window.bsub.findInPage(findQuery);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [findQuery, findOpen]);

  useEffect(() => {
    if (!findOpen) return;
    setFindResult(null);
    if (findQuery) void window.bsub.findInPage(findQuery);
  }, [active?.id]);

  const closeFind = () => {
    setFindOpen(false);
    setFindQuery('');
    setFindResult(null);
    void window.bsub.stopFind();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod && key === 't') {
        event.preventDefault();
        void window.bsub.newTab();
        return;
      }
      if (mod && key === 'w') {
        event.preventDefault();
        if (active) void window.bsub.closeTab(active.id);
        return;
      }
      if (mod && key === 'l') {
        event.preventDefault();
        setAddressFocus((value) => value + 1);
        return;
      }
      if (mod && key === 'f') {
        event.preventDefault();
        setFindOpen(true);
        return;
      }
      if (mod && key === 'r') {
        event.preventDefault();
        void window.bsub.reload();
        return;
      }
      if (mod && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        void window.bsub.zoomIn();
        return;
      }
      if (mod && event.key === '-') {
        event.preventDefault();
        void window.bsub.zoomOut();
        return;
      }
      if (mod && event.key === '0') {
        event.preventDefault();
        void window.bsub.zoomReset();
        return;
      }
      if (event.key === 'F5') {
        event.preventDefault();
        void window.bsub.reload();
        return;
      }
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        void window.bsub.back();
        return;
      }
      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        void window.bsub.forward();
        return;
      }
      if (event.key === 'Escape' && findOpen) {
        closeFind();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, findOpen, findQuery]);

  return (
    <div className="app-shell">
      <TabStrip tabs={tabs} />
      <AddressBar tab={active} focusSignal={addressFocus} />
      {findOpen && (
        <FindBar
          query={findQuery}
          result={findResult}
          onChange={setFindQuery}
          onNext={() => void window.bsub.findInPage(findQuery, { forward: true, findNext: true })}
          onPrev={() => void window.bsub.findInPage(findQuery, { forward: false, findNext: true })}
          onClose={closeFind}
        />
      )}
      <div className={`app-body sidebar-${sidebarPosition}${sidebarCollapsed ? ' is-collapsed' : ''}`}>
        <Sidebar
          section={section}
          onSelect={setSection}
          activeTab={active}
          tabCount={tabs.length}
          fontScale={fontScale}
          sidebarWidth={sidebarWidth}
          onWidthChange={setSidebarWidth}
          onWidthCommit={commitSidebarWidth}
          collapsed={sidebarCollapsed}
          position={sidebarPosition}
          onDockChange={commitSidebarPosition}
          onToggleCollapse={commitSidebarToggle}
          onDragSnapshot={setDragSnapshot}
          hasUpdate={hasUpdate}
          onOpenSummary={() => {
            setSection('summary');
            window.setTimeout(() => window.dispatchEvent(new Event('bsub:summary-request')), 80);
          }}
        />
        <BrowserStage
          hasTab={Boolean(active)}
          sidebarPosition={sidebarPosition}
          sidebarCollapsed={sidebarCollapsed}
          sidebarWidth={sidebarWidth}
          snapshot={dragSnapshot}
        />
      </div>
    </div>
  );
}
