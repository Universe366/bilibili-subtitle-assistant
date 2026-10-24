import { useEffect, useMemo, useState } from 'react';
import type { FindResult, Section, SettingsSnapshot, TabInfo } from '../../shared/types';
import { TabStrip } from './components/TabStrip';
import { AddressBar } from './components/AddressBar';
import { FindBar } from './components/FindBar';
import { Sidebar } from './components/Sidebar';
import { BrowserStage } from './components/BrowserStage';
import { FirstRunWizard } from './components/FirstRunWizard';
import { GlobalSearch } from './components/GlobalSearch';
import { BrowserHub, type HubSection } from './components/BrowserHub';
import { ReaderMode } from './components/ReaderMode';
import { StartPage } from './components/StartPage';
import { SettingsPanel } from './components/SettingsPanel';
import { nextTabId, tabIdByNumber } from './lib/tabs';
import { useDropImport } from './lib/dropImport';
import { CommandPalette, type CommandItem } from './components/CommandPalette';

export default function App() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [section, setSection] = useState<Section>(() => {
    const value = new URLSearchParams(window.location.search).get('section');
    return value === 'chat' ||
      value === 'summary' ||
      value === 'library' ||
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
  const [verticalTabs, setVerticalTabs] = useState(false);
  const [dragSnapshot, setDragSnapshot] = useState<string | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [wizard, setWizard] = useState<SettingsSnapshot | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [hub, setHub] = useState<HubSection | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);

  // 内置浏览器是原生 WebContentsView，永远盖在 renderer 上面。
  // 向导/全局搜索是 renderer 里的全屏遮罩，不隐藏页面就会出现
  // 「卡片被页面挡住、只剩左侧点不了」的情况。
  useEffect(() => {
    void window.bsub.setBrowserVisible(!wizard && !searchOpen && !hub && !readerOpen);
  }, [wizard, searchOpen, hub, readerOpen]);

  const applyLayout = (snapshot: {
    settings: {
      general: {
        sidebarWidth: number;
        sidebarPosition: 'left' | 'right';
        sidebarCollapsed: boolean;
        verticalTabs?: boolean;
      };
    };
  }) => {
    setSidebarWidth(snapshot.settings.general.sidebarWidth);
    setSidebarPosition(snapshot.settings.general.sidebarPosition);
    setSidebarCollapsed(snapshot.settings.general.sidebarCollapsed);
    setVerticalTabs(snapshot.settings.general.verticalTabs === true);
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

  const toggleBookmark = async () => {
    if (!active || !/^https?:/i.test(active.url)) return;
    const response = await window.bsub.toggleBookmark({
      url: active.url,
      title: active.title,
      favicon: active.favicon
    });
    if (response.ok) setBookmarked(response.data.bookmarked);
  };

  useEffect(() => {
    let alive = true;
    if (!active || !/^https?:/i.test(active.url)) {
      setBookmarked(false);
      return;
    }
    void window.bsub.isBookmarked(active.url).then((response) => {
      if (alive && response.ok) setBookmarked(response.data.bookmarked);
    });
    return () => {
      alive = false;
    };
  }, [active?.url]);

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

  // 焦点在网页（原生 WebContentsView）里时，renderer 收不到 Ctrl+K，
  // 由主进程 before-input-event 转发过来。
  useEffect(() => window.bsub.onSearchRequest(() => setSearchOpen(true)), []);

  useEffect(
    () =>
      window.bsub.onAskSelectionRequest(() => {
        setSection('chat');
        window.setTimeout(() => window.dispatchEvent(new Event('bsub:ask-selection')), 150);
      }),
    []
  );

  useEffect(() => window.bsub.onTabSearchRequest(() => setHub('tabs')), []);
  useEffect(() => window.bsub.onReaderRequest(() => setReaderOpen(true)), []);

  useEffect(
    () =>
      window.bsub.onSelectionAction((payload) => {
        setSection('chat');
        window.setTimeout(
          () =>
            window.dispatchEvent(
              new CustomEvent('bsub:selection-action', { detail: payload })
            ),
          150
        );
      }),
    []
  );

  useEffect(
    () =>
      window.bsub.onBookmarkRequest(() => {
        void toggleBookmark();
      }),
    [active?.url]
  );

  useEffect(() => {
    void window.bsub.getSettings().then((response) => {
      if (response.ok) {
        setFontScale(response.data.settings.general.fontScale || 1);
        applyLayout(response.data);
        if (!response.data.settings.general.wizardDone) setWizard(response.data);
      }
    });
    return window.bsub.onSettingsChanged((snapshot) => {
      setFontScale(snapshot.settings.general.fontScale || 1);
      applyLayout(snapshot);
      if (snapshot.settings.general.wizardDone) setWizard(null);
      else setWizard(snapshot);
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

      if (event.altKey && !mod && key === 'r') {
        event.preventDefault();
        setReaderOpen(true);
        return;
      }
      if (event.key === 'Escape' && readerOpen) {
        setReaderOpen(false);
        return;
      }

      if (mod && event.shiftKey && key === 't') {
        event.preventDefault();
        void window.bsub.reopenClosedTab();
        return;
      }
      if (mod && event.shiftKey && key === 'a') {
        event.preventDefault();
        setHub('tabs');
        return;
      }
      if (mod && !event.shiftKey && key === 'd') {
        event.preventDefault();
        void toggleBookmark();
        return;
      }
      if (mod && key === 't') {
        event.preventDefault();
        void window.bsub.newTab();
        return;
      }
      if (mod && event.shiftKey && key === 'p') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }
      if (mod && event.key === 'Tab') {
        event.preventDefault();
        const target = nextTabId(tabs, active?.id, event.shiftKey ? -1 : 1);
        if (target) void window.bsub.activateTab(target);
        return;
      }
      if (mod && !event.shiftKey && /^[1-9]$/.test(event.key)) {
        event.preventDefault();
        const target = tabIdByNumber(tabs, Number(event.key));
        if (target) void window.bsub.activateTab(target);
        return;
      }
      if (mod && key === 'k') {
        event.preventDefault();
        setSearchOpen(true);
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
      if (event.key === 'Escape' && hub) {
        setHub(null);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, findOpen, findQuery, hub, readerOpen, tabs]);

  useEffect(() => {
    void window.bsub.setActiveViewVisible(!(startOpen || settingsOpen));
  }, [startOpen, settingsOpen]);

  const handleSectionSelect = (next: Section) => {
    setSection(next);
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      void persistGeneral({ sidebarCollapsed: false });
    }
  };

  const persistGeneral = async (patch: Record<string, unknown>) => {
    const response = await window.bsub.getSettings();
    if (!response.ok) return;
    const settings = {
      ...response.data.settings,
      general: { ...response.data.settings.general, ...patch }
    };
    await window.bsub.saveSettings(settings);
  };

  const drop = useDropImport((payload) => {
    if (payload.kind === 'files') {
      setSection('library');
      return;
    }
    void window.bsub.newTab(payload.value);
  });

  const finishWizard = (openSettings: boolean) => {
    setWizard(null);
    if (openSettings) setSection('settings');
    void window.bsub.finishWizard();
  };

  const commands: CommandItem[] = [
    { id: 'section-subtitles', label: '打开面板：字幕', hint: 'Ctrl+Shift+1', run: () => setSection('subtitles') },
    { id: 'section-summary', label: '打开面板：总结', run: () => setSection('summary') },
    { id: 'section-chat', label: '打开面板：对话', run: () => setSection('chat') },
    { id: 'section-library', label: '打开面板：库', run: () => setSection('library') },
    { id: 'section-settings', label: '打开面板：设置', run: () => setSection('settings') },
    { id: 'start-page', label: '打开起始页', hint: 'Ctrl+T', run: () => setStartOpen(true) },
    { id: 'settings-page', label: '打开设置页', hint: 'Ctrl+,', run: () => setSettingsOpen(true) },
    { id: 'hub-tabs', label: '打开面板：标签页', hint: 'Ctrl+Shift+A', run: () => setHub('tabs') },
    { id: 'hub-history', label: '打开面板：历史 / 书签 / 下载', run: () => setHub('history') },
    { id: 'reader', label: '打开阅读模式', hint: 'Alt+R', run: () => setReaderOpen(true) },
    { id: 'search', label: '全局搜索', hint: 'Ctrl+K', run: () => setSearchOpen(true) },
    { id: 'new-tab', label: '新建标签页', hint: 'Ctrl+T', run: () => void window.bsub.newTab() },
    {
      id: 'reopen-tab',
      label: '重新打开关闭的标签页',
      hint: 'Ctrl+Shift+T',
      run: () => void window.bsub.reopenClosedTab()
    },
    {
      id: 'toggle-sidebar',
      label: '折叠 / 展开侧栏',
      run: () => {
        setSidebarCollapsed((value) => !value);
        void persistGeneral({ sidebarCollapsed: !sidebarCollapsed });
      }
    },
    {
      id: 'swap-sidebar',
      label: '左右切换侧栏位置',
      run: () => {
        const next = sidebarPosition === 'left' ? 'right' : 'left';
        setSidebarPosition(next);
        void persistGeneral({ sidebarPosition: next });
      }
    }
  ];

  const wrappedCommands: CommandItem[] = commands.map((command) => ({
    ...command,
    run: () => {
      setPaletteOpen(false);
      command.run();
    }
  }));

  return (
    <div
      className={`app-shell${verticalTabs ? ' vertical-tabs' : ''}`}
      {...drop.handlers}
    >
      <TabStrip tabs={tabs} vertical={verticalTabs} onSearch={() => setSearchOpen(true)} onNewTab={() => setStartOpen(true)} />
      <div className="app-main">
      <AddressBar
        tab={active}
        focusSignal={addressFocus}
        bookmarked={bookmarked}
        onToggleBookmark={() => void toggleBookmark()}
        onOpenHub={(section) => setHub(section)}
        onOpenReader={() => setReaderOpen(true)}
      />
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
          onSelect={handleSectionSelect}
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
            window.setTimeout(() => window.dispatchEvent(new Event('bsub:summary-request')), 200);
          }}
          onOpenChapters={() => {
            setSection('summary');
            window.setTimeout(() => window.dispatchEvent(new Event('bsub:chapters-request')), 250);
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
      <BrowserHub
        open={Boolean(hub)}
        initial={hub || 'history'}
        tabs={tabs}
        onClose={() => setHub(null)}
        onOpenUrl={(url) => void window.bsub.openUrl(url)}
        onSelectTab={(id) => void window.bsub.activateTab(id)}
      />
      <ReaderMode
        open={readerOpen}
        onClose={() => setReaderOpen(false)}
        onAskAi={(text) => {
          setSection('chat');
          window.setTimeout(
            () => window.dispatchEvent(new CustomEvent('bsub:reader-summary', { detail: { text } })),
            180
          );
        }}
      />
      {wizard && <FirstRunWizard snapshot={wizard} onFinish={finishWizard} />}
      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenItem={(videoId, tab) => {
          setSearchOpen(false);
          setSection('library');
          window.setTimeout(
            () =>
              window.dispatchEvent(
                new CustomEvent('bsub:library-item', { detail: { videoId, tab } })
              ),
            220
          );
        }}
        onOpenLine={(url, start) => {
          setSearchOpen(false);
          void window.bsub.openUrl(url, start);
        }}
        onOpenCollection={(collectionId) => {
          setSearchOpen(false);
          setSection('library');
          window.setTimeout(
            () =>
              window.dispatchEvent(
                new CustomEvent('bsub:collection-summary', { detail: collectionId })
              ),
            220
          );
        }}
      />

      {drop.dragging && (
        <div className="drop-overlay">
          <div className="drop-card">松手打开链接或 BV 号</div>
        </div>
      )}

      {startOpen && (
        <StartPage
          onNavigate={(input) => void window.bsub.newTab(input)}
          onOpenLibrary={() => {
            setStartOpen(false);
            handleSectionSelect('library');
          }}
          onOpenHistory={() => {
            setStartOpen(false);
            setHub('history');
          }}
          onOpenTasks={() => {
            setStartOpen(false);
            setHub('tabs');
          }}
          onOpenSettings={() => {
            setStartOpen(false);
            setSettingsOpen(true);
          }}
          onClose={() => setStartOpen(false)}
        />
      )}

      {settingsOpen && (
        <div className="settings-page">
          <div className="settings-page-head">
            <span>设置</span>
            <button className="mini-btn" onClick={() => setSettingsOpen(false)}>
              关闭
            </button>
          </div>
          <SettingsPanel />
        </div>
      )}

      <CommandPalette
        open={paletteOpen}
        commands={wrappedCommands}
        onClose={() => setPaletteOpen(false)}
      />
      </div>
    </div>
  );
}
