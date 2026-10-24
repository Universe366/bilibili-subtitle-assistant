import { Loader2 } from 'lucide-react';
import type { TrashItem } from '../../../shared/types';
import { formatDateTime } from '../lib/format';

interface LibraryTrashDialogProps {
  open: boolean;
  loading: boolean;
  items: TrashItem[];
  busyId: number;
  onClose: () => void;
  onRestore: (item: TrashItem) => void;
  onPurge: (item: TrashItem) => void;
  onClearAll: () => void;
}

/** 回收站弹窗：列出已删除条目，恢复 / 彻底删除 / 清空。 */
export function LibraryTrashDialog({
  open,
  loading,
  items,
  busyId,
  onClose,
  onRestore,
  onPurge,
  onClearAll
}: LibraryTrashDialogProps) {
  if (!open) return null;

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        className="confirm-card trash-panel"
        role="dialog"
        aria-label="回收站"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-title">回收站</div>
        <div className="confirm-desc">
          删除的条目会在这里保留 30 天（最多 200 条），恢复后字幕、总结、笔记和标签都会回来。
        </div>
        {loading ? (
          <div className="status-line">
            <Loader2 size={13} className="spin" /> 读取中…
          </div>
        ) : items.length === 0 ? (
          <div className="panel-empty">回收站是空的</div>
        ) : (
          <div className="trash-list">
            {items.map((item) => (
              <div className="trash-row" key={item.id}>
                <div className="trash-main">
                  <div className="trash-title" title={item.title}>
                    {item.title || '未命名视频'}
                  </div>
                  <div className="trash-meta">
                    {item.owner || '未知 UP'} · {item.lineCount.toLocaleString('zh-CN')} 行
                    {item.hasSummary ? ' · 含总结' : ''}
                    {item.hasNote ? ' · 含笔记' : ''} · {formatDateTime(item.deletedAt)} 删除
                  </div>
                </div>
                <div className="trash-actions">
                  <button
                    className="mini-btn"
                    disabled={busyId === item.id}
                    onClick={() => onRestore(item)}
                  >
                    恢复
                  </button>
                  <button
                    className="mini-btn danger"
                    disabled={busyId === item.id}
                    onClick={() => onPurge(item)}
                  >
                    彻底删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="confirm-actions">
          <button className="mini-btn" onClick={onClose}>
            关闭
          </button>
          <button className="mini-btn danger" disabled={!items.length} onClick={onClearAll}>
            清空回收站
          </button>
        </div>
      </div>
    </div>
  );
}
