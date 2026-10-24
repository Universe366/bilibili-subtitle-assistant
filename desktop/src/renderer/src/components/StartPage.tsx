import { useEffect, useState } from 'react';
import { BookOpen, Clock, Library, Search, Settings, ListChecks } from 'lucide-react';
import type { LibraryVideo } from '../../../shared/types';

interface StartPageProps {
  onNavigate: (input: string) => void;
  onOpenLibrary: () => void;
  onOpenHistory: () => void;
  onOpenTasks: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

/** 新标签起始页：搜索、快捷入口、最近入库。 */
export function StartPage({
  onNavigate,
  onOpenLibrary,
  onOpenHistory,
  onOpenTasks,
  onOpenSettings,
  onClose
}: StartPageProps) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<LibraryVideo[]>([]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void window.bsub.listLibrary().then((response) => {
      if (response.ok) setRecent(response.data.videos.slice(0, 6));
    });
  }, []);

  const submit = () => {
    const text = query.trim();
    if (!text) return;
    onClose();
    onNavigate(text);
  };

  return (
    <div className="start-page">
      <button className="start-close" title="关闭" onClick={onClose}>
        ×
      </button>
      <div className="start-hero">
        <div className="start-clock">{now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
        <div className="start-date">
          {now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
        </div>
        <div className="start-search">
          <Search size={16} />
          <input
            autoFocus
            value={query}
            placeholder="搜索、输入网址或 BV 号…"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
              if (event.key === 'Escape') onClose();
            }}
          />
          <button className="mini-btn primary" disabled={!query.trim()} onClick={submit}>
            打开
          </button>
        </div>
        <div className="start-hint">搜索引擎跟随「设置 → 通用 → 地址栏搜索」</div>
      </div>

      <div className="start-actions">
        <button className="start-action" onClick={onOpenLibrary}>
          <Library size={16} /> 字幕库
        </button>
        <button className="start-action" onClick={onOpenHistory}>
          <Clock size={16} /> 历史记录
        </button>
        <button className="start-action" onClick={onOpenTasks}>
          <ListChecks size={16} /> 任务中心
        </button>
        <button className="start-action" onClick={onOpenSettings}>
          <Settings size={16} /> 设置
        </button>
      </div>

      {recent.length > 0 && (
        <div className="start-recent">
          <div className="start-section-title">
            <BookOpen size={13} /> 最近入库
          </div>
          <div className="start-recent-grid">
            {recent.map((video) => (
              <button
                key={video.id}
                className="start-recent-card"
                title={video.title}
                onClick={() => {
                  onClose();
                  onNavigate(video.url);
                }}
              >
                <span className="start-recent-title">{video.title}</span>
                <span className="start-recent-meta">{video.owner || '未知 UP'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
