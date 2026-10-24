import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';

export interface DropPayload {
  kind: 'url' | 'text' | 'files';
  value: string;
}

interface DropData {
  getData: (type: string) => string;
  files?: ArrayLike<File>;
}

/**
 * 从拖放数据里提取可导航目标：优先 uri-list，其次纯文本。
 * 只接受 http(s)、裸域名或 BV 号，避免把任意文本当地址打开。
 */
export function extractDropPayload(data: DropData): DropPayload | null {
  const uri = String(data.getData('text/uri-list') || '').trim();
  const text = String(data.getData('text/plain') || '').trim();
  const raw = uri || text;
  if (raw) {
    const first =
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0) || '';
    if (/^https?:\/\//i.test(first)) return { kind: 'url', value: first };
    if (/^BV[0-9A-Za-z]{10}$/.test(first)) return { kind: 'text', value: first };
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(first)) return { kind: 'text', value: first };
  }
  if (data.files && data.files.length > 0) return { kind: 'files', value: String(data.files.length) };
  return null;
}

export interface DropHandlers {
  onDragEnter: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}

/** 拖放监听：拖入时返回 dragging 以便渲染提示层。 */
export function useDropImport(onDropTarget: (payload: DropPayload) => void): {
  dragging: boolean;
  handlers: DropHandlers;
} {
  const [depth, setDepth] = useState(0);

  useEffect(() => {
    if (depth < 0) setDepth(0);
  }, [depth]);

  return {
    dragging: depth > 0,
    handlers: {
      onDragEnter: () => setDepth((value) => value + 1),
      onDragOver: (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave: () => setDepth((value) => Math.max(0, value - 1)),
      onDrop: (event) => {
        event.preventDefault();
        setDepth(0);
        const payload = extractDropPayload(event.dataTransfer);
        if (payload) onDropTarget(payload);
      }
    }
  };
}
