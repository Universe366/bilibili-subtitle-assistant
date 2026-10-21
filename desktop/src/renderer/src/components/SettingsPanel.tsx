import { useEffect, useState } from 'react';
import { Download, FolderOpen, Loader2, RefreshCw, Save, Wifi } from 'lucide-react';
import type { AiPlatform, AppSettings, BridgeStatus, UpdateStatus } from '../../../shared/types';

function updateText(status: UpdateStatus | null): string {
  if (!status) return '尚未检查';
  switch (status.state) {
    case 'disabled':
      return status.error || '当前版本不支持自动更新';
    case 'idle':
      return '尚未检查';
    case 'checking':
      return '正在检查更新…';
    case 'available':
      return `发现新版本 ${status.version || ''}`;
    case 'not-available':
      return '已是最新版本';
    case 'downloading':
      return `正在下载 ${status.progress || 0}%`;
    case 'downloaded':
      return `新版本 ${status.version || ''} 已下载，重启后安装`;
    case 'error':
      return `检查失败：${status.error || '未知错误'}`;
    default:
      return '';
  }
}

export function SettingsPanel() {
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [dataDir, setDataDir] = useState('');
  const [version, setVersion] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [updateState, setUpdateState] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    void window.bsub.getBridgeStatus().then((response) => {
      if (response.ok) setBridge(response.data);
    });
    void window.bsub.getUpdateStatus().then((response) => {
      if (response.ok) setUpdateState(response.data);
    });
    return window.bsub.onUpdateStatus((status) => setUpdateState(status));
  }, []);

  useEffect(() => {
    let alive = true;
    window.bsub
      .getSettings()
      .then((response) => {
        if (!alive) return;
        if (response.ok) {
          setDraft(response.data.settings);
          setDataDir(response.data.dataDir);
          setVersion(response.data.version);
        } else {
          setError(response.error);
        }
      })
      .catch((caught) => {
        if (alive) setError((caught as Error).message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const active = draft
    ? draft.ai.platforms.find((platform) => platform.id === draft.ai.activeId) || draft.ai.platforms[0]
    : null;

  const updatePlatform = (patch: Partial<AiPlatform>) => {
    if (!draft || !active) return;
    setDraft({
      ...draft,
      ai: {
        ...draft.ai,
        platforms: draft.ai.platforms.map((platform) =>
          platform.id === active.id ? { ...platform, ...patch } : platform
        )
      }
    });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const response = await window.bsub.saveSettings(draft);
      if (response.ok) {
        setDraft(response.data.settings);
        setDataDir(response.data.dataDir);
        setMessage('已保存');
        const status = await window.bsub.getBridgeStatus();
        if (status.ok) setBridge(status.data);
      } else {
        setError(response.error);
      }
    } finally {
      setSaving(false);
      window.setTimeout(() => setMessage(''), 3000);
    }
  };

  const test = async () => {
    if (!active) return;
    setTesting(true);
    setMessage('');
    setError('');
    try {
      const response = await window.bsub.testAi(active);
      if (response.ok) setMessage(`连接成功 · ${response.data.latencyMs}ms`);
      else setError(response.error);
    } finally {
      setTesting(false);
    }
  };

  if (!draft || !active) {
    return (
      <div className="panel">
        <div className="panel-title">设置</div>
        <div className="status-line">
          <Loader2 size={13} className="spin" />
          读取设置…
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div className="panel-title">设置</div>
        <div className="toolbar-actions">
          <button className="mini-btn primary" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 size={12} className="spin" /> : <Save size={12} />} 保存
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">AI 平台</div>
        <select
          className="settings-input"
          value={draft.ai.activeId}
          onChange={(event) =>
            setDraft({ ...draft, ai: { ...draft.ai, activeId: event.target.value } })
          }
        >
          {draft.ai.platforms.map((platform) => (
            <option key={platform.id} value={platform.id}>
              {platform.name}
            </option>
          ))}
        </select>

        <div className="settings-label">Base URL</div>
        <input
          className="settings-input"
          value={active.baseUrl}
          spellCheck={false}
          onChange={(event) => updatePlatform({ baseUrl: event.target.value })}
        />

        <div className="settings-label">模型</div>
        <input
          className="settings-input"
          value={active.model}
          spellCheck={false}
          onChange={(event) => updatePlatform({ model: event.target.value })}
        />

        <div className="settings-label">API Key</div>
        <input
          className="settings-input"
          type="password"
          value={active.apiKey}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => updatePlatform({ apiKey: event.target.value })}
        />

        <button className="mini-btn" disabled={testing} onClick={() => void test()}>
          {testing ? <Loader2 size={12} className="spin" /> : <Wifi size={12} />} 测试连接
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-label">插件桥（外部浏览器推送）</div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.bridge.enabled}
            onChange={(event) =>
              setDraft({
                ...draft,
                bridge: { ...draft.bridge, enabled: event.target.checked }
              })
            }
          />
          启用本机接收
        </label>

        <div className="settings-label">端口</div>
        <input
          className="settings-input"
          type="number"
          value={draft.bridge.port}
          onChange={(event) =>
            setDraft({
              ...draft,
              bridge: { ...draft.bridge, port: Number(event.target.value) || 47821 }
            })
          }
        />

        <div className="settings-label">Token</div>
        <div className="settings-token">
          <code title={draft.bridge.token}>{draft.bridge.token || '保存后自动生成'}</code>
          <button
            className="mini-btn"
            disabled={!draft.bridge.token}
            onClick={() => void window.bsub.writeClipboard(draft.bridge.token)}
          >
            复制
          </button>
        </div>
        <div className="settings-hint">
          {bridge?.running
            ? `运行中 · 127.0.0.1:${bridge.port}`
            : bridge?.error
              ? `未启动：${bridge.error}`
              : '未启动'}
          {' · '}
          POST /v1/ingest
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">版本更新</div>
        <div className="settings-row">
          <span>当前版本</span>
          <code>v{version}</code>
        </div>
        <div className="update-state">{updateText(updateState)}</div>
        {updateState?.state === 'downloading' && (
          <div className="update-progress">
            <span style={{ width: `${updateState.progress || 0}%` }} />
          </div>
        )}
        {(updateState?.state === 'available' || updateState?.state === 'downloaded') &&
          updateState?.notes && <pre className="update-notes">{updateState.notes}</pre>}

        <div className="toolbar-actions">
          <button
            className="mini-btn"
            disabled={
              !updateState ||
              updateState.state === 'checking' ||
              updateState.state === 'downloading' ||
              updateState.state === 'disabled'
            }
            onClick={() => void window.bsub.checkForUpdates()}
          >
            <RefreshCw size={12} /> 检查
          </button>
          {updateState?.state === 'available' && (
            <button className="mini-btn primary" onClick={() => void window.bsub.downloadUpdate()}>
              <Download size={12} /> 下载
            </button>
          )}
          {updateState?.state === 'downloaded' && (
            <button className="mini-btn primary" onClick={() => void window.bsub.installUpdate()}>
              重启安装
            </button>
          )}
        </div>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.update.autoCheck !== false}
            onChange={(event) =>
              setDraft({
                ...draft,
                update: { ...draft.update, autoCheck: event.target.checked }
              })
            }
          />
          启动后自动检查
        </label>

        <div className="settings-label">自定义更新源（可选）</div>
        <input
          className="settings-input"
          value={draft.update.feedUrl || ''}
          spellCheck={false}
          placeholder="留空使用内置 GitHub Releases"
          onChange={(event) =>
            setDraft({
              ...draft,
              update: { ...draft.update, feedUrl: event.target.value }
            })
          }
        />
        <div className="settings-hint">
          自动检查与更新源修改后下次启动生效；未签名时 SmartScreen 仍会提示。
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">总结提示词</div>
        <textarea
          className="settings-textarea"
          rows={7}
          value={draft.prompt.summary}
          onChange={(event) =>
            setDraft({ ...draft, prompt: { ...draft.prompt, summary: event.target.value } })
          }
        />
      </div>

      <div className="settings-section">
        <div className="settings-label">数据目录</div>
        <div className="settings-path" title={dataDir}>
          {dataDir}
        </div>
        <button className="mini-btn" onClick={() => void window.bsub.openDataDir()}>
          <FolderOpen size={12} /> 打开目录
        </button>
      </div>

      {message && <div className="settings-message ok">{message}</div>}
      {error && <div className="settings-message error">{error}</div>}

      <div className="panel-foot">
        <span>Key 只保存在本机 settings.json</span>
        <span>v{version}</span>
      </div>
    </div>
  );
}
