import type { LibraryCollection, LibraryTag } from '../../../shared/types';

interface LibraryManageDialogProps {
  open: boolean;
  tags: LibraryTag[];
  collections: LibraryCollection[];
  tagRenameName: string;
  tagRenameDraft: string;
  collectionRenameId: number;
  collectionRenameDraft: string;
  onTagRenameStart: (name: string) => void;
  onTagRenameDraft: (value: string) => void;
  onTagRenameSave: (tag: LibraryTag) => void;
  onTagRenameCancel: () => void;
  onTagDelete: (tag: LibraryTag) => void;
  onCollectionRenameStart: (item: LibraryCollection) => void;
  onCollectionRenameDraft: (value: string) => void;
  onCollectionRenameSave: (item: LibraryCollection) => void;
  onCollectionRenameCancel: () => void;
  onCollectionDelete: (item: LibraryCollection) => void;
  onCollectionCompare: (item: LibraryCollection) => void;
  onClose: () => void;
}

/** 管理标签与合集：重命名、删除、合集对比入口。 */
export function LibraryManageDialog({
  open,
  tags,
  collections,
  tagRenameName,
  tagRenameDraft,
  collectionRenameId,
  collectionRenameDraft,
  onTagRenameStart,
  onTagRenameDraft,
  onTagRenameSave,
  onTagRenameCancel,
  onTagDelete,
  onCollectionRenameStart,
  onCollectionRenameDraft,
  onCollectionRenameSave,
  onCollectionRenameCancel,
  onCollectionDelete,
  onCollectionCompare,
  onClose
}: LibraryManageDialogProps) {
  if (!open) return null;

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="confirm-card collection-manage" role="dialog" aria-label="管理标签与合集">
        <div className="confirm-title">管理标签与合集</div>
        <div className="collection-manage-list">
          {tags.length > 0 && <div className="manage-section-label">标签</div>}
          {tags.map((tag) => (
            <div key={`tag-${tag.name}`} className="collection-manage-row">
              {tagRenameName === tag.name ? (
                <>
                  <input
                    className="tag-input"
                    autoFocus
                    value={tagRenameDraft}
                    onChange={(event) => onTagRenameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onTagRenameSave(tag);
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        onTagRenameCancel();
                      }
                    }}
                  />
                  <button className="mini-btn primary" onClick={() => onTagRenameSave(tag)}>
                    保存
                  </button>
                  <button className="mini-btn" onClick={onTagRenameCancel}>
                    取消
                  </button>
                </>
              ) : (
                <>
                  <span className="collection-manage-name" title={tag.name}>
                    {tag.name}
                    <span className="collection-manage-count"> · {tag.count}</span>
                  </span>
                  <button
                    className="mini-btn"
                    onClick={() => {
                      onTagRenameStart(tag.name);
                    }}
                  >
                    重命名
                  </button>
                  <button className="mini-btn danger" onClick={() => onTagDelete(tag)}>
                    删除
                  </button>
                </>
              )}
            </div>
          ))}

          {collections.length > 0 && <div className="manage-section-label">合集</div>}
          {collections.map((item) => (
            <div key={item.id} className="collection-manage-row">
              {collectionRenameId === item.id ? (
                <>
                  <input
                    className="tag-input"
                    autoFocus
                    value={collectionRenameDraft}
                    onChange={(event) => onCollectionRenameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onCollectionRenameSave(item);
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        onCollectionRenameCancel();
                      }
                    }}
                  />
                  <button className="mini-btn primary" onClick={() => onCollectionRenameSave(item)}>
                    保存
                  </button>
                  <button className="mini-btn" onClick={onCollectionRenameCancel}>
                    取消
                  </button>
                </>
              ) : (
                <>
                  <span className="collection-manage-name" title={item.name}>
                    {item.name}
                    <span className="collection-manage-count"> · {item.count}</span>
                  </span>
                  <button
                    className="mini-btn"
                    disabled={item.count === 0}
                    onClick={() => onCollectionCompare(item)}
                  >
                    对比
                  </button>
                  <button
                    className="mini-btn"
                    onClick={() => {
                      onCollectionRenameStart(item);
                    }}
                  >
                    重命名
                  </button>
                  <button className="mini-btn danger" onClick={() => onCollectionDelete(item)}>
                    删除
                  </button>
                </>
              )}
            </div>
          ))}
          {!collections.length && !tags.length && (
            <div className="panel-empty">还没有标签或合集</div>
          )}
        </div>
        <div className="confirm-actions">
          <button className="mini-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
