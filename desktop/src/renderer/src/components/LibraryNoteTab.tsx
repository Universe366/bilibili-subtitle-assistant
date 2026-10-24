import { Markdown } from './Markdown';
import { formatDateTime } from '../lib/format';
import type { NoteVersionMeta } from '../../../shared/types';

interface LibraryNoteTabProps {
  draft: string;
  dirty: boolean;
  saving: boolean;
  preview: boolean;
  notice: string;
  autoSaving: boolean;
  versions: NoteVersionMeta[];
  versionsOpen: boolean;
  savedAt: number | null;
  onChange: (value: string) => void;
  onTogglePreview: () => void;
  onExport: () => void;
  onSave: () => void;
  onLoadVersion: (version: NoteVersionMeta) => void;
  onToggleVersions: () => void;
}

/** 笔记 tab：纯文本编辑 / Markdown 预览、字数与保存状态、历史版本。 */
export function LibraryNoteTab({
  draft,
  dirty,
  saving,
  preview,
  notice,
  autoSaving,
  versions,
  versionsOpen,
  savedAt,
  onChange,
  onTogglePreview,
  onExport,
  onSave,
  onLoadVersion,
  onToggleVersions
}: LibraryNoteTabProps) {
  return (
    <div className="note-panel">
      {preview ? (
        <div className="note-preview">
          <Markdown content={draft.trim() || '*还没有内容*'} />
        </div>
      ) : (
        <textarea
          className="note-textarea"
          value={draft}
          placeholder="写点笔记…（Ctrl+S 保存）"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              onSave();
            }
          }}
        />
      )}
      <div className="note-foot">
        <span>
          {draft.length} 字
          {dirty ? ' · 未保存' : savedAt ? ` · 保存于 ${formatDateTime(savedAt)}` : ' · 空笔记不会保存'}
        </span>
        <div className="note-actions">
          <button className="mini-btn" onClick={onTogglePreview}>
            {preview ? '编辑' : '预览'}
          </button>
          <button className="mini-btn" disabled={!draft.trim()} onClick={onExport}>
            导出
          </button>
          <button className="mini-btn primary" disabled={!dirty || saving} onClick={onSave}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
      {notice && <div className="status-line">{notice}</div>}
      {(autoSaving || dirty) && (
        <div className="panel-hint">{autoSaving ? '正在自动保存…' : '停止输入后会自动保存'}</div>
      )}

      {versions.length > 0 && (
        <div className="version-block">
          <button className="version-toggle" onClick={onToggleVersions}>
            历史版本 {versions.length} · {versionsOpen ? '收起' : '展开'}
          </button>
          {versionsOpen && (
            <div className="version-list">
              {versions.map((version) => (
                <div key={version.id} className="version-row">
                  <span className="version-time">{formatDateTime(version.createdAt)}</span>
                  <span className="version-chars">{version.chars} 字</span>
                  <button className="mini-btn" onClick={() => onLoadVersion(version)}>
                    载入
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
