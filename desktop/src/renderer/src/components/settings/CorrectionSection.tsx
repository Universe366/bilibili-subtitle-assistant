import { Download, Loader2, Plus, Search, Trash2, Upload } from 'lucide-react';
import type { AppSettings, CorrectionRuleGroup } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type CorrectionSettings = AppSettings['correction'];

interface CorrectionSectionProps {
  value: CorrectionSettings;
  testText: string;
  preview: string;
  testing: boolean;
  onToggle: (enabled: boolean) => void;
  onAddGroup: () => void;
  onImportGroups: () => void;
  onUpdateGroup: (id: string, patch: Partial<CorrectionRuleGroup>) => void;
  onExportGroup: (group: CorrectionRuleGroup) => void;
  onRemoveGroup: (id: string) => void;
  onAddRule: (groupId: string) => void;
  onUpdateRule: (
    groupId: string,
    ruleId: string,
    patch: Partial<CorrectionRuleGroup['rules'][number]>
  ) => void;
  onRemoveRule: (groupId: string, ruleId: string) => void;
  onToggleGlossary: (enabled: boolean) => void;
  onAddTerm: () => void;
  onUpdateTerm: (id: string, patch: { from?: string; to?: string; note?: string }) => void;
  onRemoveTerm: (id: string) => void;
  onTestText: (value: string) => void;
  onPreview: () => void;
}

/** 字幕校对与术语表：规则组/规则表格、术语表、预览。 */
export function CorrectionSection({
  value,
  testText,
  preview,
  testing,
  onToggle,
  onAddGroup,
  onImportGroups,
  onUpdateGroup,
  onExportGroup,
  onRemoveGroup,
  onAddRule,
  onUpdateRule,
  onRemoveRule,
  onToggleGlossary,
  onAddTerm,
  onUpdateTerm,
  onRemoveTerm,
  onTestText,
  onPreview
}: CorrectionSectionProps) {
  return (
    <SettingsSection title="字幕校对与术语表" defaultOpen={false}>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        读取字幕 / 入库时应用规则
      </label>

      <div className="settings-inline">
        <span className="settings-label" style={{ flex: 1 }}>
          规则组
        </span>
        <button className="mini-btn" onClick={onAddGroup}>
          <Plus size={12} /> 规则组
        </button>
        <button className="mini-btn" onClick={onImportGroups}>
          <Upload size={12} /> 导入
        </button>
      </div>

      {value.groups.map((group) => (
        <div key={group.id} className="correction-group">
          <div className="settings-inline">
            <input
              className="settings-input"
              value={group.name}
              onChange={(event) => onUpdateGroup(group.id, { name: event.target.value })}
            />
            <label className="settings-check">
              <input
                type="checkbox"
                checked={group.enabled}
                onChange={(event) => onUpdateGroup(group.id, { enabled: event.target.checked })}
              />
              启用
            </label>
            <button className="mini-btn" title="导出规则组" onClick={() => onExportGroup(group)}>
              <Download size={12} />
            </button>
            <button className="mini-btn" title="删除规则组" onClick={() => onRemoveGroup(group.id)}>
              <Trash2 size={12} />
            </button>
          </div>

          {group.rules.map((rule) => (
            <div key={rule.id} className="correction-rule">
              <input
                className="settings-input"
                placeholder="匹配内容"
                value={rule.pattern}
                spellCheck={false}
                onChange={(event) =>
                  onUpdateRule(group.id, rule.id, { pattern: event.target.value })
                }
              />
              <input
                className="settings-input"
                placeholder="替换为"
                value={rule.replacement}
                spellCheck={false}
                onChange={(event) =>
                  onUpdateRule(group.id, rule.id, { replacement: event.target.value })
                }
              />
              <div className="settings-inline">
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={rule.regex}
                    onChange={(event) =>
                      onUpdateRule(group.id, rule.id, { regex: event.target.checked })
                    }
                  />
                  正则
                </label>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={rule.caseSensitive}
                    onChange={(event) =>
                      onUpdateRule(group.id, rule.id, { caseSensitive: event.target.checked })
                    }
                  />
                  区分大小写
                </label>
                <button
                  className="mini-btn"
                  title="删除规则"
                  onClick={() => onRemoveRule(group.id, rule.id)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}

          <button className="mini-btn" onClick={() => onAddRule(group.id)}>
            <Plus size={12} /> 规则
          </button>
        </div>
      ))}

      <div className="settings-label">术语表</div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.glossary.enabled}
          onChange={(event) => onToggleGlossary(event.target.checked)}
        />
        启用术语替换，并注入总结提示词
      </label>

      {value.glossary.terms.map((term) => (
        <div key={term.id} className="correction-term">
          <div className="settings-inline">
            <input
              className="settings-input"
              placeholder="原词"
              value={term.from}
              spellCheck={false}
              onChange={(event) => onUpdateTerm(term.id, { from: event.target.value })}
            />
            <span className="settings-arrow">→</span>
            <input
              className="settings-input"
              placeholder="统一写法"
              value={term.to}
              spellCheck={false}
              onChange={(event) => onUpdateTerm(term.id, { to: event.target.value })}
            />
            <button className="mini-btn" title="删除术语" onClick={() => onRemoveTerm(term.id)}>
              <Trash2 size={12} />
            </button>
          </div>
          <input
            className="settings-input"
            placeholder="备注（可选）"
            value={term.note}
            onChange={(event) => onUpdateTerm(term.id, { note: event.target.value })}
          />
        </div>
      ))}

      <button className="mini-btn" onClick={onAddTerm}>
        <Plus size={12} /> 术语
      </button>

      <div className="settings-label">预览</div>
      <input
        className="settings-input"
        value={testText}
        spellCheck={false}
        onChange={(event) => onTestText(event.target.value)}
      />
      <button className="mini-btn" disabled={testing} onClick={onPreview}>
        {testing ? <Loader2 size={12} className="spin" /> : <Search size={12} />} 预览结果
      </button>
      {preview && <pre className="correction-preview">{preview}</pre>}
      <div className="settings-hint">规则按组顺序执行，术语替换在规则之后；非法正则自动跳过。</div>
    </SettingsSection>
  );
}
