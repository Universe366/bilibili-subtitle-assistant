import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import {
  Captions,
  History as HistoryIcon,
  Library,
  ListChecks,
  MessageSquare,
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
  tabCount
}: {
  section: Section;
  onSelect: (section: Section) => void;
  activeTab: TabInfo | null;
  tabCount: number;
}) {
  const [version, setVersion] = useState('');
  useEffect(() => {
    void window.bsub.getSettings().then((response) => {
      if (response.ok) setVersion(response.data.version);
    });
  }, []);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">字</div>
        <div className="brand-text">
          <div className="brand-name">字幕助手</div>
          <div className="brand-sub">Desktop</div>
        </div>
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

      <div className="side-content">
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

      <div className="side-footer">
        <span className={`dot${tabCount > 0 ? ' is-on' : ''}`} />
        <span>插件未连接</span>
        <span className="side-version">{version ? `v${version}` : ''}</span>
      </div>
    </aside>
  );
}
