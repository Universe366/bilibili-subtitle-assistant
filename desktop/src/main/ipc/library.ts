import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ipcMain, shell } from 'electron';
import type {
  CollectionSummary,
  CollectionSummaryVersion,
  CollectionSummaryVersionMeta,
  GlobalSearchResult,
  LibraryCollection,
  LibraryDetail,
  LibraryIngestPayload,
  LibraryIngestResult,
  LibraryList,
  LibraryNote,
  LibrarySearchResult,
  LibrarySort,
  LibraryTag,
  NoteVersion,
  NoteVersionMeta,
  PageInfo,
  Result,
  StoredSummary,
  SummaryRef,
  SummaryVersion,
  SummaryVersionMeta
} from '../../shared/types';
import {
  addCollectionToVideos,
  addTagToVideos,
  addVideoToCollection,
  clearTrash,
  createCollection,
  createJob,
  deleteCollection,
  deleteTag,
  deleteTrash,
  finishJob,
  getCollectionSummary,
  getCollectionSummaryVersion,
  getLibraryDetail,
  getNote,
  getNoteVersion,
  getSummaryFor,
  getSummaryVersion,
  globalSearch,
  ingestVideo,
  listCollectionSummaryVersions,
  listCollections,
  listLibrary,
  listNoteVersions,
  listSummaryVersions,
  listTags,
  listTrash,
  removeVideo,
  removeVideos,
  removeVideoFromCollection,
  renameCollection,
  renameTag,
  restoreCollectionSummaryVersion,
  restoreSummaryVersion,
  restoreTrash,
  saveNote,
  saveSummary,
  searchLibrary,
  setVideoTags,
  updateJob,
  vacuumLibrary
} from '../library';
import { summarizeCollection } from '../collectionSummary';
import { failure, trackJob, type IpcContext } from './shared';

