import type { LibraryBundle } from '../../../shared/types';
import { formatDuration } from '../lib/format';

interface LibrarySubtitlesTabProps {
  bundle: LibraryBundle | null;
  hasDetail: boolean;
  lineLimit: number;
  onLoadMore: () => void;
  onSeek: (seconds: number) => void;
}

/** 字幕 tab：逐行时间轴，点击跳转到网页对应位置；超过上限显示「加载更多」。 */
export function LibrarySubtitlesTab({
  bundle,
  hasDetail,
  lineLimit,
  onLoadMore,
  onSeek
}: LibrarySubtitlesTabProps) {
  if (!bundle) {
    if (!hasDetail) return null;
    return (
      <div className="panel-empty">
        这条记录只有总结，没有入库字幕
        <div className="panel-hint">打开视频后，在「字幕」面板点「入库」即可离线阅读。</div>
      </div>
    );
  }

  const total = bundle.lines.length;
  return (
    <div className="lib-lines">
      {bundle.lines.slice(0, lineLimit).map((line, index) => (
        <button
          key={`${line.start}-${index}`}
          className="lib-line"
          title={`在网页跳到 ${formatDuration(line.start)}`}
          onClick={() => onSeek(line.start)}
        >
          <span className="lib-line-time">{formatDuration(line.start)}</span>
          <span className="lib-line-text">{line.text}</span>
        </button>
      ))}
      {total > lineLimit && (
        <button className="mini-btn lib-more" onClick={onLoadMore}>
          加载更多（还有 {(total - lineLimit).toLocaleString('zh-CN')} 行）
        </button>
      )}
    </div>
  );
}
