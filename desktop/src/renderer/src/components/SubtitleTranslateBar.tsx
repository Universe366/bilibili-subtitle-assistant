
interface SubtitleTranslateBarProps {
  open: boolean;
  targetLang: string;
  customTarget: string;
  effectiveTarget: string;
  hasLines: boolean;
  translating: boolean;
  progress: number;
  message: string;
  onTargetLang: (value: string) => void;
  onCustomTarget: (value: string) => void;
  onStart: () => void;
  onStop: () => void;
  onClose: () => void;
}

const LANGUAGES = ['中文（简体）', '中文（繁體）', 'English', '日本語', '한국어'];

/** 字幕翻译：目标语言选择、自定义语言、开始/停止与进度。 */
export function SubtitleTranslateBar({
  open,
  targetLang,
  customTarget,
  effectiveTarget,
  hasLines,
  translating,
  progress,
  message,
  onTargetLang,
  onCustomTarget,
  onStart,
  onStop,
  onClose
}: SubtitleTranslateBarProps) {
  if (!open) return null;

  return (
    <>
      <div className="translate-bar">
        <select
          className="mini-select"
          value={targetLang}
          onChange={(event) => onTargetLang(event.target.value)}
        >
          {LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
          <option value="__custom">自定义…</option>
        </select>
        {targetLang === '__custom' && (
          <input
            className="settings-input"
            style={{ maxWidth: 110 }}
            value={customTarget}
            placeholder="目标语言"
            spellCheck={false}
            onChange={(event) => onCustomTarget(event.target.value)}
          />
        )}
        <button
          className="mini-btn primary"
          disabled={translating || !hasLines || !effectiveTarget}
          onClick={onStart}
        >
          开始翻译
        </button>
        {translating && (
          <button className="mini-btn" onClick={onStop}>
            停止
          </button>
        )}
        <button className="mini-btn" onClick={onClose}>
          关闭
        </button>
      </div>

      {translating && (
        <div className="translate-progress">
          <span>{message || '翻译中…'}</span>
          <span>{Math.round(progress)}%</span>
        </div>
      )}
    </>
  );
}

interface SubtitleOptimizeProgressProps {
  running: boolean;
  progress: number;
  message: string;
  onStop: () => void;
}

/** 校对进度条与消息（未运行时只显示结果消息）。 */
export function SubtitleOptimizeProgress({
  running,
  progress,
  message,
  onStop
}: SubtitleOptimizeProgressProps) {
  if (!running && !message) return null;

  if (!running) return <div className="save-status">{message}</div>;

  return (
    <div className="translate-progress">
      <span>{message || '校对中…'}</span>
      <span>
        {Math.round(progress)}%
        <button className="mini-btn" onClick={onStop} style={{ marginLeft: 6 }}>
          停止
        </button>
      </span>
    </div>
  );
}

