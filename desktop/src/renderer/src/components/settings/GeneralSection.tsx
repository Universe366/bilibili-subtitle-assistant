import type { AppSettings, ThemeMode } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type GeneralSettings = AppSettings['general'];

interface GeneralSectionProps {
  value: GeneralSettings;
  onChange: (patch: Partial<GeneralSettings>) => void;
}

/** 通用：主题、托盘、会话恢复、选区工具条、字幕缓存、字号、侧栏、标签休眠。 */
export function GeneralSection({ value, onChange }: GeneralSectionProps) {
  return (
    <SettingsSection title="通用" defaultOpen={true}>
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

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.closeToTray !== false}
          onChange={(event) => onChange({ closeToTray: event.target.checked })}
        />
        关闭窗口时缩到托盘
      </label>

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
          checked={value.selectionToolbar !== false}
          onChange={(event) => onChange({ selectionToolbar: event.target.checked })}
        />
        选中网页文字时显示「解释 / 翻译 / 总结」工具条
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

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.autoFollow !== false}
          onChange={(event) => onChange({ autoFollow: event.target.checked })}
        />
        字幕默认跟随播放高亮
      </label>

      <div className="settings-label">地址栏搜索</div>
      <select
        className="settings-input"
        value={value.searchEngine || 'bilibili'}
        onChange={(event) =>
          onChange({ searchEngine: event.target.value as 'bilibili' | 'bing' | 'google' | 'custom' })
        }
      >
        <option value="bilibili">B 站站内搜索</option>
        <option value="bing">必应</option>
        <option value="google">Google</option>
        <option value="custom">自定义</option>
      </select>
      {value.searchEngine === 'custom' && (
        <input
          className="settings-input"
          value={value.searchEngineCustom || ''}
          placeholder="https://example.com/search?q={q}"
          spellCheck={false}
          onChange={(event) => onChange({ searchEngineCustom: event.target.value })}
        />
      )}
      <div className="settings-hint">
        在地址栏输入非网址内容时用它搜索；自定义模板必须包含 <code>{'{q}'}</code>。
      </div>

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
