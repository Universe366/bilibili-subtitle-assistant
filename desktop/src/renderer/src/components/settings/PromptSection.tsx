import { Plus, Trash2 } from 'lucide-react';
import type { AppSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type PromptSettings = AppSettings['prompt'];

interface PromptSectionProps {
  value: PromptSettings;
  onPatch: (patch: Partial<PromptSettings>) => void;
  onAddTemplate: () => void;
  onRemoveTemplate: () => void;
  onUpdateTemplate: (patch: { name?: string; text?: string }) => void;
}

/** 提示词模板：模板选择/新增/删除、模板正文，以及对话/翻译/优化/章节提示词。 */
export function PromptSection({
  value,
  onPatch,
  onAddTemplate,
  onRemoveTemplate,
  onUpdateTemplate
}: PromptSectionProps) {
  const activeTemplate = value.templates.find((item) => item.id === value.activeId) || value.templates[0];

  return (
    <SettingsSection title="提示词模板" defaultOpen={false}>
      <div className="settings-inline">
        <select
          className="settings-input"
          value={value.activeId}
          onChange={(event) => onPatch({ activeId: event.target.value })}
        >
          {value.templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
        <button className="mini-btn" title="新增模板" onClick={onAddTemplate}>
          <Plus size={12} />
        </button>
        <button
          className="mini-btn"
          title="删除当前模板"
          disabled={value.templates.length <= 1}
          onClick={onRemoveTemplate}
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="settings-label">模板名称</div>
      <input
        className="settings-input"
        value={activeTemplate?.name || ''}
        onChange={(event) => onUpdateTemplate({ name: event.target.value })}
      />

      <textarea
        className="settings-textarea"
        rows={9}
        value={activeTemplate?.text || ''}
        onChange={(event) => onUpdateTemplate({ text: event.target.value })}
      />

      <div className="settings-label">对话提示词</div>
      <textarea
        className="settings-textarea"
        rows={5}
        value={value.chat}
        onChange={(event) => onPatch({ chat: event.target.value })}
      />

      <div className="settings-label">翻译提示词</div>
      <textarea
        className="settings-textarea"
        rows={6}
        value={value.translate}
        onChange={(event) => onPatch({ translate: event.target.value })}
      />

      <div className="settings-label">AI 优化提示词</div>
      <textarea
        className="settings-textarea"
        rows={6}
        value={value.optimize}
        onChange={(event) => onPatch({ optimize: event.target.value })}
      />

      <div className="settings-label">章节提示词</div>
      <textarea
        className="settings-textarea"
        rows={5}
        value={value.chapters}
        onChange={(event) => onPatch({ chapters: event.target.value })}
      />
    </SettingsSection>
  );
}
