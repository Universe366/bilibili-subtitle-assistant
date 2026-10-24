import { useEffect, useRef, useState, type ReactNode } from 'react';

interface SettingsSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** 折叠设置分组：展开状态记在 localStorage，重开面板保持上次状态。 */
export function SettingsSection({ title, defaultOpen = false, children }: SettingsSectionProps) {
  const storageKey = `bsub.settings.section.${title}`;
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const stored = localStorage.getItem(storageKey);
    ref.current.open = stored === null ? defaultOpen : stored === '1';
  }, [defaultOpen, storageKey]);
  return (
    <details
      ref={ref}
      className="settings-section"
      onToggle={(event) => {
        try {
          localStorage.setItem(storageKey, event.currentTarget.open ? '1' : '0');
        } catch {
          // ignore
        }
      }}
    >
      <summary className="settings-section-title">{title}</summary>
      <div className="settings-section-body">{children}</div>
    </details>
  );
}

interface ModelChipsProps {
  models: string[];
  current: string;
  probed: boolean;
  onPick: (model: string) => void;
}

/** 模型快捷选择：模型多时提供筛选框。 */
export function ModelChips({ models, current, probed, onPick }: ModelChipsProps) {
  const [filter, setFilter] = useState('');
  if (!models.length) return null;
  const keyword = filter.trim().toLowerCase();
  const shown = keyword ? models.filter((model) => model.toLowerCase().includes(keyword)) : models;

  return (
    <div className="model-picker">
      <div className="settings-hint">
        {probed ? `平台返回 ${models.length} 个模型` : `内置预设 ${models.length} 个（未核实）`}
        {keyword ? ` · 匹配 ${shown.length} 个` : ''}
      </div>
      {models.length > 16 && (
        <input
          className="settings-input"
          placeholder="筛选模型，例如 qwen / claude"
          value={filter}
          spellCheck={false}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}
      <div className="model-chips">
        {shown.map((model) => (
          <button
            key={model}
            className={`mini-btn${current === model ? ' is-active' : ''}`}
            title={model}
            onClick={() => onPick(model)}
          >
            {model}
          </button>
        ))}
        {!shown.length && <span className="settings-hint">没有匹配的模型</span>}
      </div>
    </div>
  );
}
