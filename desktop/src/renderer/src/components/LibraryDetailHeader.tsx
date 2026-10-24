import { ChevronLeft, ExternalLink, Trash2 } from 'lucide-react';
import type { LibraryDetail, LibraryTag, LibraryVideo } from '../../../shared/types';
import { formatDate } from '../lib/format';
import { metaLine } from '../lib/libraryView';
import { ExportMenu } from './ExportMenu';

interface LibraryDetailHeaderProps {
  video: LibraryVideo | null;
  detail: LibraryDetail | null;
  tags: LibraryTag[];
  tagDraft: string;
  onTagDraft: (value: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  onBack: () => void;
  onOpen: (video: LibraryVideo) => void;
  onDelete: (video: LibraryVideo) => void;
}

/** 库详情页头部：返回、标题、导出/打开/删除、元信息与标签编辑。 */
export function LibraryDetailHeader({
  video,
  detail,
  tags,
  tagDraft,
  onTagDraft,
  onAddTag,
  onRemoveTag,
  onBack,
  onOpen,
  onDelete
}: LibraryDetailHeaderProps) {
  return (
    <>
      <div className="panel-toolbar">
        <button className="icon-btn" title="返回库" onClick={onBack}>
          <ChevronLeft size={15} />
        </button>
        <div className="panel-title lib-detail-title" title={video?.title || ''}>
          {video?.title || '库条目'}
        </div>
        <div className="toolbar-actions">
          {detail?.bundle && (
            <ExportMenu
              info={detail.bundle.info}
              track={detail.bundle.track}
              lines={detail.bundle.lines}
              summary={detail.summary?.content}
            />
          )}
          <button
            className="icon-btn"
            title={
              video && /^file:\/\//i.test(video.url)
                ? '用默认播放器打开'
                : video?.kind === 'page'
                  ? '打开原网页'
                  : '在网页打开'
            }
            disabled={!video?.url}
            onClick={() => video && onOpen(video)}
          >
            <ExternalLink size={13} />
          </button>
          <button
            className="icon-btn"
            title="从库中删除"
            onClick={() => video && onDelete(video)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {video && (
        <div className="lib-detail-meta">
          {metaLine(video)}
          {detail?.summary ? ` · 总结于 ${formatDate(detail.summary.updatedAt)}` : ' · 未总结'}
        </div>
      )}

      {detail && (
        <div className="tag-row">
          {detail.video.tags.map((tag) => (
            <span key={tag} className="tag-chip">
              {tag}
              <button title="移除标签" onClick={() => onRemoveTag(tag)}>
                ×
              </button>
            </span>
          ))}
          <input
            className="tag-input"
            value={tagDraft}
            list="lib-tag-options"
            placeholder={detail.video.tags.length ? '添加标签' : '添加标签…'}
            onChange={(event) => onTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onAddTag();
              }
            }}
          />
          <datalist id="lib-tag-options">
            {tags.map((tag) => (
              <option key={tag.name} value={tag.name} />
            ))}
          </datalist>
        </div>
      )}
    </>
  );
}
