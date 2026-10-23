import { useState } from 'react';
import { Loader2, Rss, X } from 'lucide-react';
import type { PodcastFeed } from '../../../shared/types';

function fmtDuration(seconds: number): string {
  if (!seconds) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(ms: number | null): string {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleDateString('zh-CN');
  } catch {
    return '';
  }
}

export function PodcastImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [feed, setFeed] = useState<PodcastFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!open) return null;

  const load = async () => {
    const value = url.trim();
    if (!value) return;
    setLoading(true);
    setError('');
    setNotice('');
    setFeed(null);
    const response = await window.bsub.previewPodcast(value);
    setLoading(false);
    if (response.ok) setFeed(response.data);
    else setError(response.error);
  };

  const importEpisode = async (episodeId: string) => {
    const episode = feed?.episodes.find((item) => item.id === episodeId);
    if (!episode) return;
    setBusy(episode.id);
    setError('');
    const response = await window.bsub.importPodcast({
      audioUrl: episode.audioUrl,
      title: episode.title,
      pageUrl: episode.pageUrl,
      duration: episode.duration
    });
    setBusy('');
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setNotice(`已开始识别「${episode.title}」，进度见底部任务按钮`);
    onClose();
  };

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        className="confirm-card podcast-import"
        role="dialog"
        aria-label="导入播客"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hub-head">
          <div className="confirm-title">
            <Rss size={14} /> 播客 / RSS
          </div>
          <button className="icon-btn" title="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="confirm-desc">粘贴播客订阅地址，选择一集后下载音频并语音识别入库。</div>
        <div className="podcast-url">
          <input
            autoFocus
            value={url}
            placeholder="https://example.com/feed.xml"
            spellCheck={false}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void load();
            }}
          />
          <button className="mini-btn primary" disabled={!url.trim() || loading} onClick={() => void load()}>
            {loading ? <Loader2 size={12} className="spin" /> : '读取'}
          </button>
        </div>
        {error && <div className="status-line">{error}</div>}
        {notice && <div className="status-line">{notice}</div>}
        {feed && (
          <>
            <div className="podcast-feed-title">{feed.title}</div>
            {feed.description && <div className="podcast-feed-desc">{feed.description}</div>}
            <div className="hub-list podcast-episodes">
              {feed.episodes.map((episode) => (
                <div className="hub-row is-static" key={episode.id}>
                  <span className="hub-main">
                    <span className="hub-title">{episode.title}</span>
                    <span className="hub-sub">
                      {[fmtDate(episode.pubDate), fmtDuration(episode.duration)].filter(Boolean).join(' · ') ||
                        '音频单集'}
                    </span>
                  </span>
                  <button
                    className="mini-btn"
                    disabled={Boolean(busy)}
                    onClick={() => void importEpisode(episode.id)}
                  >
                    {busy === episode.id ? '开始中…' : '导入'}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="confirm-actions">
          <button className="mini-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
