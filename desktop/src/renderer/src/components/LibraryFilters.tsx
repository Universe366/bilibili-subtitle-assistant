import type { LibraryCollection, LibrarySort, LibraryTag } from '../../../shared/types';
import { SORTS } from '../lib/libraryView';

interface LibraryFiltersProps {
  open: boolean;
  sort: LibrarySort;
  onSort: (sort: LibrarySort) => void;
  tags: LibraryTag[];
  tagFilter: string;
  onTagFilter: (value: string) => void;
  collections: LibraryCollection[];
  collectionFilter: string;
  onCollectionFilter: (value: string) => void;
  onManage: () => void;
}

/** 库的筛选条：排序 + 标签 + 合集；收起时只显示当前筛选摘要。 */
export function LibraryFilters({
  open,
  sort,
  onSort,
  tags,
  tagFilter,
  onTagFilter,
  collections,
  collectionFilter,
  onCollectionFilter,
  onManage
}: LibraryFiltersProps) {
  if (!open) {
    if (!tagFilter && !collectionFilter) return null;
    return (
      <div className="filter-summary">
        {tagFilter && <span>标签：{tagFilter}</span>}
        {collectionFilter && <span>合集：{collectionFilter}</span>}
        <button
          className="mini-btn"
          onClick={() => {
            onTagFilter('');
            onCollectionFilter('');
          }}
        >
          清除
        </button>
      </div>
    );
  }

  return (
    <div className="library-filters">
      <select
        className="mini-select"
        title="排序"
        value={sort}
        onChange={(event) => onSort(event.target.value as LibrarySort)}
      >
        {SORTS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      {tags.length > 0 && (
        <select
          className="mini-select"
          title="按标签筛选"
          value={tagFilter}
          onChange={(event) => onTagFilter(event.target.value)}
        >
          <option value="">全部标签</option>
          {tags.map((tag) => (
            <option key={tag.name} value={tag.name}>
              {tag.name}（{tag.count}）
            </option>
          ))}
        </select>
      )}
      {collections.length > 0 && (
        <select
          className="mini-select"
          title="按合集筛选"
          value={collectionFilter}
          onChange={(event) => onCollectionFilter(event.target.value)}
        >
          <option value="">全部合集</option>
          {collections.map((item) => (
            <option key={item.id} value={item.name}>
              {item.name}（{item.count}）
            </option>
          ))}
        </select>
      )}
      {(collections.length > 0 || tags.length > 0) && (
        <button className="mini-btn" onClick={onManage}>
          管理
        </button>
      )}
      <button
        className="mini-btn"
        onClick={() => {
          onTagFilter('');
          onCollectionFilter('');
        }}
      >
        清除
      </button>
    </div>
  );
}
