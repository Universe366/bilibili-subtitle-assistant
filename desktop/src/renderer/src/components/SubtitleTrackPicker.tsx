import type { SubtitleTrack, SubtitleTrackCheck } from '../../../shared/types';

interface SubtitleTrackPickerProps {
  tracks: SubtitleTrack[];
  activeUrl: string;
  checks: SubtitleTrackCheck[];
  onPick: (track: SubtitleTrack) => void;
}

/** 字幕轨选择：语言、AI 标记、不可用原因。 */
export function SubtitleTrackPicker({ tracks, activeUrl, checks, onPick }: SubtitleTrackPickerProps) {
  const checkByUrl = new Map(checks.map((check) => [check.url, check]));

  return (
    <div className="track-list">
      {tracks.map((item) => {
        const check = checkByUrl.get(item.url);
        const invalid = check ? !check.ok : false;
        return (
          <button
            key={`${item.lan}-${item.url}`}
            className={`track-chip${activeUrl === item.url ? ' is-active' : ''}${
              invalid ? ' is-invalid' : ''
            }`}
            title={`${item.source || '未知来源'} · ${item.lan}${check ? ` · ${check.reason}` : ''}`}
            disabled={invalid}
            onClick={() => onPick(item)}
          >
            {item.lanDoc || item.lan || '未知语言'}
            {item.isAi && <span className="ai-badge">AI</span>}
            {invalid && <span className="ai-badge">不可用</span>}
          </button>
        );
      })}
    </div>
  );
}
