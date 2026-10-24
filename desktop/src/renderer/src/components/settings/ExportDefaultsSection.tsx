import type { AppSettings, ExportFormat } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

export const EXPORT_LABELS: Record<ExportFormat, string> = {
  md: 'Markdown',
  srt: 'SRT 字幕',
  vtt: 'WebVTT',
  ass: 'ASS 字幕',
  txt: '纯文本',
  json: 'JSON'
};

type ExportSettings = AppSettings['export'];

interface ExportDefaultsSectionProps {
  value: ExportSettings;
  onChange: (next: ExportSettings) => void;
}

/** 导出默认值：格式、时间戳、Markdown 模板、ASS 字号、文件名模板。 */
export function ExportDefaultsSection({ value, onChange }: ExportDefaultsSectionProps) {
  const patch = (partial: Partial<ExportSettings>) => onChange({ ...value, ...partial });

  return (
    <SettingsSection title="导出默认值" defaultOpen={false}>
      <div className="settings-label">默认格式</div>
      <select
        className="settings-input"
        value={value.format}
        onChange={(event) => patch({ format: event.target.value as ExportFormat })}
      >
        {(Object.keys(EXPORT_LABELS) as ExportFormat[]).map((format) => (
          <option key={format} value={format}>
            {EXPORT_LABELS[format]}
          </option>
        ))}
      </select>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.includeTimestamps !== false}
          onChange={(event) => patch({ includeTimestamps: event.target.checked })}
        />
        Markdown / TXT 保留时间戳
      </label>

      <div className="settings-label">Markdown 模板</div>
      <select
        className="settings-input"
        value={value.template}
        onChange={(event) => patch({ template: event.target.value as ExportSettings['template'] })}
      >
        <option value="timestamped">带时间戳</option>
        <option value="plain">纯内容</option>
        <option value="notes">学习笔记</option>
        <option value="meeting">会议纪要</option>
      </select>

      <div className="settings-label">ASS 字号</div>
      <input
        className="settings-input"
        type="number"
        min={12}
        max={96}
        value={value.assFontSize}
        onChange={(event) => patch({ assFontSize: Number(event.target.value) || 28 })}
      />

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.estimateTimestamps !== false}
          onChange={(event) => patch({ estimateTimestamps: event.target.checked })}
        />
        缺少时间戳时自动估算
      </label>

      <div className="settings-label">文件名模板</div>
      <input
        className="settings-input"
        value={value.filenamePattern}
        spellCheck={false}
        placeholder="{title}-{bvid}"
        onChange={(event) => patch({ filenamePattern: event.target.value })}
      />
      <div className="settings-hint">
        可用变量：{'{title}'}、{'{bvid}'}、{'{lang}'}、{'{date}'}。
      </div>
    </SettingsSection>
  );
}
