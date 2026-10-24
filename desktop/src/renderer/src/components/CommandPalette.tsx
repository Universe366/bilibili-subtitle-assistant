import { useEffect, useMemo, useRef, useState } from 'react';

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  commands: CommandItem[];
  onClose: () => void;
}

/** Ctrl+Shift+P：输入过滤 + ↑/↓ 选择 + Enter 执行。 */
export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return commands;
    return commands.filter((command) => command.label.toLowerCase().includes(text));
  }, [commands, query]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  if (!open) return null;

  const run = (command: CommandItem | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-label="命令面板">
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder="输入命令…（↑/↓ 选择，Enter 执行，Esc 关闭）"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setIndex((value) => (filtered.length ? (value + 1) % filtered.length : 0));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setIndex((value) =>
                filtered.length ? (value <= 0 ? filtered.length - 1 : value - 1) : 0
              );
            } else if (event.key === 'Enter') {
              event.preventDefault();
              run(filtered[index]);
            }
          }}
        />
        <div className="palette-list">
          {filtered.length === 0 && <div className="palette-empty">没有匹配的命令</div>}
          {filtered.map((command, itemIndex) => (
            <button
              key={command.id}
              className={`palette-item${itemIndex === index ? ' is-active' : ''}`}
              onMouseEnter={() => setIndex(itemIndex)}
              onClick={() => run(command)}
            >
              <span className="palette-label">{command.label}</span>
              {command.hint && <span className="palette-hint">{command.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
