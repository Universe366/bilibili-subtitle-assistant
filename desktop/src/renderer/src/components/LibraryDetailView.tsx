import { Loader2 } from 'lucide-react';
import type {
  LibraryCollection,
  LibraryDetail,
  LibraryTag,
  LibraryVideo,
  SummaryVersion,
  SummaryVersionMeta,
  NoteVersionMeta
} from '../../../shared/types';
import type { DiffOp } from '../lib/diff';
import { LibraryCollectionRow } from './LibraryCollectionRow';
import { LibraryDetailHeader } from './LibraryDetailHeader';
import { LibraryTabBar } from './LibraryTabBar';
import { LibrarySubtitlesTab } from './LibrarySubtitlesTab';
import { LibrarySummaryTab } from './LibrarySummaryTab';
import { LibraryNoteTab } from './LibraryNoteTab';
import { ConfirmDialog } from './ConfirmDialog';

type DetailTab = 'subtitles' | 'summary' | 'note';

interface LibraryDetailViewProps {
  activeVideo: LibraryVideo | null;
  detail: LibraryDetail | null;
  allTags: LibraryTag[];
  allCollections: LibraryCollection[];
  tagDraft: string;
  collectionDraft: string;
  detailTab: DetailTab;
  error: string | null;
  detailLoading: boolean;
  lineLimit: number;
  preview: SummaryVersion | null;
  diff: DiffOp[] | null;
  versions: SummaryVersionMeta[];
  versionsOpen: boolean;
  busyVersion: number;
  noteDraft: string;
  noteDirty: boolean;
  noteSaving: boolean;
  notePreview: boolean;
  noteNotice: string;
  autoSaving: boolean;
  noteVersions: NoteVersionMeta[];
  noteVersionsOpen: boolean;
  pendingDelete: LibraryVideo | null;
  linePage: number;
  setTagDraft: (value: string) => void;
  setCollectionDraft: (value: string) => void;
  setDetailTab: (tab: DetailTab) => void;
  setLineLimit: (updater: (value: number) => number) => void;
  setPreview: (value: SummaryVersion | null) => void;
  setDiff: (value: DiffOp[] | null) => void;
  setVersionsOpen: (updater: (value: boolean) => boolean) => void;
  setNoteDraft: (value: string) => void;
  setNoteDirty: (value: boolean) => void;
  setNotePreview: (updater: (value: boolean) => boolean) => void;
  setNoteVersionsOpen: (updater: (value: boolean) => boolean) => void;
  setPendingDelete: (video: LibraryVideo | null) => void;
  addTag: () => void;
  removeTag: (tag: string) => void;
  backToList: () => void;
  openInBrowser: (video: LibraryVideo, seconds?: number) => void;
  addToCollection: (name: string) => Promise<unknown>;
  removeFromCollection: (name: string) => Promise<unknown>;
  compareVersion: () => void;
  previewVersion: (version: SummaryVersionMeta) => Promise<unknown>;
  restoreVersion: (id: number) => Promise<unknown>;
  exportNote: () => Promise<unknown>;
  saveNoteDraft: () => Promise<unknown>;
  loadNoteVersion: (version: NoteVersionMeta) => Promise<unknown>;
  confirmDelete: () => Promise<unknown>;
}

/** 库详情页：头部、合集行、tab 栏与三个正文 tab。 */
export function LibraryDetailView(props: LibraryDetailViewProps) {
  const {
    activeVideo,
    detail,
    allTags,
    allCollections,
    tagDraft,
    collectionDraft,
    detailTab,
    error,
    detailLoading,
    lineLimit,
    preview,
    diff,
    versions,
    versionsOpen,
    busyVersion,
    noteDraft,
    noteDirty,
    noteSaving,
    notePreview,
    noteNotice,
    autoSaving,
    noteVersions,
    noteVersionsOpen,
    pendingDelete,
    linePage,
    setTagDraft,
    setCollectionDraft,
    setDetailTab,
    setLineLimit,
    setPreview,
    setDiff,
    setVersionsOpen,
    setNoteDraft,
    setNoteDirty,
    setNotePreview,
    setNoteVersionsOpen,
    setPendingDelete,
    addTag,
    removeTag,
    backToList,
    openInBrowser,
    addToCollection,
    removeFromCollection,
    compareVersion,
    previewVersion,
    restoreVersion,
    exportNote,
    saveNoteDraft,
    loadNoteVersion,
    confirmDelete
  } = props;

  return (
    <div className="panel">
      <LibraryDetailHeader
        video={activeVideo}
        detail={detail}
        tags={allTags}
        tagDraft={tagDraft}
        onTagDraft={setTagDraft}
        onAddTag={addTag}
        onRemoveTag={removeTag}
        onBack={backToList}
        onOpen={openInBrowser}
        onDelete={setPendingDelete}
      />

      {detail && (
        <LibraryCollectionRow
          collections={detail.video.collections}
          allCollections={allCollections}
          draft={collectionDraft}
          onDraft={setCollectionDraft}
          onAdd={(name) => void addToCollection(name)}
          onRemove={(name) => void removeFromCollection(name)}
        />
      )}

      <LibraryTabBar detail={detail} active={detailTab} onChange={setDetailTab} />

      {error && <div className="status-line error">{error}</div>}

      {detailLoading && !detail && (
        <div className="status-line">
          <Loader2 size={13} className="spin" />
          读取中…
        </div>
      )}

      {detailTab === 'subtitles' && (
        <LibrarySubtitlesTab
          bundle={detail?.bundle ?? null}
          hasDetail={Boolean(detail)}
          lineLimit={lineLimit}
          onLoadMore={() => setLineLimit((value) => value + linePage)}
          onSeek={(seconds) => detail && openInBrowser(detail.video, seconds)}
        />
      )}

      {detailTab === 'summary' && (
        <LibrarySummaryTab
          summary={detail?.summary ?? null}
          hasDetail={Boolean(detail)}
          preview={preview}
          diff={diff}
          versions={versions}
          versionsOpen={versionsOpen}
          busyVersion={busyVersion}
          onCompare={compareVersion}
          onPreview={(version) => void previewVersion(version)}
          onRestore={(id) => void restoreVersion(id)}
          onExitPreview={() => {
            setPreview(null);
            setDiff(null);
          }}
          onToggleVersions={() => setVersionsOpen((value) => !value)}
        />
      )}

      {detailTab === 'note' && detail && (
        <LibraryNoteTab
          draft={noteDraft}
          dirty={noteDirty}
          saving={noteSaving}
          preview={notePreview}
          notice={noteNotice}
          autoSaving={autoSaving}
          versions={noteVersions}
          versionsOpen={noteVersionsOpen}
          savedAt={detail.note?.updatedAt ?? null}
          onChange={(value) => {
            setNoteDraft(value);
            setNoteDirty(true);
          }}
          onTogglePreview={() => setNotePreview((value) => !value)}
          onExport={() => void exportNote()}
          onSave={() => void saveNoteDraft()}
          onLoadVersion={(version) => void loadNoteVersion(version)}
          onToggleVersions={() => setNoteVersionsOpen((value) => !value)}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="从库中删除？"
        description={
          pendingDelete
            ? `「${pendingDelete.title}」的字幕、总结和搜索索引会一起删除，无法撤销。`
            : undefined
        }
        confirmText="删除"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
