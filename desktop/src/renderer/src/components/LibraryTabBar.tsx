import type { LibraryDetail } from '../../../shared/types';

type LibraryTab = 'subtitles' | 'summary' | 'note';

interface LibraryTabBarProps {
  detail: LibraryDetail | null;
  active: LibraryTab;
  onChange: (tab: LibraryTab) => void;
}

/** 详情页 tab：字幕 / 总结 / 笔记（没有字幕时禁用字幕 tab）。 */
export function LibraryTabBar({ detail, active, onChange }: LibraryTabBarProps) {
  const lineCount = detail?.bundle ? detail.bundle.lines.length : 0;
  return (
    <div className="lib-tabs">
      <button
        className={`mini-btn${active === 'subtitles' ? ' is-active' : ''}`}
        onClick={() => onChange('subtitles')}
        disabled={!detail?.bundle}
      >
        字幕 {lineCount ? lineCount.toLocaleString('zh-CN') : ''}
      </button>
      <button
        className={`mini-btn${active === 'summary' ? ' is-active' : ''}`}
        onClick={() => onChange('summary')}
      >
        总结{detail?.summary ? '' : ' —'}
      </button>
      <button
        className={`mini-btn${active === 'note' ? ' is-active' : ''}`}
        onClick={() => onChange('note')}
      >
        笔记{detail?.note ? ' •' : ''}
      </button>
    </div>
  );
}

export type { LibraryTab };
