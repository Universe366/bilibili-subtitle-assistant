import type { AppSettings, ThemeMode } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type General = AppSettings['general'];

interface Props {
  value: General;
  onChange: (patch: Partial<General>) => void;
}

/** 外观：主题、字号、侧栏与标签栏布局。 */
export function AppearanceGroup({ value, onChange }: Props) {
  return (
    <SettingsSection title="外观" defaultOpen>
      <div className="settings-label">主题</div>
      <select
        className="settings-input"
        value={value.theme}
        onChange={(event) => onChange({ theme: event.target.value as ThemeMode })}
      >
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select>

      <div className="settings-label">界面字号（{Math.round((value.fontScale || 1) * 100)}%）</div>
      <input
        className="settings-range"
        type="range"
        min={0.8}
        max={1.6}
        step={0.05}
        value={value.fontScale || 1}
        onChange={(event) => onChange({ fontScale: Number(event.target.value) })}
      />

      <div className="settings-label">侧栏宽度（px，也可直接拖动侧栏边缘）</div>
      <input
        className="settings-input"
        type="number"
        min={260}
        max={560}
        step={10}
        value={value.sidebarWidth || 320}
        onChange={(event) =>
          onChange({
            sidebarWidth: Math.min(560, Math.max(260, Number(event.target.value) || 320))
          })
        }
      />

      <div className="settings-label">侧栏位置</div>
      <select
        className="settings-input"
        value={value.sidebarPosition || 'left'}
        onChange={(event) => onChange({ sidebarPosition: event.target.value as 'left' | 'right' })}
      >
        <option value="left">左侧</option>
        <option value="right">右侧</option>
      </select>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.sidebarCollapsed === true}
          onChange={(event) => onChange({ sidebarCollapsed: event.target.checked })}
        />
        折叠侧栏（只保留图标）
      </label>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.verticalTabs === true}
          onChange={(event) => onChange({ verticalTabs: event.target.checked })}
        />
        垂直标签栏（标签放在左侧）
      </label>
    </SettingsSection>
  );
}
