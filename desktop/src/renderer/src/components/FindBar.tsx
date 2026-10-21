import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { FindResult } from '../../../shared/types';

export function FindBar({
  query,
  result,
  onChange,
  onNext,
  onPrev,
  onClose
}: {
  query: string;
  result: FindResult | null;
  onChange: (value: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        className="find-input"
        value={query}
        placeholder="页内查找（Ctrl+F）"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) onPrev();
            else onNext();
          }
          if (event.key === 'Escape') onClose();
        }}
      />
      <span className="find-count">
        {result && result.matches ? `${result.activeMatchOrdinal}/${result.matches}` : '0/0'}
      </span>
      <button className="icon-btn" title="上一个（Shift+Enter）" onClick={onPrev}>
        <ChevronUp size={14} />
      </button>
      <button className="icon-btn" title="下一个（Enter）" onClick={onNext}>
        <ChevronDown size={14} />
      </button>
      <button className="icon-btn" title="关闭（Esc）" onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  );
}
