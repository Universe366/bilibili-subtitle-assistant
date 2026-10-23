import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Globe, Home, MoreHorizontal, RotateCw, Star, X } from 'lucide-react';
import type { TabInfo } from '../../../shared/types';
import type { HubSection } from './BrowserHub';

export function AddressBar({
  tab,
  focusSignal = 0,
  bookmarked,
  onToggleBookmark,
  onOpenHub,
  onOpenReader
}: {
  tab: TabInfo | null;
  focusSignal?: number;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  onOpenHub: (section: HubSection) => void;
  onOpenReader: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setValue(tab?.url ?? '');
  }, [tab?.url, editing]);

  useEffect(() => {
    if (!focusSignal) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal]);

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    setEditing(false);
    inputRef.current?.blur();
    void window.bsub.navigate(text);
  };

  return (
    <div className="address-bar">
      <div className="nav-group">
        <button
          className="nav-btn"
          disabled={!tab?.canGoBack}
          title="后退"
          onClick={() => void window.bsub.back()}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          className="nav-btn"
          disabled={!tab?.canGoForward}
          title="前进"
          onClick={() => void window.bsub.forward()}
        >
          <ArrowRight size={16} />
        </button>
        <button
          className="nav-btn"
          title={tab?.loading ? '停止' : '刷新'}
          onClick={() => (tab?.loading ? void window.bsub.stop() : void window.bsub.reload())}
        >
          {tab?.loading ? <X size={15} /> : <RotateCw size={15} />}
        </button>
      </div>

      <div className="address-field">
        <Globe size={13} />
        <input
          ref={inputRef}
          value={editing ? value : tab?.url ?? ''}
          placeholder="输入 BV 号、链接或搜索词"
          spellCheck={false}
          onChange={(event) => {
            setEditing(true);
            setValue(event.target.value);
          }}
          onFocus={(event) => {
            setEditing(true);
            setValue(tab?.url ?? '');
            event.currentTarget.select();
          }}
          onBlur={() => {
            setEditing(false);
            setValue(tab?.url ?? '');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
            if (event.key === 'Escape') {
              setEditing(false);
              inputRef.current?.blur();
            }
          }}
        />
      </div>

      <button
        className="nav-btn"
        title="阅读模式（Alt+R）"
        disabled={!tab}
        onClick={onOpenReader}
      >
        <BookOpen size={15} />
      </button>

      <button
        className={`nav-btn${bookmarked ? ' is-active' : ''}`}
        title={bookmarked ? '取消书签（Ctrl+D）' : '收藏此页（Ctrl+D）'}
        disabled={!tab}
        onClick={onToggleBookmark}
      >
        <Star size={15} fill={bookmarked ? 'currentColor' : 'none'} />
      </button>

      <button
        className="nav-btn"
        title="历史 / 书签 / 下载"
        onClick={() => onOpenHub('history')}
      >
        <MoreHorizontal size={16} />
      </button>

      <button
        className="zoom-btn"
        title="重置缩放（Ctrl+0）"
        onClick={() => void window.bsub.zoomReset()}
      >
        {Math.round((tab?.zoom ?? 1) * 100)}%
      </button>

      <button
        className="nav-btn"
        title="打开 B 站首页"
        onClick={() => void window.bsub.newTab('https://www.bilibili.com/')}
      >
        <Home size={16} />
      </button>
    </div>
  );
}
