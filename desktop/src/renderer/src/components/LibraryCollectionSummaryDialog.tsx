import { Loader2 } from 'lucide-react';
import type {
  CollectionSummary,
  CollectionSummaryVersion,
  CollectionSummaryVersionMeta,
  LibraryCollection
} from '../../../shared/types';
import { formatDateTime } from '../lib/format';
import { Markdown } from './Markdown';

interface LibraryCollectionSummaryDialogProps {
  collection: LibraryCollection | null;
  summary: CollectionSummary | null;
  loading: boolean;
  error: string;
  preview: CollectionSummaryVersion | null;
  versions: CollectionSummaryVersionMeta[];
  versionsOpen: boolean;
  onClose: () => void;
  onExitPreview: () => void;
  onRestoreVersion: (id: number) => void;
  onPreviewVersion: (version: CollectionSummaryVersionMeta) => void;
  onToggleVersions: () => void;
  onGenerate: () => void;
  onExport: () => void;
}

/** 合集对比弹窗：正文/版本预览、历史版本、生成与导出。 */
export function LibraryCollectionSummaryDialog({
  collection,
  summary,
  loading,
  error,
  preview,
  versions,
  versionsOpen,
  onClose,
  onExitPreview,
  onRestoreVersion,
  onPreviewVersion,
  onToggleVersions,
  onGenerate,
  onExport
}: LibraryCollectionSummaryDialogProps) {
  if (!collection) return null;

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="confirm-card collection-summary"
        role="dialog"
        aria-label={`合集对比 ${collection.name}`}
      >
        <div className="confirm-title">合集对比 · {collection.name}</div>
        <div className="collection-summary-body">
          {preview && (
            <div className="version-banner">
              <span>
                预览版本 · {formatDateTime(preview.createdAt)} · {preview.model || 'AI'}
              </span>
              <div className="version-banner-actions">
                <button className="mini-btn" onClick={() => onRestoreVersion(preview.id)}>
                  恢复此版本
                </button>
                <button className="mini-btn" onClick={onExitPreview}>
                  退出预览
                </button>
              </div>
            </div>
          )}
          {loading && !summary && (
            <div className="status-line">
              <Loader2 size={13} className="spin" />
              正在生成对比总结…
            </div>
          )}
          {preview || summary ? (
            <Markdown content={preview ? preview.content : summary?.content || ''} />
          ) : (
            !loading && <div className="panel-empty">还没有对比总结</div>
          )}
          {loading && summary && <div className="panel-hint">正在重新生成…</div>}
          {error && <div className="status-line error">{error}</div>}
          {summary && (
            <div className="panel-hint">
              模型 {summary.model || 'AI'} · {summary.itemCount} 个视频 ·{' '}
              {formatDateTime(summary.updatedAt)}
            </div>
          )}

          {versions.length > 0 && (
            <div className="version-block">
              <button className="version-toggle" onClick={onToggleVersions}>
                历史版本 {versions.length} · {versionsOpen ? '收起' : '展开'}
              </button>
              {versionsOpen && (
                <div className="version-list">
                  {versions.map((version) => (
                    <div
                      key={version.id}
                      className={`version-row${preview?.id === version.id ? ' is-active' : ''}`}
                    >
                      <span className="version-time">{formatDateTime(version.createdAt)}</span>
                      <span className="version-model">{version.model || 'AI'}</span>
                      <span className="version-chars">{version.chars} 字</span>
                      <button className="mini-btn" onClick={() => onPreviewVersion(version)}>
                        预览
                      </button>
                      <button className="mini-btn" onClick={() => onRestoreVersion(version.id)}>
                        恢复
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="confirm-actions">
          <button className="mini-btn" onClick={onClose}>
            关闭
          </button>
          <button className="mini-btn" disabled={!summary} onClick={onExport}>
            导出
          </button>
          <button className="mini-btn primary" disabled={loading} onClick={onGenerate}>
            {loading ? '生成中…' : summary ? '重新生成' : '生成对比'}
          </button>
        </div>
      </div>
    </div>
  );
}
