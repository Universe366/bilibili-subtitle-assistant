import { Globe, Loader2, Moon, Plus, X } from 'lucide-react';
import type { TabInfo } from '../../../shared/types';

export function TabStrip({ tabs }: { tabs: TabInfo[] }) {
  return (
    <div className="tab-strip">
      <div className="tab-strip-list">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab${tab.active ? ' is-active' : ''}${tab.suspended ? ' is-suspended' : ''}`}
            title={`${tab.title}${tab.suspended ? '（已休眠，点击恢复）' : ''}`}
            onClick={() => void window.bsub.activateTab(tab.id)}
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
      <button className="tab-new" title="新建标签页" onClick={() => void window.bsub.newTab()}>
        <Plus size={15} />
      </button>
    </div>
  );
}
