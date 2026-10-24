import type { AppSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type General = AppSettings['general'];

interface Props {
  value: General;
  onChange: (patch: Partial<General>) => void;
}

/** 标签页与会话：恢复会话、后台休眠、关闭行为。 */
export function SessionsGroup({ value, onChange }: Props) {
  return (
    <SettingsSection title="标签页与会话" defaultOpen>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.restoreSession !== false}
          onChange={(event) => onChange({ restoreSession: event.target.checked })}
        />
        启动时恢复上次打开的标签页
      </label>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.closeToTray !== false}
          onChange={(event) => onChange({ closeToTray: event.target.checked })}
        />
        关闭窗口时缩到托盘
      </label>

      <div className="settings-label">后台标签休眠（分钟）</div>
      <input
        className="settings-input"
        type="number"
        min={1}
        max={120}
        value={value.suspendMinutes}
        onChange={(event) => onChange({ suspendMinutes: Number(event.target.value) || 5 })}
      />
      <div className="settings-hint">1–120 分钟；正在出声的标签不会被回收。</div>
    </SettingsSection>
  );
}
