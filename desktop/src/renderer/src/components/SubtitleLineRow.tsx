import { Copy, Pencil } from 'lucide-react';
import type { SubtitleLine } from '../../../shared/types';
import { formatDuration } from '../lib/format';
import { highlightMatch } from '../lib/highlight';

type ViewMode = 'original' | 'translated' | 'bilingual';

interface SubtitleLineRowProps {
  line: SubtitleLine;
  index: number;
  active: boolean;
  editing: boolean;
  editingText: string;
  viewMode: ViewMode;
  translatedText: string;
  query: string;
  onJump: (line: SubtitleLine) => void;
  onEditStart: (index: number, text: string) => void;
  onEditText: (value: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onCopy: (text: string) => void;
}

/** 单行字幕：时间轴、原文/译文、行内编辑与复制。 */
export function SubtitleLineRow({
  line,
  index,
  active,
  editing,
  editingText,
  viewMode,
  translatedText,
  query,
  onJump,
  onEditStart,
  onEditText,
  onEditCommit,
  onEditCancel,
  onCopy
}: SubtitleLineRowProps) {
  const displayText = viewMode === 'translated' ? translatedText || line.text : line.text;
  const hasQuery = query.trim().length > 0;

  return (
    <div
      className={`sub-line${active ? ' is-active' : ''}`}
      onClick={() => onJump(line)}
    >
      <span className="sub-time">{formatDuration(line.start)}</span>
      {editing ? (
        <input
          className="sub-edit"
          autoFocus
          value={editingText}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onEditText(event.target.value)}
          onBlur={onEditCommit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onEditCommit();
            } else if (event.key === 'Escape') {
              onEditCancel();
            }
          }}
        />
      ) : (
        <span
          className="sub-text"
          title={`${formatDuration(line.start)} – ${formatDuration(line.end)} · ${line.text.length} 字 · 约 ${Math.max(
            1,
            Math.round(line.text.length / 4)
          )} 秒${translatedText ? `\n译文：${translatedText}` : ''}`}
        >
          {viewMode !== 'translated' && (
            <span className="sub-text-row">
              {hasQuery ? highlightMatch(line.text, query) : line.text}
            </span>
          )}
          {viewMode !== 'original' && (
            <span className={`sub-text-row${viewMode === 'bilingual' ? ' sub-text-translated' : ''}`}>
              {hasQuery
                ? highlightMatch(translatedText || (viewMode === 'translated' ? line.text : ''), query)
                : translatedText || (viewMode === 'translated' ? line.text : '')}
            </span>
          )}
        </span>
      )}
      <button
        className="sub-edit-btn"
        title="编辑此行"
        onClick={(event) => {
          event.stopPropagation();
          onEditStart(index, line.text);
        }}
      >
        <Pencil size={10} />
      </button>
      <button
        className="sub-copy"
        title="复制此行"
        onClick={(event) => {
          event.stopPropagation();
          onCopy(displayText);
        }}
      >
        <Copy size={10} />
      </button>
    </div>
  );
}
