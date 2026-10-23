import { useEffect } from 'react';

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '删除',
  cancelText = '取消',
  danger = true,
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="confirm-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="confirm-card" role="dialog" aria-modal="true" aria-label={title}>
        <div className="confirm-title">{title}</div>
        {description && <div className="confirm-desc">{description}</div>}
        <div className="confirm-actions">
          <button className="mini-btn" onClick={onCancel}>
            {cancelText}
          </button>
          <button className={`mini-btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
