import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeSelection, toolbarPosition, type Point, type Rect } from '../../shared/shotGeometry';

/**
 * 框选截图覆盖窗：铺满当前显示器的截图，拖出选框后弹出动作条。
 * 只做交互与坐标，裁剪在主进程按 HiDPI 比例完成。
 */
export function ShotOverlay() {
  const [image, setImage] = useState<{ dataUrl: string; width: number; height: number } | null>(
    null
  );
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void window.bsub.shotInit().then((payload) => {
      if (!alive) return;
      if (!payload || !payload.dataUrl) {
        setError('没有拿到屏幕画面');
        void window.bsub.shotDone(null);
        return;
      }
      setImage(payload);
    });
    return () => {
      alive = false;
    };
  }, []);

  const cancel = useCallback(() => {
    void window.bsub.shotDone(null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancel]);

  const bounds = useMemo(
    () => ({ width: image?.width || window.innerWidth, height: image?.height || window.innerHeight }),
    [image]
  );

  const dragging = start !== null;
  const liveRect = start && current ? normalizeSelection(start, current, bounds, 1) : null;
  const rect = selection || liveRect;

  const finish = (action: 'image' | 'chat' | 'ocr') => {
    if (!selection) return;
    void window.bsub.shotDone({ selection, action });
  };

  const toolbarSize = { width: 248, height: 40 };
  const toolbar = selection
    ? toolbarPosition(selection, { width: bounds.width, height: bounds.height }, toolbarSize)
    : null;

  return (
    <div
      className={`shot-root${dragging ? ' is-dragging' : ''}${selection ? ' is-chosen' : ''}`}
      style={{
        ['--shot-width' as string]: `${bounds.width}px`,
        ['--shot-height' as string]: `${bounds.height}px`
      }}
      onMouseDown={(event) => {
        if (event.button !== 0 || selection) return;
        event.preventDefault();
        setStart({ x: event.clientX, y: event.clientY });
        setCurrent({ x: event.clientX, y: event.clientY });
      }}
      onMouseMove={(event) => {
        if (!start) return;
        setCurrent({ x: event.clientX, y: event.clientY });
      }}
      onMouseUp={(event) => {
        if (!start) return;
        const next = normalizeSelection(start, { x: event.clientX, y: event.clientY }, bounds);
        setStart(null);
        setCurrent(null);
        if (next) setSelection(next);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      {image && (
        <img className="shot-image" src={image.dataUrl} alt="屏幕截图" draggable={false} />
      )}

      {!rect && <div className="shot-mask" />}

      {rect && (
        <div
          className="shot-selection"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          <span className="shot-size">
            {rect.width} × {rect.height}
          </span>
        </div>
      )}

      {!selection && (
        <div className="shot-hint">
          {error || '拖动鼠标框选区域 · Esc 或右键取消'}
        </div>
      )}

      {selection && toolbar && (
        <div
          className="shot-toolbar"
          style={{ left: toolbar.x, top: toolbar.y, width: toolbarSize.width }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => finish('image')}>
            识别图片
          </button>
          <button type="button" onClick={() => finish('chat')}>
            对话
          </button>
          <button type="button" onClick={() => finish('ocr')}>
            提取文字
          </button>
          <button type="button" className="shot-toolbar-cancel" onClick={cancel}>
            取消
          </button>
        </div>
      )}
    </div>
  );
}
