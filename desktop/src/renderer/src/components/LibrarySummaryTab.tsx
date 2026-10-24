import { Markdown } from './Markdown';
import { formatDateTime } from '../lib/format';
import type { DiffOp } from '../lib/diff';
import type { StoredSummary, SummaryVersion, SummaryVersionMeta } from '../../../shared/types';

interface LibrarySummaryTabProps {
  summary: StoredSummary | null;
  hasDetail: boolean;
  preview: SummaryVersion | null;
  diff: DiffOp[] | null;
  versions: SummaryVersionMeta[];
  versionsOpen: boolean;
  busyVersion: number;
  onCompare: () => void;
  onPreview: (version: SummaryVersionMeta) => void;
  onRestore: (id: number) => void;
  onExitPreview: () => void;
  onToggleVersions: () => void;
}

/** 总结 tab：正文/版本预览/对比，外加历史版本列表。 */
export function LibrarySummaryTab({
  summary,
  hasDetail,
  preview,
  diff,
  versions,
  versionsOpen,
  busyVersion,
  onCompare,
  onPreview,
  onRestore,
  onExitPreview,
  onToggleVersions
}: LibrarySummaryTabProps) {
  if (!summary) {
    if (!hasDetail) return null;
    return (
      <div className="panel-empty">
        还没有总结
        <div className="panel-hint">
          打开视频后在「总结」面板生成，会自动保存到这里，之后可以离线查看。
        </div>
      </div>
    );
  }

  return (
    <div className="lib-summary">
      {preview && (
        <div className="version-banner">
          <span>
            {diff
              ? `对比：${formatDateTime(preview.createdAt)} 版本 → 当前`
              : `预览版本 · ${formatDateTime(preview.createdAt)} · ${preview.model || 'AI'}`}
          </span>
          <div className="version-banner-actions">
            {diff ? (
              <button className="mini-btn" onClick={onExitPreview}>
                退出对比
              </button>
            ) : (
              <button className="mini-btn" onClick={onCompare}>
                与当前对比
              </button>
            )}
            <button
              className="mini-btn"
              disabled={busyVersion === preview.id}
              onClick={() => onRestore(preview.id)}
            >
              恢复此版本
            </button>
            <button className="mini-btn" onClick={onExitPreview}>
              退出预览
            </button>
          </div>
        </div>
      )}
      {diff ? (
        <div className="version-diff">
          {diff.map((op, index) => (
            <div key={index} className={`diff-line is-${op.type}`}>
              <span className="diff-sign">{op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' '}</span>
              <span className="diff-text">{op.text || ' '}</span>
            </div>
          ))}
        </div>
      ) : (
        <Markdown content={preview ? preview.content : summary.content} />
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
                  <button className="mini-btn" onClick={() => onPreview(version)}>
                    预览
                  </button>
                  <button
                    className="mini-btn"
                    disabled={busyVersion === version.id}
                    onClick={() => onRestore(version.id)}
                  >
                    恢复
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
