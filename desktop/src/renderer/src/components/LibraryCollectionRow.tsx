import type { LibraryCollection } from '../../../shared/types';

interface LibraryCollectionRowProps {
  collections: string[];
  allCollections: LibraryCollection[];
  draft: string;
  onDraft: (value: string) => void;
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
}

/** 详情页的合集行：已有合集 chips、加入已有合集、输入新建合集。 */
export function LibraryCollectionRow({
  collections,
  allCollections,
  draft,
  onDraft,
  onAdd,
  onRemove
}: LibraryCollectionRowProps) {
  const available = allCollections.filter((item) => !collections.includes(item.name));
  return (
    <div className="tag-row collection-row">
      {collections.map((name) => (
        <span key={name} className="tag-chip collection-chip">
          {name}
          <button title="移出合集" onClick={() => onRemove(name)}>
            ×
          </button>
        </span>
      ))}
      <select
        className="mini-select collection-add-select"
        value=""
        onChange={(event) => {
          const name = event.target.value;
          if (name) onAdd(name);
        }}
      >
        <option value="">加入合集…</option>
        {available.map((item) => (
          <option key={item.id} value={item.name}>
            {item.name}（{item.count}）
          </option>
        ))}
      </select>
      <input
        className="tag-input"
        value={draft}
        placeholder="新建合集"
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onAdd(draft);
          }
        }}
      />
    </div>
  );
}
