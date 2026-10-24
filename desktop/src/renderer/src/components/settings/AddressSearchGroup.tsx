import type { AppSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type General = AppSettings['general'];

interface Props {
  value: General;
  onChange: (patch: Partial<General>) => void;
}

/** 地址栏与搜索：默认搜索引擎、自定义模板。 */
export function AddressSearchGroup({ value, onChange }: Props) {
  return (
    <SettingsSection title="地址栏与搜索" defaultOpen>
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
    </SettingsSection>
  );
}
