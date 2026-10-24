import { SettingsSection } from './SettingsSection';

export interface SitePermission {
  origin: string;
  permission: string;
  decision: 'allow' | 'deny';
}

const PERMISSION_LABELS: Record<string, string> = {
  media: '摄像头 / 麦克风',
  geolocation: '定位',
  notifications: '通知',
  midi: 'MIDI',
  clipboard: '剪贴板',
  'clipboard-read': '读取剪贴板',
  'clipboard-sanitized-write': '写入剪贴板',
  fullscreen: '全屏',
  pointerLock: '鼠标锁定',
  openExternal: '打开外部应用'
};

interface SitePermissionsSectionProps {
  items: SitePermission[];
  onRevoke: (origin: string, permission: string) => void;
  onRefresh: () => void;
  onClear: () => void;
}

/** 站点权限：列出记住的允许/拒绝决定，支持逐条撤销与全部清除。 */
export function SitePermissionsSection({
  items,
  onRevoke,
  onRefresh,
  onClear
}: SitePermissionsSectionProps) {
  return (
    <SettingsSection title="站点权限" defaultOpen={false}>
      <div className="settings-hint">
        网站首次申请摄像头、麦克风、通知等权限时会弹窗；这里可以查看并撤销已记住的选择。
      </div>
      {items.length === 0 && <div className="settings-hint">还没有记住任何站点权限。</div>}
      {items.map((item) => (
        <div className="settings-row" key={`${item.origin}:${item.permission}`}>
          <span>
            {item.origin} · {PERMISSION_LABELS[item.permission] || item.permission}
          </span>
          <span className="settings-hint">{item.decision === 'allow' ? '允许' : '拒绝'}</span>
          <button className="mini-btn" onClick={() => onRevoke(item.origin, item.permission)}>
            撤销
          </button>
        </div>
      ))}
      <div className="settings-inline">
        <button className="mini-btn" onClick={onRefresh}>
          刷新
        </button>
        <button className="mini-btn danger" disabled={!items.length} onClick={onClear}>
          清除全部
        </button>
      </div>
    </SettingsSection>
  );
}
