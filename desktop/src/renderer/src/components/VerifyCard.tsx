import type { VerificationSummary } from '../../../shared/types';

interface VerifyCardProps {
  verification: VerificationSummary;
}

/** 本次联网核对：查询 → 字幕原句 → 证据列表，逐条标注支持/反驳/未判定。 */
export function VerifyCard({ verification }: VerifyCardProps) {
  const items = verification.items.filter((item) => item.references.length > 0);
  const judged = verification.judged;

  return (
    <details className="verify-card">
      <summary className="verify-head">
        <span>本次联网核对</span>
        <span className="verify-stats">
          {verification.attempted} 项 · {verification.references.length} 条证据
          {judged ? ` · 丢弃 ${verification.dropped}` : ' · 未判定'}
        </span>
      </summary>
      {verification.error && <div className="verify-error">核对失败：{verification.error}</div>}
      {!judged && (
        <div className="verify-note">本次未完成语义判定，证据只按词面与域名粗标。</div>
      )}
      {verification.supplements.length > 0 && (
        <div className="verify-supplements">
          {verification.supplements.map((item, index) => (
            <div key={`${index}-${item.slice(0, 8)}`}>+ {item}</div>
          ))}
        </div>
      )}
      <div className="verify-list">
        {items.length === 0 && <div className="verify-none">本次没有取得可用证据</div>}
        {items.map((item, index) => (
          <div key={`${index}-${item.query}`} className="verify-item">
            <div className="verify-query">
              {item.label || item.query}
              <span className="verify-line">字幕：{item.line}</span>
            </div>
            {item.references.map((reference) => (
              <button
                key={reference.url}
                className="verify-ref"
                title={reference.url}
                onClick={() => void window.bsub.openExternal(reference.url)}
              >
                <span className={`verify-verdict ${reference.verdict || 'unknown'}`}>
                  {reference.verdict === 'support'
                    ? '支持'
                    : reference.verdict === 'refute'
                      ? '反驳'
                      : '未判定'}
                </span>
                <span className="verify-title">{reference.title}</span>
                {reference.site && <span className="verify-site">{reference.site}</span>}
                {reference.consistency === 'multi' && <span className="verify-tag">多源</span>}
                {reference.consistency === 'conflict' && (
                  <span className="verify-tag conflict">冲突</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
