import { Download, RefreshCw } from 'lucide-react';
import type { AppSettings, UpdateStatus } from '../../../../shared/types';
import { Markdown } from '../Markdown';
import { SettingsSection } from './SettingsSection';

type UpdateSettings = AppSettings['update'];

interface UpdateSectionProps {
  version: string;
  status: UpdateStatus | null;
  statusText: string;
  value: UpdateSettings;
  onChange: (next: UpdateSettings) => void;
  onCheck: () => void;
  onDownload: () => void;
  onSkip: () => void;
  onInstall: () => void;
  onOpenReleases: () => void;
}

/** 版本更新：检查状态、进度、发布说明、自动检查与自定义更新源。 */
export function UpdateSection({
  version,
  status,
  statusText,
  value,
  onChange,
  onCheck,
  onDownload,
  onSkip,
  onInstall,
  onOpenReleases
}: UpdateSectionProps) {
  const busy = !status || ['checking', 'downloading', 'disabled'].includes(status.state);

  return (
    <SettingsSection title="版本更新" defaultOpen={false}>
      <div className="settings-row">
        <span>当前版本</span>
        <code>v{version}</code>
      </div>
      <div className={`update-card${status ? ` is-${status.state}` : ''}`}>
        <div className="update-head">
          <span>{statusText}</span>
          <span className="muted">当前 v{version}</span>
        </div>
        {status?.checkedAt && (
          <div className="settings-hint">
            上次检查：{new Date(status.checkedAt).toLocaleString('zh-CN')}
          </div>
        )}
        {status?.state === 'downloading' && (
          <div className="update-progress">
            <span style={{ width: `${status.progress || 0}%` }} />
          </div>
        )}
        {status?.state === 'error' && status.error && (
          <div className="update-error">{status.error}</div>
        )}
        {(status?.state === 'available' || status?.state === 'downloaded') && status?.notes && (
          <div className="update-notes">
            <Markdown content={status.notes} />
          </div>
        )}
      </div>

      <div className="toolbar-actions">
        <button className="mini-btn" disabled={busy} onClick={onCheck}>
          <RefreshCw size={12} /> {status?.state === 'error' ? '重试' : '检查'}
        </button>
        {status?.state === 'available' && (
          <>
            <button className="mini-btn primary" onClick={onDownload}>
              <Download size={12} /> 下载
            </button>
            <button className="mini-btn" onClick={onSkip}>
              跳过此版本
            </button>
          </>
        )}
        {status?.state === 'downloaded' && (
          <button className="mini-btn primary" onClick={onInstall}>
            重启安装
          </button>
        )}
        <button className="mini-btn" onClick={onOpenReleases}>
          打开发布页
        </button>
      </div>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.autoCheck !== false}
          onChange={(event) => onChange({ ...value, autoCheck: event.target.checked })}
        />
        启动后自动检查
      </label>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.autoDownload === true}
          onChange={(event) => onChange({ ...value, autoDownload: event.target.checked })}
        />
        发现新版本后自动下载（安装仍需重启）
      </label>

      <div className="settings-label">自定义更新源（可选）</div>
      <input
        className="settings-input"
        value={value.feedUrl || ''}
        spellCheck={false}
        placeholder="留空使用内置 GitHub Releases"
        onChange={(event) => onChange({ ...value, feedUrl: event.target.value })}
      />
      <div className="settings-hint">
        自动检查与更新源修改后下次启动生效；未签名时 SmartScreen 仍会提示。
      </div>
    </SettingsSection>
  );
}
