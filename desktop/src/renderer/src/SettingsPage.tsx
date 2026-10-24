import { useState } from 'react';
import { SettingsPanel } from './components/SettingsPanel';
import { SETTINGS_GROUPS } from './components/settings/registry';

/** 设置页：左侧分类导航 + 右侧分组内容。 */
export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [group, setGroup] = useState(SETTINGS_GROUPS[0].id);
  const active = SETTINGS_GROUPS.find((item) => item.id === group) || SETTINGS_GROUPS[0];
  const Icon = active.icon;

  return (
    <div className="settings-page">
      <header className="settings-page-head">
        <div className="settings-page-title">
          <Icon size={16} />
          <div>
            <div className="settings-page-name">{active.label}</div>
            <div className="settings-page-desc">{active.description}</div>
          </div>
        </div>
        <button className="mini-btn" onClick={onClose}>
          关闭
        </button>
      </header>

      <div className="settings-page-body">
        <nav className="settings-nav">
          {SETTINGS_GROUPS.map((item) => {
            const ItemIcon = item.icon;
            return (
              <button
                key={item.id}
                className={`settings-nav-item${group === item.id ? ' is-active' : ''}`}
                title={item.description}
                onClick={() => setGroup(item.id)}
              >
                <ItemIcon size={14} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="settings-page-content">
          <SettingsPanel group={group} />
        </div>
      </div>
    </div>
  );
}
