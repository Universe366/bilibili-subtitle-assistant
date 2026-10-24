import type { AppSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type General = AppSettings['general'];

interface Props {
  value: General;
  onChange: (patch: Partial<General>) => void;
}

/** 效率工具：AI 悬浮球、桌面宠物。 */
export function EfficiencyGroup({ value, onChange }: Props) {
  return (
    <SettingsSection title="效率工具" defaultOpen>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.assistantEnabled === true}
          onChange={(event) => onChange({ assistantEnabled: event.target.checked })}
        />
        显示 AI 悬浮球（右下角）
      </label>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.petEnabled === true}
          onChange={(event) => onChange({ petEnabled: event.target.checked })}
        />
        启用桌面宠物（独立小窗口，可拖动）
      </label>
      <div className="settings-hint">桌宠和悬浮球都使用「AI 平台」里的当前平台。</div>
    </SettingsSection>
  );
}
