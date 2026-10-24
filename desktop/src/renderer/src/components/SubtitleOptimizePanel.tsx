import type { OptimizeSuggestion, QualityIssue, QualityReport } from '../../../shared/types';

interface SubtitleQualityCardProps {
  quality: QualityReport | null;
  onClose: () => void;
  onJumpIssue: (issue: QualityIssue) => void;
}

/** 字幕质检结果：统计 + 可点击的问题列表。 */
export function SubtitleQualityCard({ quality, onClose, onJumpIssue }: SubtitleQualityCardProps) {
  if (!quality) return null;

  return (
    <div className="quality-card">
      <div className="quality-head">
        <span>质检结果</span>
        <button className="mini-btn" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="quality-stats">
        {quality.stats.lines} 行 · 覆盖 {(quality.stats.coverage * 100).toFixed(0)}% ·{' '}
        {quality.stats.charsPerSecond.toFixed(1)} 字/秒
      </div>
      {quality.issues.length === 0 ? (
        <div className="settings-hint">未发现明显问题</div>
      ) : (
        <div className="quality-list">
          {quality.issues.map((issue, index) => (
            <button
              key={`${issue.code}-${issue.lineIndex ?? index}`}
              className={`quality-issue ${issue.severity}`}
              onClick={() => onJumpIssue(issue)}
            >
              {issue.message}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface SubtitleOptimizePanelProps {
  suggestions: OptimizeSuggestion[] | null;
  selected: Set<number>;
  onToggle: (index: number) => void;
  onApplyAll: () => void;
  onApplySelected: () => void;
  onClose: () => void;
}

/** AI 校对建议列表：逐条勾选、证据标记、全部/选中应用。 */
export function SubtitleOptimizePanel({
  suggestions,
  selected,
  onToggle,
  onApplyAll,
  onApplySelected,
  onClose
}: SubtitleOptimizePanelProps) {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="opt-panel">
      <div className="opt-head">
        <span>AI 优化建议 · {suggestions.length} 处</span>
        <div className="toolbar-actions">
          <button className="mini-btn" onClick={onApplyAll}>
            全部应用
          </button>
          <button className="mini-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
      <div className="opt-list">
        {suggestions.map((item) => (
          <label key={item.index} className="opt-row">
            <input
              type="checkbox"
              checked={selected.has(item.index)}
              onChange={() => onToggle(item.index)}
            />
            <div className="opt-text">
              <div className="opt-original">{item.original}</div>
              <div className="opt-suggestion">
                {item.suggestion}
                {item.verdict && (
                  <span className={`opt-verdict ${item.verdict}`}>
                    {item.verdict === 'support'
                      ? '证据支持'
                      : item.verdict === 'refute'
                        ? '证据反对'
                        : '未核实'}
                    {item.sources ? ` · ${item.sources} 源` : ''}
                    {item.consistency === 'conflict'
                      ? ' · 有冲突'
                      : item.consistency === 'multi'
                        ? ' · 多源'
                        : item.consistency === 'single'
                          ? ' · 单源'
                          : ''}
                  </span>
                )}
              </div>
              {item.evidence && <div className="opt-evidence">证据：{item.evidence}</div>}
            </div>
          </label>
        ))}
      </div>
      <button className="mini-btn primary" disabled={!selected.size} onClick={onApplySelected}>
        应用选中（{selected.size}）
      </button>
    </div>
  );
}
