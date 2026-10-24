import { Trash2 } from 'lucide-react';
import type { LibraryVideo } from '../../../shared/types';
import { formatDate } from '../lib/format';
import { metaLine } from '../lib/libraryView';

interface LibraryVideoRowProps {
  video: LibraryVideo;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: number) => void;
  onOpen: (video: LibraryVideo) => void;
  onDelete: (video: LibraryVideo) => void;
}

/** 库列表的一行：封面 / 标题 / 元信息 / 删除按钮，选择模式下换成复选框。 */
export function LibraryVideoRow({
  video,
  selectMode,
  selected,
  onToggleSelect,
  onOpen,
  onDelete
}: LibraryVideoRowProps) {
  const activate = () => {
    if (selectMode) onToggleSelect(video.id);
    else onOpen(video);
  };

  return (
    <div
      className={`lib-video${selectMode && selected ? ' is-selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter') activate();
      }}
    >
      {selectMode && (
        <input
          type="checkbox"
          className="bulk-check"
          checked={selected}
          onChange={() => onToggleSelect(video.id)}
          onClick={(event) => event.stopPropagation()}
        />
      )}
      {video.cover ? (
        <img className="lib-cover" src={video.cover} alt="" />
      ) : (
        <div className="lib-cover lib-cover-fallback">{video.title.slice(0, 1) || 'B'}</div>
      )}
      <div className="lib-meta">
        <div className="lib-title-row">
          <span className="lib-title" title={video.title}>
            {video.title}
          </span>
          {video.summaryUpdatedAt != null && <span className="lib-badge">已总结</span>}
        </div>
        <div className="lib-sub">{metaLine(video)}</div>
        <div className="lib-sub faint">
          {video.tags.length > 0
            ? video.tags.slice(0, 3).join(' · ')
            : video.summaryUpdatedAt != null
              ? `总结于 ${formatDate(video.summaryUpdatedAt)}`
              : `入库于 ${formatDate(video.createdAt)}`}
        </div>
      </div>
      {!selectMode && (
        <button
          className="lib-delete"
          title="从库中删除"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(video);
          }}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
