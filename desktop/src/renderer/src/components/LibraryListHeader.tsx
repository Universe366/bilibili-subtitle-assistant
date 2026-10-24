import { RefreshCw, Search, Trash2 } from 'lucide-react';

interface LibraryListHeaderProps {
  query: string;
  onQuery: (value: string) => void;
  filtersOpen: boolean;
  filterActive: boolean;
  selectMode: boolean;
  canSelect: boolean;
  loading: boolean;
  onToggleFilters: () => void;
  onNewCollection: () => void;
  onImport: () => void;
  onOpenTrash: () => void;
  onToggleSelect: () => void;
  onRefresh: () => void;
}

/** 库列表头部：标题、合集/导入/筛选/回收站/选择/刷新，以及搜索框。 */
export function LibraryListHeader({
  query,
  onQuery,
  filtersOpen,
  filterActive,
  selectMode,
  canSelect,
  loading,
  onToggleFilters,
  onNewCollection,
  onImport,
  onOpenTrash,
  onToggleSelect,
  onRefresh
}: LibraryListHeaderProps) {
  return (
    <>
      <div className="panel-toolbar">
        <div className="panel-title">库</div>
        <div className="toolbar-actions">
          <button
            className="mini-btn"
            title="新建一个合集，然后在「选择」模式里加视频"
            onClick={onNewCollection}
          >
            ＋合集
          </button>
          <button className="mini-btn" onClick={onImport}>
            导入链接
          </button>
          <button
            className={`mini-btn${filtersOpen || filterActive ? ' is-active' : ''}`}
            onClick={onToggleFilters}
          >
            筛选
          </button>
          <button className="icon-btn" title="回收站" onClick={onOpenTrash}>
            <Trash2 size={13} />
          </button>
          <button
            className={`mini-btn${selectMode ? ' is-active' : ''}`}
            disabled={!canSelect}
            onClick={onToggleSelect}
          >
            {selectMode ? '取消' : '选择'}
          </button>
          <button className="icon-btn" title="刷新" onClick={onRefresh}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <div className="library-search">
        <Search size={13} />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="搜索标题、UP、标签、合集、笔记或字幕…"
          spellCheck={false}
        />
      </div>
    </>
  );
}
