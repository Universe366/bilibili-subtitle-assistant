interface LibraryBulkBarProps {
  count: number;
  visibleCount: number;
  concurrency: number;
  inputOpen: boolean;
  inputValue: string;
  inputKind: 'tag' | 'collection';
  onConcurrency: (value: number) => void;
  onSelectAll: () => void;
  onSummarize: () => void;
  onExportSubtitles: () => void;
  onExportSummary: () => void;
  exporting: boolean;
  onAddTag: () => void;
  onAddCollection: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onInput: (value: string) => void;
  onApply: () => void;
  onCloseInput: () => void;
}

/** 批量选择模式的操作条：全选、批量总结、导出字幕/总结、并发、加标签/合集、删除、取消。 */
export function LibraryBulkBar({
  count,
  visibleCount,
  concurrency,
  inputOpen,
  inputValue,
  inputKind,
  onConcurrency,
  onSelectAll,
  onSummarize,
  onExportSubtitles,
  onExportSummary,
  exporting,
  onAddTag,
  onAddCollection,
  onDelete,
  onCancel,
  onInput,
  onApply,
  onCloseInput
}: LibraryBulkBarProps) {
  return (
    <div className="bulk-bar">
      <span className="bulk-count">已选 {count}</span>
      <button className="mini-btn" disabled={!visibleCount} onClick={onSelectAll}>
        全选
      </button>
      <button className="mini-btn primary" disabled={!count} onClick={onSummarize}>
        批量总结
      </button>
      <button className="mini-btn" disabled={!count || exporting} onClick={onExportSubtitles}>
        {exporting ? '导出中…' : '导出字幕'}
      </button>
      <button className="mini-btn" disabled={!count || exporting} onClick={onExportSummary}>
        导出总结
      </button>
      <select
        className="mini-select"
        title="批量并发"
        value={concurrency}
        onChange={(event) => onConcurrency(Number(event.target.value))}
      >
        {[1, 2, 3, 4].map((value) => (
          <option key={value} value={value}>
            并发 {value}
          </option>
        ))}
      </select>
      <button className="mini-btn" onClick={onAddTag}>
        加标签
      </button>
      <button className="mini-btn" onClick={onAddCollection}>
        加合集
      </button>
      <button className="mini-btn danger" disabled={!count} onClick={onDelete}>
        删除
      </button>
      <button className="mini-btn" onClick={onCancel}>
        取消
      </button>

      {inputOpen && (
        <div className="bulk-input-row">
          <input
            className="tag-input bulk-name"
            autoFocus
            value={inputValue}
            placeholder={inputKind === 'tag' ? '标签名称' : '合集名称'}
            onChange={(event) => onInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onApply();
              }
            }}
          />
          <button className="mini-btn primary" disabled={!inputValue.trim()} onClick={onApply}>
            应用
          </button>
          <button className="mini-btn" onClick={onCloseInput}>
            取消
          </button>
        </div>
      )}
    </div>
  );
}
