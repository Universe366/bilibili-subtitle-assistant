import { Plus, Trash2 } from 'lucide-react';
import type { AppSettings, SkillItem } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type SkillSettings = AppSettings['skills'];

interface SkillsSectionProps {
  value: SkillSettings;
  onToggle: (enabled: boolean) => void;
  onImport: () => void;
  onCreate: () => void;
  onUpdate: (id: string, patch: Partial<SkillItem>) => void;
  onRemove: (id: string) => void;
}

/** Skills：技能提示词开关、导入 SKILL.md、新建/编辑/删除技能。 */
export function SkillsSection({
  value,
  onToggle,
  onImport,
  onCreate,
  onUpdate,
  onRemove
}: SkillsSectionProps) {
  return (
    <SettingsSection title="Skills" defaultOpen={false}>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        启用技能提示词
      </label>
      <div className="settings-inline">
        <button className="mini-btn" onClick={onImport}>
          <Plus size={12} /> 导入 SKILL.md
        </button>
        <button className="mini-btn" onClick={onCreate}>
          <Plus size={12} /> 新建技能
        </button>
      </div>

      {value.items.map((skill) => (
        <div key={skill.id} className="skill-card">
          <div className="settings-inline">
            <input
              className="settings-input"
              value={skill.name}
              onChange={(event) => onUpdate(skill.id, { name: event.target.value })}
            />
            <label className="settings-check">
              <input
                type="checkbox"
                checked={skill.enabled}
                onChange={(event) => onUpdate(skill.id, { enabled: event.target.checked })}
              />
              启用
            </label>
            <button className="mini-btn" onClick={() => onRemove(skill.id)}>
              <Trash2 size={12} />
            </button>
          </div>
          <input
            className="settings-input"
            placeholder="触发条件 / 描述"
            value={skill.description}
            onChange={(event) => onUpdate(skill.id, { description: event.target.value })}
          />
          <textarea
            className="settings-textarea"
            rows={4}
            value={skill.body}
            onChange={(event) => onUpdate(skill.id, { body: event.target.value })}
          />
          <div className="settings-hint">来源：{skill.source}</div>
        </div>
      ))}
      <div className="settings-hint">启用后会注入总结和对话的系统提示词。</div>
    </SettingsSection>
  );
}
