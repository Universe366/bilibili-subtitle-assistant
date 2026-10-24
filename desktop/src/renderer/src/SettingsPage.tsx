import { useState } from 'react';
import { SettingsPanel } from './components/SettingsPanel';

const GROUPS: Array<{ id: string; label: string }> = [
  { id: 'appearance', label: '外观' },
  { id: 'sessions', label: '标签页与会话' },
  { id: 'address', label: '地址栏与搜索' },
  { id: 'reading', label: '页面与阅读' },
  { id: 'efficiency', label: '效率工具' },
  { id: 'ai', label: 'AI 与语音' },
  { id: 'search', label: '检索与核对' },
  { id: 'plugins', label: '插件与集成' },
  { id: 'data', label: '数据与检查' },
  { id: 'all', label: '全部设置' }
];

/** 设置页：左侧分类导航 + 右侧分组内容。 */
export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [group, setGroup] = useState('appearance');

  return (
    <div className="settings-page">
      <div className="settings-page-head">
        <span>设置</span>
        <button className="mini-btn" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="settings-page-body">
        <nav className="settings-nav">
          {GROUPS.map((item) => (
            <button
              key={item.id}
              className={`settings-nav-item${group === item.id ? ' is-active' : ''}`}
              onClick={() => setGroup(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="settings-page-content">
          <SettingsPanel group={group} />
        </div>
      </div>
    </div>
  );
}
