import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Globe, Home, MoreHorizontal, RotateCw, Star, X } from 'lucide-react';
import type { HistoryEntry, TabInfo } from '../../../shared/types';
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
  const [suggestions, setSuggestions] = useState<HistoryEntry[]>([]);
  const [suggestIndex, setSuggestIndex] = useState(-1);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setValue(tab?.url ?? '');
  }, [tab?.url, editing]);

  useEffect(() => {
    if (!suggestOpen) return;
    const text = value.trim();
    if (!text) {
      setSuggestions([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void window.bsub.listBrowseHistory(text, 6).then((response) => {
        if (!alive) return;
        setSuggestions(response.ok ? response.data.slice(0, 6) : []);
      });
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [value, suggestOpen]);

  useEffect(() => {
    if (!focusSignal) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal]);

  const pickSuggestion = (item: HistoryEntry) => {
    setSuggestOpen(false);
    setSuggestions([]);
    setEditing(false);
    inputRef.current?.blur();
    void window.bsub.navigate(item.url);
  };

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
            setSuggestOpen(true);
            setSuggestIndex(-1);
            event.currentTarget.select();
          }}
          onBlur={() => {
            setEditing(false);
            setValue(tab?.url ?? '');
            window.setTimeout(() => setSuggestOpen(false), 120);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && suggestions.length) {
              event.preventDefault();
              setSuggestOpen(true);
              setSuggestIndex((index) => (index + 1) % suggestions.length);
              return;
            }
            if (event.key === 'ArrowUp' && suggestions.length) {
              event.preventDefault();
              setSuggestIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
              return;
            }
            if (event.key === 'Enter') {
              const picked = suggestIndex >= 0 ? suggestions[suggestIndex] : null;
              if (picked) pickSuggestion(picked);
              else submit();
            }
            if (event.key === 'Escape') {
              setEditing(false);
              inputRef.current?.blur();
            }
          }}
        />
      </div>

      {suggestOpen && suggestions.length > 0 && (
        <div className="address-suggest" role="listbox">
          {suggestions.map((item, index) => (
            <button
              key={`${item.id}-${index}`}
              className={`address-suggest-item${index === suggestIndex ? ' is-active' : ''}`}
              role="option"
              aria-selected={index === suggestIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pickSuggestion(item)}
            >
              <span className="address-suggest-title">{item.title || item.url}</span>
              <span className="address-suggest-url">{item.url}</span>
            </button>
          ))}
        </div>
      )}

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
