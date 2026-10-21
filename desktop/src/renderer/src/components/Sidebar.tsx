import type { ComponentType } from 'react';
import { Captions, Library, Settings, Sparkles } from 'lucide-react';
import type { Section, TabInfo } from '../../../shared/types';
import { SubtitlesPanel } from './SubtitlesPanel';
import { LibraryPanel } from './LibraryPanel';
import { SummaryPanel } from './SummaryPanel';
import { SettingsPanel } from './SettingsPanel';

type IconComponent = ComponentType<{ size?: number | string; className?: string }>;

const items: Array<{ id: Section; label: string; icon: IconComponent; hint: string }> = [
  { id: 'subtitles', label: '字幕', icon: Captions, hint: '当前视频的字幕与翻译' },
  { id: 'summary', label: '总结', icon: Sparkles, hint: 'AI 总结、章节与问答' },
  { id: 'library', label: '库', icon: Library, hint: '已入库的视频与笔记' },
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
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">字</div>
        <div className="brand-text">
          <div className="brand-name">字幕助手</div>
          <div className="brand-sub">Desktop · M5</div>
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

        {section === 'summary' && (
          <SummaryPanel activeTab={activeTab} onOpenSettings={() => onSelect('settings')} />
        )}

        {section === 'library' && <LibraryPanel />}

        {section === 'settings' && <SettingsPanel />}
      </div>

      <div className="side-footer">
        <span className={`dot${tabCount > 0 ? ' is-on' : ''}`} />
        <span>插件未连接</span>
        <span className="side-version">0.1.0</span>
      </div>
    </aside>
  );
}
