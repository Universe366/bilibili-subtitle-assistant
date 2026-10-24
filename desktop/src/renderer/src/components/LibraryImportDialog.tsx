import type { CollectionResolveResult } from '../../../shared/types';

interface LibraryImportDialogProps {
  open: boolean;
  text: string;
  summary: boolean;
  resolving: boolean;
  resolved: CollectionResolveResult | null;
  notice: string;
  onText: (value: string) => void;
  onSummary: (value: boolean) => void;
  onResolve: () => void;
  onImportResolved: () => void;
  onStart: () => void;
  onClose: () => void;
  onPodcast: () => void;
  onLocalMedia: () => void;
}

/** 导入链接弹窗：多行链接、识别合集/多 P、批量导入与「同时生成总结」。 */
export function LibraryImportDialog({
  open,
  text,
  summary,
  resolving,
  resolved,
  notice,
  onText,
  onSummary,
  onResolve,
  onImportResolved,
  onStart,
  onClose,
  onPodcast,
  onLocalMedia
}: LibraryImportDialogProps) {
  if (!open) return null;

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="confirm-card import-links" role="dialog" aria-label="导入链接">
        <div className="confirm-title">导入链接</div>
        <div className="confirm-desc">
          每行一个 B 站视频链接或 BV 号，最多 20 个。会在后台标签里逐个抓字幕入库。
        </div>
        <textarea
          className="settings-textarea"
          rows={6}
          value={text}
          placeholder="https://www.bilibili.com/video/BV1xx411c7mD"
          spellCheck={false}
          onChange={(event) => onText(event.target.value)}
        />
        <div className="import-resolve-row">
          <button className="mini-btn" disabled={!text.trim() || resolving} onClick={onResolve}>
            {resolving ? '识别中…' : '识别合集 / 多 P'}
          </button>
          {notice && <span className="import-resolve-note">{notice}</span>}
        </div>
        {resolved && (
          <div className="import-resolve-card">
            <div className="import-resolve-title">
              《{resolved.title}》 ·{' '}
              {resolved.kind === 'season' ? 'UP 主合集' : '多 P 视频'} · 共 {resolved.total} 个
            </div>
            <div className="import-resolve-list">
              {resolved.items.slice(0, 5).map((item) => (
                <span key={`${item.bvid}-${item.page ?? 0}`}>{item.title}</span>
              ))}
              {resolved.items.length > 5 && <span>…</span>}
            </div>
            <button className="mini-btn primary" onClick={onImportResolved}>
              导入全部 {resolved.total} 个
            </button>
          </div>
        )}
        <label className="settings-check">
          <input
            type="checkbox"
            checked={summary}
            onChange={(event) => onSummary(event.target.checked)}
          />
          入库后同时生成总结
        </label>
        <div className="confirm-actions">
          <button className="mini-btn" onClick={onPodcast}>
            播客 / RSS
          </button>
          <button className="mini-btn" onClick={onLocalMedia}>
            选择本地音视频
          </button>
          <button className="mini-btn" onClick={onClose}>
            取消
          </button>
          <button className="mini-btn primary" disabled={!text.trim()} onClick={onStart}>
            开始
          </button>
        </div>
      </div>
    </div>
  );
}