/** 库 / 笔记 / 标签 / 合集 / 回收站 / 检索 相关 IPC。 */
export function registerLibraryIpc(ctx: IpcContext): void {
  ipcMain.handle(
    'library:ingest',
    async (_event, payload: LibraryIngestPayload): Promise<Result<LibraryIngestResult>> => {
      try {
        // 字幕读取时已经套过校对规则；这里不再重复应用，避免 A→AA 被放大。
        const result = ingestVideo(payload);
        console.log(
          '[m3] ingest',
          `video=${result.videoId}`,
          `track=${result.trackId}`,
          `lines=${result.lineCount}`,
          `created=${result.created}`
        );
        if (!ctx.win.isDestroyed()) ctx.win.webContents.send('library:changed');
        return { ok: true, data: result };
      } catch (error) {
        console.warn('[m3] ingest failed:', (error as Error).message);
        return failure<LibraryIngestResult>(error);
      }
    }
  );

  ipcMain.handle('library:list', async (_event, sort?: string): Promise<Result<LibraryList>> => {
    try {
      return { ok: true, data: listLibrary(sort as LibrarySort) };
    } catch (error) {
      return failure<LibraryList>(error);
    }
  });

  ipcMain.handle('library:get', async (_event, id: number): Promise<Result<LibraryDetail>> => {
    try {
      return { ok: true, data: getLibraryDetail(Number(id)) };
    } catch (error) {
      return failure<LibraryDetail>(error);
    }
  });

  ipcMain.handle('library:note', (_event, videoId: number): Result<LibraryNote | null> => {
    try {
      return { ok: true, data: getNote(Number(videoId)) };
    } catch (error) {
      return failure<LibraryNote | null>(error);
    }
  });

  ipcMain.handle(
    'library:note-save',
    (_event, payload: { videoId: number; content: string }): Result<LibraryNote | null> => {
      try {
        return {
          ok: true,
          data: saveNote(Number(payload?.videoId), String(payload?.content || ''))
        };
      } catch (error) {
        return failure<LibraryNote | null>(error);
      }
    }
  );

  ipcMain.handle('library:note-versions', (_event, videoId: number): Result<NoteVersionMeta[]> => {
    try {
      return { ok: true, data: listNoteVersions(Number(videoId)) };
    } catch (error) {
      return failure<NoteVersionMeta[]>(error);
    }
  });

  ipcMain.handle('library:note-version', (_event, id: number): Result<NoteVersion | null> => {
    try {
      return { ok: true, data: getNoteVersion(Number(id)) };
    } catch (error) {
      return failure<NoteVersion | null>(error);
    }
  });

  ipcMain.handle(
    'library:search',
    async (_event, query: string): Promise<Result<LibrarySearchResult>> => {
      try {
        return { ok: true, data: searchLibrary(query) };
      } catch (error) {
        return failure<LibrarySearchResult>(error);
      }
    }
  );

  ipcMain.handle('search:global', (_event, query: string): Result<GlobalSearchResult> => {
    try {
      return { ok: true, data: globalSearch(String(query || '')) };
    } catch (error) {
      return failure<GlobalSearchResult>(error);
    }
  });

  ipcMain.handle(
    'library:remove',
    async (_event, id: number): Promise<Result<{ removed: boolean }>> => {
      try {
        const removed = removeVideo(id);
        if (removed && !ctx.win.isDestroyed()) ctx.win.webContents.send('library:changed');
        return { ok: true, data: { removed } };
      } catch (error) {
        return failure<{ removed: boolean }>(error);
      }
    }
  );

  ipcMain.handle(
    'library:save-page-summary',
    (
      _event,
      payload: { title: string; url: string; content: string; model?: string }
    ): Result<{ videoId: number; created: boolean }> => {
      try {
        const url = String(payload?.url || '').trim();
        const content = String(payload?.content || '').trim();
        if (!/^https?:\/\//i.test(url)) return { ok: false, error: '只能保存网页地址' };
        if (!content) return { ok: false, error: '总结内容为空' };
        const info: PageInfo = {
          kind: 'page',
          bvid: null,
          aid: null,
          cid: null,
          epId: null,
          seasonId: null,
          page: 1,
          partTitle: '',
          parts: [],
          title: String(payload?.title || url).slice(0, 300),
          owner: '',
          desc: '',
          duration: 0,
          url,
          signature: `u:${url}`
        };
        const saved = saveSummary(info, content, String(payload?.model || 'AI'));
        ctx.send('library:changed', null);
        return { ok: true, data: { videoId: saved.videoId, created: !saved.updated } };
      } catch (error) {
        return failure<{ videoId: number; created: boolean }>(error);
      }
    }
  );

  ipcMain.handle('library:open-source', async (_event, id: number): Promise<Result<boolean>> => {
    try {
      const detail = getLibraryDetail(Number(id));
      const url = detail.video.url;
      if (/^https?:\/\//i.test(url)) {
        await shell.openExternal(url);
        return { ok: true, data: true };
      }
      if (!/^file:\/\//i.test(url)) return { ok: false, error: '这个条目没有可打开的来源' };
      const file = fileURLToPath(url);
      if (!fs.existsSync(file)) return { ok: false, error: '本地文件已被移动或删除' };
      const error = await shell.openPath(file);
      return error ? { ok: false, error } : { ok: true, data: true };
    } catch (error) {
      return failure<boolean>(error);
    }
  });

  ipcMain.handle('library:tags', (): Result<LibraryTag[]> => {
    try {
      return { ok: true, data: listTags() };
    } catch (error) {
      return failure<LibraryTag[]>(error);
    }
  });

  ipcMain.handle(
    'library:set-tags',
    (_event, payload: { videoId: number; tags: string[] }): Result<{ tags: string[] }> => {
      try {
        const tags = setVideoTags(Number(payload?.videoId), payload?.tags || []);
        ctx.send('library:changed', null);
        return { ok: true, data: { tags } };
      } catch (error) {
        return failure<{ tags: string[] }>(error);
      }
    }
  );

  ipcMain.handle(
    'library:tag-rename',
    (_event, payload: { name: string; newName: string }): Result<{ renamed: boolean }> => {
      try {
        renameTag(String(payload?.name || ''), String(payload?.newName || ''));
        ctx.send('library:changed', null);
        return { ok: true, data: { renamed: true } };
      } catch (error) {
        return failure<{ renamed: boolean }>(error);
      }
    }
  );

  ipcMain.handle('library:tag-delete', (_event, name: string): Result<{ removed: boolean }> => {
    try {
      const removed = deleteTag(String(name || ''));
      ctx.send('library:changed', null);
      return { ok: true, data: { removed } };
    } catch (error) {
      return failure<{ removed: boolean }>(error);
    }
  });

  ipcMain.handle(
    'library:bulk-tag',
    (_event, payload: { videoIds: number[]; name: string }): Result<{ linked: number }> => {
      try {
        const linked = addTagToVideos(payload?.videoIds || [], String(payload?.name || ''));
        ctx.send('library:changed', null);
        return { ok: true, data: { linked } };
      } catch (error) {
        return failure<{ linked: number }>(error);
      }
    }
  );

  ipcMain.handle(
    'library:bulk-collection',
    (_event, payload: { videoIds: number[]; name: string }): Result<{ linked: number }> => {
      try {
        const linked = addCollectionToVideos(payload?.videoIds || [], String(payload?.name || ''));
        ctx.send('library:changed', null);
        return { ok: true, data: { linked } };
      } catch (error) {
        return failure<{ linked: number }>(error);
      }
    }
  );

  ipcMain.handle(
    'library:bulk-remove',
    (_event, payload: { videoIds: number[] }): Result<{ removed: number }> => {
      try {
        const removed = removeVideos(payload?.videoIds || []);
        if (removed) ctx.send('library:changed', null);
        return { ok: true, data: { removed } };
      } catch (error) {
        return failure<{ removed: number }>(error);
      }
    }
  );

  ipcMain.handle('trash:list', (): Result<ReturnType<typeof listTrash>> => {
    try {
      return { ok: true, data: listTrash() };
    } catch (error) {
      return failure<ReturnType<typeof listTrash>>(error);
    }
  });

  ipcMain.handle('trash:restore', (_event, id: number): Result<{ videoId: number }> => {
    try {
      const restored = restoreTrash(Number(id));
      ctx.send('library:changed', null);
      return { ok: true, data: restored };
    } catch (error) {
      return failure<{ videoId: number }>(error);
    }
  });

  ipcMain.handle('trash:delete', (_event, id: number): Result<{ removed: boolean }> => {
    try {
      return { ok: true, data: { removed: deleteTrash(Number(id)) } };
    } catch (error) {
      return failure<{ removed: boolean }>(error);
    }
  });

  ipcMain.handle('trash:clear', (): Result<{ removed: number }> => {
    try {
      return { ok: true, data: { removed: clearTrash() } };
    } catch (error) {
      return failure<{ removed: number }>(error);
    }
  });

  ipcMain.handle('library:vacuum', (): Result<{ before: number; after: number }> => {
    try {
      return { ok: true, data: vacuumLibrary() };
    } catch (error) {
      return failure<{ before: number; after: number }>(error);
    }
  });

  ipcMain.handle('library:collections', (): Result<LibraryCollection[]> => {
    try {
      return { ok: true, data: listCollections() };
    } catch (error) {
      return failure<LibraryCollection[]>(error);
    }
  });

  ipcMain.handle(
    'library:collection-add',
    (_event, payload: { videoId: number; name: string }): Result<{ collections: string[] }> => {
      try {
        const collections = addVideoToCollection(
          Number(payload?.videoId),
          String(payload?.name || '')
        );
        ctx.send('library:changed', null);
        return { ok: true, data: { collections } };
      } catch (error) {
        return failure<{ collections: string[] }>(error);
      }
    }
  );

  ipcMain.handle(
    'library:collection-remove',
    (_event, payload: { videoId: number; name: string }): Result<{ collections: string[] }> => {
      try {
        const collections = removeVideoFromCollection(
          Number(payload?.videoId),
          String(payload?.name || '')
        );
        ctx.send('library:changed', null);
        return { ok: true, data: { collections } };
      } catch (error) {
        return failure<{ collections: string[] }>(error);
      }
    }
  );

  ipcMain.handle(
    'library:collection-rename',
    (_event, payload: { id: number; name: string }): Result<{ renamed: boolean }> => {
      try {
        renameCollection(Number(payload?.id), String(payload?.name || ''));
        ctx.send('library:changed', null);
        return { ok: true, data: { renamed: true } };
      } catch (error) {
        return failure<{ renamed: boolean }>(error);
      }
    }
  );

  ipcMain.handle(
    'library:collection-delete',
    (_event, id: number): Result<{ removed: boolean }> => {
      try {
        const removed = deleteCollection(Number(id));
        ctx.send('library:changed', null);
        return { ok: true, data: { removed } };
      } catch (error) {
        return failure<{ removed: boolean }>(error);
      }
    }
  );

  ipcMain.handle('library:collection-create', (_event, name: string): Result<LibraryCollection> => {
    try {
      const collection = createCollection(String(name || ''));
      ctx.send('library:changed', null);
      return { ok: true, data: collection };
    } catch (error) {
      return failure<LibraryCollection>(error);
    }
  });

  ipcMain.handle(
    'collection:summary',
    (_event, collectionId: number): Result<CollectionSummary | null> => {
      try {
        return { ok: true, data: getCollectionSummary(Number(collectionId)) };
      } catch (error) {
        return failure<CollectionSummary | null>(error);
      }
    }
  );

  ipcMain.handle(
    'collection:summarize',
    async (_event, collectionId: number): Promise<Result<{ requestId: string }>> => {
      try {
        const id = Number(collectionId);
        const collection = listCollections().find((item) => item.id === id);
        if (!collection) return { ok: false, error: '合集不存在' };
        if (!collection.count) return { ok: false, error: '合集里还没有视频' };

        const requestId = randomUUID();
        const controller = new AbortController();
        ctx.aiControllers.set(requestId, controller);
        trackJob(() =>
          createJob({
            id: requestId,
            type: 'collection-summary',
            title: `合集对比 · ${collection.name}`,
            meta: { collectionId: id }
          })
        );

        void (async () => {
          try {
            const summary = await summarizeCollection(id, controller.signal, (status) => {
              trackJob(() => updateJob(requestId, { message: status }));
            });
            trackJob(() =>
              finishJob(
                requestId,
                'done',
                null,
                `完成 · ${summary.content.length.toLocaleString('zh-CN')} 字`
              )
            );
            ctx.send('collection:summary-done', { collectionId: id, summary });
          } catch (error) {
            const message = controller.signal.aborted
              ? '已取消'
              : (error as Error)?.message || String(error);
            console.warn('[collection-summary] failed:', message);
            trackJob(() =>
              finishJob(requestId, controller.signal.aborted ? 'cancelled' : 'failed', message)
            );
            ctx.send('collection:summary-error', { collectionId: id, error: message });
          } finally {
            ctx.aiControllers.delete(requestId);
          }
        })();

        return { ok: true, data: { requestId } };
      } catch (error) {
        return failure<{ requestId: string }>(error);
      }
    }
  );

  ipcMain.handle(
    'collection:summary-versions',
    (_event, collectionId: number): Result<CollectionSummaryVersionMeta[]> => {
      try {
        return { ok: true, data: listCollectionSummaryVersions(Number(collectionId)) };
      } catch (error) {
        return failure<CollectionSummaryVersionMeta[]>(error);
      }
    }
  );

  ipcMain.handle(
    'collection:summary-version',
    (_event, id: number): Result<CollectionSummaryVersion | null> => {
      try {
        return { ok: true, data: getCollectionSummaryVersion(Number(id)) };
      } catch (error) {
        return failure<CollectionSummaryVersion | null>(error);
      }
    }
  );

  ipcMain.handle('collection:summary-restore', (_event, id: number): Result<CollectionSummary> => {
    try {
      return { ok: true, data: restoreCollectionSummaryVersion(Number(id)) };
    } catch (error) {
      return failure<CollectionSummary>(error);
    }
  });

  ipcMain.handle(
    'library:get-summary',
    async (_event, ref: SummaryRef): Promise<Result<StoredSummary | null>> => {
      try {
        return { ok: true, data: getSummaryFor(ref) };
      } catch (error) {
        return failure<StoredSummary | null>(error);
      }
    }
  );

  ipcMain.handle(
    'library:summary-versions',
    (_event, videoId: number): Result<SummaryVersionMeta[]> => {
      try {
        return { ok: true, data: listSummaryVersions(Number(videoId)) };
      } catch (error) {
        return failure<SummaryVersionMeta[]>(error);
      }
    }
  );

  ipcMain.handle('library:summary-version', (_event, id: number): Result<SummaryVersion | null> => {
    try {
      return { ok: true, data: getSummaryVersion(Number(id)) };
    } catch (error) {
      return failure<SummaryVersion | null>(error);
    }
  });

  ipcMain.handle('library:restore-version', (_event, id: number): Result<StoredSummary> => {
    try {
      const summary = restoreSummaryVersion(Number(id));
      ctx.send('library:changed', null);
      return { ok: true, data: summary };
    } catch (error) {
      return failure<StoredSummary>(error);
    }
  });
}
