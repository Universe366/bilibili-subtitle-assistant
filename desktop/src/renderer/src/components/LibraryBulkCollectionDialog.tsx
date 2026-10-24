import type { LibraryCollection } from '../../../shared/types';

interface LibraryBulkCollectionDialogProps {
  open: boolean;
  count: number;
  collections: LibraryCollection[];
  name: string;
  onName: (value: string) => void;
  onPick: (name: string) => void;
  onClose: () => void;
}

/** 批量加合集：选择已有合集或新建后加入。 */
export function LibraryBulkCollectionDialog({
  open,
  count,
  collections,
  name,
  onName,
  onPick,
  onClose
}: LibraryBulkCollectionDialogProps) {
  if (!open) return null;

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="confirm-card" role="dialog" aria-label="加入合集">
        <div className="confirm-title">把选中的 {count} 个视频加入合集</div>
        <div className="collection-pick-list">
          {collections.map((item) => (
            <button key={item.id} className="mini-btn" onClick={() => onPick(item.name)}>
              {item.name}（{item.count}）
            </button>
          ))}
          {!collections.length && (
            <div className="panel-hint">还没有合集，直接在下面新建一个。</div>
          )}
        </div>
        <div className="collection-pick-new">
          <input
            className="tag-input collection-name-input"
            value={name}
            placeholder="新建合集名称"
            onChange={(event) => onName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onPick(name);
              }
            }}
          />
          <button className="mini-btn primary" disabled={!name.trim()} onClick={() => onPick(name)}>
            新建并加入
          </button>
        </div>
        <div className="confirm-actions">
          <button className="mini-btn" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
