import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ExportFormat, PageInfo, SubtitleLine, SubtitleTrack } from '../../../shared/types';

const FORMATS: Array<{ id: ExportFormat; label: string }> = [
  { id: 'md', label: 'Markdown (.md)' },
  { id: 'srt', label: '字幕 (.srt)' },
  { id: 'vtt', label: 'WebVTT (.vtt)' },
  { id: 'ass', label: 'ASS (.ass)' },
  { id: 'txt', label: '纯文本 (.txt)' },
  { id: 'json', label: 'JSON (.json)' }
];

export function ExportMenu({
  info,
  track,
  lines,
  summary,
  translated,
  translationLanguage
}: {
  info: PageInfo | null;
  track: SubtitleTrack | null;
  lines: SubtitleLine[];
  summary?: string;
  translated?: SubtitleLine[] | null;
  translationLanguage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [defaultFormat, setDefaultFormat] = useState<ExportFormat>('md');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.bsub.getSettings().then((response) => {
      if (response.ok) setDefaultFormat(response.data.settings.export.format);
    });
  }, []);

  const formats = useMemo(() => {
    const first = FORMATS.find((format) => format.id === defaultFormat) || FORMATS[0];
    return [first, ...FORMATS.filter((format) => format.id !== first.id)];
  }, [defaultFormat]);

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
      const response = await window.bsub.exportVideo({
        format,
        info,
        track,
        lines,
        summary,
        translatedLines: translated || undefined,
        translationLanguage
      });
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
          {formats.map((format) => (
            <button key={format.id} className="export-item" onClick={() => void run(format.id)}>
              {format.label}
              {format.id === defaultFormat ? '（默认）' : ''}
            </button>
          ))}
        </div>
      )}
      {message && <div className="export-toast">{message}</div>}
    </div>
  );
}
