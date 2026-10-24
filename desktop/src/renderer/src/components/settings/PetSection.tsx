import type { AppSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type General = AppSettings['general'];

interface PetSectionProps {
  value: General;
  onChange: (patch: Partial<General>) => void;
}

/** 桌面宠物：大小、透明度、音效、自言自语、置顶与位置。 */
export function PetSection({ value, onChange }: PetSectionProps) {
  return (
    <SettingsSection title="桌面宠物" defaultOpen>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.petEnabled === true}
          onChange={(event) => onChange({ petEnabled: event.target.checked })}
        />
        启用桌面宠物
      </label>

      <div className="settings-label">大小（{value.petSize || 96}px）</div>
      <input
        className="settings-range"
        type="range"
        min={64}
        max={180}
        step={4}
        value={value.petSize || 96}
        onChange={(event) => onChange({ petSize: Number(event.target.value) || 96 })}
      />
      <div className="toolbar-actions">
        {[
          { label: '小', size: 72, hint: '不挡视线' },
          { label: '中', size: 96, hint: '默认' },
          { label: '大', size: 140, hint: '看得清表情' }
        ].map((preset) => (
          <button
            key={preset.label}
            className={`mini-btn${(value.petSize || 96) === preset.size ? ' is-active' : ''}`}
            title={preset.hint}
            onClick={() => onChange({ petSize: preset.size })}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="settings-label">不透明度（{Math.round((value.petOpacity ?? 1) * 100)}%）</div>
      <input
        className="settings-range"
        type="range"
        min={0.4}
        max={1}
        step={0.05}
        value={value.petOpacity ?? 1}
        onChange={(event) => onChange({ petOpacity: Number(event.target.value) || 1 })}
      />

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.petSound !== false}
          onChange={(event) => onChange({ petSound: event.target.checked })}
        />
        点击音效
      </label>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.petIdleTalk !== false}
          onChange={(event) => onChange({ petIdleTalk: event.target.checked })}
        />
        空闲时自言自语
      </label>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.petAlwaysOnTop !== false}
          onChange={(event) => onChange({ petAlwaysOnTop: event.target.checked })}
        />
        窗口置顶
      </label>

      <div className="toolbar-actions">
        <button
          className="mini-btn"
          onClick={() => {
            onChange({ petEnabled: true });
            void window.bsub.setPetEnabled(true);
          }}
        >
          立即显示
        </button>
        <button className="mini-btn" onClick={() => void window.bsub.resetPetPosition()}>
          重置桌宠位置
        </button>
      </div>
      <div className="settings-hint">
        拖动桌宠可移动位置（松手会吸附屏幕边缘）；右键桌宠可打开主窗口、总结当前页面、
        暂停/继续播放、切换置顶、重置位置或隐藏。关闭气泡后窗口会自动缩到桌宠大小，不会挡住桌面点击。
        修改后点「保存」生效。
      </div>
    </SettingsSection>
  );
}
