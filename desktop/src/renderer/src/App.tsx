import { useEffect, useMemo, useState } from 'react';
import type { Section, TabInfo } from '../../shared/types';
import { TabStrip } from './components/TabStrip';
import { AddressBar } from './components/AddressBar';
import { Sidebar } from './components/Sidebar';
import { BrowserStage } from './components/BrowserStage';

export default function App() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [section, setSection] = useState<Section>(() => {
    const value = new URLSearchParams(window.location.search).get('section');
    return value === 'summary' || value === 'library' || value === 'settings' || value === 'subtitles'
      ? value
      : 'subtitles';
  });

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

  return (
    <div className="app-shell">
      <TabStrip tabs={tabs} />
      <AddressBar tab={active} />
      <div className="app-body">
        <Sidebar section={section} onSelect={setSection} activeTab={active} tabCount={tabs.length} />
        <BrowserStage hasTab={Boolean(active)} />
      </div>
    </div>
  );
}
