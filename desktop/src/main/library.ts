/**
 * 库的兼容桶文件：所有域都在 library/ 下，这里保持旧的 import 路径不变。
 * 页面上「库/任务/导出」等能力的入口仍然只从 '../library' 取。
 */
export {
  checkpointLibrary,
  closeLibrary,
  initLibrary,
  libraryPath,
  librarySchemaVersion,
  vacuumLibrary
} from './library/schema';

export {
  getLibraryDetail,
  ingestVideo,
  libraryVideoBundle,
  listLibrary,
  removeVideo
} from './library/videos';

// 兼容旧 import：下载/任务/导出记录拆出后仍按原路径导出。
export {
  addDownload,
  clearDownloads,
  deleteDownload,
  listDownloads,
  updateDownload
} from './library/downloads';
export {
  clearFinishedJobs,
  createJob,
  createJobItem,
  finishJob,
  getJob,
  listJobs,
  markStaleJobs,
  setJobsListener,
  updateJob,
  updateJobItem
} from './library/jobs';
export { addExportRecord, clearExports, deleteExport, listExports } from './library/exports';
export type { JobsListener } from './library/jobs';

// 兼容旧 import：检索与历史域拆出后仍按原路径导出。
export {
  globalSearch,
  searchCollectionSummaries,
  searchLibrary,
  searchSummaries
} from './library/search';
export {
  clearBrowseHistory,
  clearHistory,
  deleteHistoryItem,
  isBookmarked,
  listBookmarks,
  listBrowseHistory,
  listHistory,
  listTranscriptions,
  recordHistory,
  removeBookmark,
  toggleBookmark
} from './library/history';

export {
  clearTrash,
  deleteTrash,
  listTrash,
  purgeExpiredTrash,
  removeVideos,
  restoreTrash,
  trimTrash
} from './library/trash';
export { addTagToVideos, deleteTag, listTags, renameTag, setVideoTags } from './library/tags';

export {
  addCollectionToVideos,
  addVideoToCollection,
  createCollection,
  deleteCollection,
  getCollectionMaterial,
  getCollectionSummary,
  getCollectionSummaryVersion,
  getVideoCollections,
  listCollectionSummaryVersions,
  listCollections,
  removeVideoFromCollection,
  renameCollection,
  restoreCollectionSummaryVersion,
  saveCollectionSummary
} from './library/collections';
export type { CollectionMaterial, CollectionMaterialBlock } from './library/collections';

export {
  getSummaryFor,
  getSummaryVersion,
  listSummaryVersions,
  restoreSummaryVersion,
  saveSummary
} from './library/summaries';
export { getNote, getNoteVersion, listNoteVersions, saveNote } from './library/notes';
