import type { AppSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type General = AppSettings['general'];

interface Props {
  value: General;
  onChange: (patch: Partial<General>) => void;
}

/** 页面与阅读：选区工具条、字幕跟随、字幕缓存。 */
export function ReadingGroup({ value, onChange }: Props) {
  return (
    <SettingsSection title="页面与阅读" defaultOpen>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.selectionToolbar !== false}
          onChange={(event) => onChange({ selectionToolbar: event.target.checked })}
        />
        选中网页文字时显示「解释 / 翻译 / 总结」工具条
      </label>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.autoFollow !== false}
          onChange={(event) => onChange({ autoFollow: event.target.checked })}
        />
        字幕默认跟随播放高亮
      </label>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.cacheSubtitles !== false}
          onChange={(event) => onChange({ cacheSubtitles: event.target.checked })}
        />
        缓存字幕正文（最多 100 条）
      </label>
      {value.cacheSubtitles !== false && (
        <div className="settings-field">
          <div className="settings-label">字幕缓存天数（0 = 不缓存）</div>
          <input
            className="settings-input"
            type="number"
            min={0}
            max={365}
            value={value.subtitleCacheDays ?? 30}
            onChange={(event) => onChange({ subtitleCacheDays: Number(event.target.value) || 0 })}
          />
        </div>
      )}
    </SettingsSection>
  );
}
