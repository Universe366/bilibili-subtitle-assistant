import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ExportFormat, PageInfo, SubtitleLine, SubtitleTrack } from '../../../shared/types';

const FORMATS: Array<{ id: ExportFormat; label: string }> = [
  { id: 'md', label: 'Markdown (.md)' },
  { id: 'srt', label: '字幕 (.srt)' },
  { id: 'txt', label: '纯文本 (.txt)' },
  { id: 'json', label: 'JSON (.json)' }
];

export function ExportMenu({
  info,
  track,
  lines,
  summary
}: {
  info: PageInfo | null;
  track: SubtitleTrack | null;
  lines: SubtitleLine[];
  summary?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const run = async (format: ExportFormat) => {
    if (!info) return;
    setOpen(false);
    setBusy(true);
    setMessage('');
    try {
      const response = await window.bsub.exportVideo({ format, info, track, lines, summary });
      if (!response.ok) setMessage(response.error);
      else if ('canceled' in response.data) setMessage('已取消');
      else setMessage(`已导出 ${response.data.path.split(/[\\/]/).pop()}`);
    } finally {
      setBusy(false);
      window.setTimeout(() => setMessage(''), 5000);
    }
  };

  return (
    <div className="export-menu" ref={ref}>
      <button
        className="mini-btn"
        disabled={!info || busy}
        title="导出字幕 / 总结"
        onClick={() => setOpen((value) => !value)}
      >
        {busy ? <Loader2 size={12} className="spin" /> : '导出'}
      </button>
      {open && (
        <div className="export-popover">
          {FORMATS.map((format) => (
            <button key={format.id} className="export-item" onClick={() => void run(format.id)}>
              {format.label}
            </button>
          ))}
        </div>
      )}
      {message && <div className="export-toast">{message}</div>}
    </div>
  );
}
