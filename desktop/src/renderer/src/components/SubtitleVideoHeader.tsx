import { AlertTriangle, Eye } from 'lucide-react';
import type { PageInfo } from '../../../shared/types';
import { formatDuration } from '../lib/format';

interface SubtitleVideoHeaderProps {
  info: PageInfo | null;
  error: string | null;
  onRetry: () => void;
}

function fmtCount(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return String(value);
}

/** 视频信息卡与读取失败提示。 */
export function SubtitleVideoHeader({ info, error, onRetry }: SubtitleVideoHeaderProps) {
  return (
    <>
      {info && (
        <div className="video-card">
          {info.cover ? (
            <img className="video-cover" src={info.cover} alt="" />
          ) : (
            <div className="video-cover video-cover-fallback">{info.title.slice(0, 1) || 'B'}</div>
          )}
          <div className="video-meta">
            <div className="video-title" title={info.title}>
              {info.title || '未识别到视频'}
            </div>
            <div className="video-sub">
              {info.owner || (info.kind === 'youtube' ? '未知频道' : '未知 UP')}
              {info.duration ? ` · ${formatDuration(info.duration)}` : ''}
            </div>
            <div className="video-tags">
              {info.bvid && <span className="mini-tag">{info.bvid}</span>}
              {info.kind !== 'youtube' && info.page > 0 && (
                <span className="mini-tag">P{info.page}</span>
              )}
              {info.stat && info.stat.view > 0 && (
                <span className="mini-tag">
                  <Eye size={11} />
                  {fmtCount(info.stat.view)}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="warn-card">
          <AlertTriangle size={15} />
          <div className="warn-body">
            <div className="warn-title">读取失败</div>
            <div className="warn-desc">{error}</div>
            <button className="warn-btn" onClick={onRetry}>
              重试
            </button>
          </div>
        </div>
      )}
    </>
  );
}
