interface LibraryEmptyStateProps {
  quickLink: string;
  onQuickLink: (value: string) => void;
  onQuickImport: (text: string) => void;
  onOpenImport: () => void;
  onOpenBilibili: () => void;
}

/** 库为空时的引导：粘贴链接直接导入并总结，或打开 B 站。 */
export function LibraryEmptyState({
  quickLink,
  onQuickLink,
  onQuickImport,
  onOpenImport,
  onOpenBilibili
}: LibraryEmptyStateProps) {
  const submit = () => {
    if (quickLink.trim()) onQuickImport(quickLink.trim());
  };

  return (
    <div className="panel-empty">
      还没有入库的视频
      <div className="panel-hint">粘贴一个视频链接，导入字幕后可以直接生成总结。</div>
      <div className="quick-import">
        <input
          value={quickLink}
          placeholder="粘贴视频链接或 BV 号…"
          spellCheck={false}
          onChange={(event) => onQuickLink(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            submit();
          }}
        />
        <button className="mini-btn primary" disabled={!quickLink.trim()} onClick={submit}>
          导入并总结
        </button>
      </div>
      <div className="panel-empty-actions">
        <button className="mini-btn" onClick={onOpenBilibili}>
          打开 B 站
        </button>
        <button className="mini-btn" onClick={onOpenImport}>
          导入链接
        </button>
      </div>
    </div>
  );
}
