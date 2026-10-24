import { Loader2, Plus, RefreshCw, Trash2, Wifi } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AppSettings, AsrPlatform } from '../../../../shared/types';
import { ModelChips, SettingsSection } from './SettingsSection';

interface AsrSectionProps {
  draft: AppSettings;
  activeAsr: AsrPlatform | null;
  updateAsr: (patch: Partial<AppSettings['asr']>) => void;
  updateAsrPlatform: (patch: Partial<AsrPlatform>) => void;
  addAsrPlatform: () => void;
  removeAsrPlatform: () => void;
  testConnection: (kind: 'ai' | 'asr' | 'search') => void;
  probeModels: (kind: 'ai' | 'asr') => void;
  platformBusy: string;
  modelCache: Record<string, string[]>;
  showKey: Record<string, boolean>;
  setShowKey: (updater: (previous: Record<string, boolean>) => Record<string, boolean>) => void;
  setEditingAsrId: (id: string) => void;
  platformStatus: (kind: 'ai' | 'asr' | 'search') => ReactNode;
}

/** 语音识别：平台/协议、Key、模型探测、切片与并发等转录参数。 */
export function AsrSection({
  draft,
  activeAsr,
  updateAsr,
  updateAsrPlatform,
  addAsrPlatform,
  removeAsrPlatform,
  testConnection,
  probeModels,
  platformBusy,
  modelCache,
  showKey,
  setShowKey,
  setEditingAsrId,
  platformStatus
}: AsrSectionProps) {
  if (!activeAsr) return null;

  return (
<SettingsSection title="语音识别（ASR）" defaultOpen={false}>
  <div className="settings-inline">
    <select
      className="settings-input"
      value={activeAsr?.id || ''}
      onChange={(event) => setEditingAsrId(event.target.value)}
    >
      {draft.asr.platforms.map((platform) => (
        <option key={platform.id} value={platform.id}>
          {platform.name}
          {platform.id === draft.asr.activeId ? '（使用中）' : ''}
          {!platform.apiKey ? ' · 未配 Key' : ''}
        </option>
      ))}
    </select>
    {activeAsr && activeAsr.id !== draft.asr.activeId && (
      <button
        className="mini-btn primary"
        onClick={() => updateAsr({ activeId: activeAsr.id })}
      >
        设为使用中
      </button>
    )}
    <button className="mini-btn" title="新增平台" onClick={addAsrPlatform}>
      <Plus size={12} />
    </button>
    <button
      className="mini-btn"
      title="删除当前平台"
      disabled={draft.asr.platforms.length <= 1}
      onClick={removeAsrPlatform}
    >
      <Trash2 size={12} />
    </button>
  </div>

  <div className="settings-label">名称</div>
  <input
    className="settings-input"
    value={activeAsr.name}
    onChange={(event) => updateAsrPlatform({ name: event.target.value })}
  />

  <div className="settings-label">Base URL</div>
  <input
    className="settings-input"
    value={activeAsr.baseUrl}
    spellCheck={false}
    onChange={(event) => updateAsrPlatform({ baseUrl: event.target.value })}
  />

  <div className="settings-label">模型</div>
  <input
    className="settings-input"
    list={`asr-models-${activeAsr.id}`}
    value={activeAsr.model}
    spellCheck={false}
    onChange={(event) => updateAsrPlatform({ model: event.target.value })}
  />
  <datalist id={`asr-models-${activeAsr.id}`}>
    {(modelCache[activeAsr.id] || activeAsr.models || []).map((model) => (
      <option key={model} value={model} />
    ))}
  </datalist>

  <div className="settings-inline">
    <button
      className="mini-btn"
      disabled={platformBusy === 'asr:test'}
      onClick={() => void testConnection('asr')}
    >
      {platformBusy === 'asr:test' ? <Loader2 size={12} className="spin" /> : <Wifi size={12} />}
      测试连接
    </button>
    <button
      className="mini-btn"
      disabled={platformBusy === 'asr:probe'}
      onClick={() => void probeModels('asr')}
    >
      {platformBusy === 'asr:probe' ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
      探测模型
    </button>
  </div>
  {platformStatus('asr')}
  <ModelChips
    key={activeAsr.id}
    models={modelCache[activeAsr.id] || activeAsr.models || []}
    current={activeAsr.model}
    probed={Boolean(modelCache[activeAsr.id])}
    onPick={(model) => updateAsrPlatform({ model })}
  />
  {(activeAsr.homepage || activeAsr.keyUrl) && (
    <div className="settings-inline">
      {activeAsr.homepage && (
        <button
          className="mini-btn"
          onClick={() => void window.bsub.newTab(activeAsr.homepage!)}
        >
          官网
        </button>
      )}
      {activeAsr.keyUrl && (
        <button
          className="mini-btn"
          onClick={() => void window.bsub.newTab(activeAsr.keyUrl!)}
        >
          获取 Key
        </button>
      )}
    </div>
  )}

  <div className="settings-label">API Key</div>
  <div className="settings-inline">
    <input
      className="settings-input"
      type={showKey[activeAsr.id] ? 'text' : 'password'}
      value={activeAsr.apiKey === '__CLEAR__' ? '' : activeAsr.apiKey}
      placeholder="留空保存不改动"
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => updateAsrPlatform({ apiKey: event.target.value })}
    />
    <button
      className="mini-btn"
      onClick={() =>
        setShowKey((previous) => ({ ...previous, [activeAsr.id]: !previous[activeAsr.id] }))
      }
    >
      {showKey[activeAsr.id] ? '隐藏' : '显示'}
    </button>
    <button
      className="mini-btn"
      onClick={() => updateAsrPlatform({ apiKey: '__CLEAR__' })}
    >
      清除
    </button>
  </div>

  <details className="settings-advanced">
    <summary>高级设置</summary>
    <div className="settings-label">请求方式</div>
    <select
      className="settings-input"
      value={activeAsr.transport || 'multipart'}
      onChange={(event) =>
        updateAsrPlatform({ transport: event.target.value as AsrPlatform['transport'] })
      }
    >
      <option value="multipart">multipart/form-data</option>
      <option value="base64-json">base64 JSON</option>
      <option value="chat-audio">chat/audio（input_audio）</option>
      <option value="auto">自动</option>
    </select>
    <div className="settings-label">音频字段名</div>
    <input
      className="settings-input"
      value={activeAsr.keyField || 'file'}
      onChange={(event) => updateAsrPlatform({ keyField: event.target.value })}
    />
    <div className="settings-label">上传音频格式</div>
    <select
      className="settings-input"
      value={activeAsr.audioFormat || 'auto'}
      onChange={(event) =>
        updateAsrPlatform({ audioFormat: event.target.value as AsrPlatform['audioFormat'] })
      }
    >
      <option value="auto">自动</option>
      <option value="wav">WAV</option>
      <option value="m4a">M4A</option>
    </select>
    <div className="settings-label">参数风格</div>
    <select
      className="settings-input"
      value={activeAsr.paramStyle || 'auto'}
      onChange={(event) =>
        updateAsrPlatform({ paramStyle: event.target.value as AsrPlatform['paramStyle'] })
      }
    >
      <option value="auto">自动</option>
      <option value="minimal">最小（file + model）</option>
      <option value="full">完整（response_format 等）</option>
    </select>
  </details>

  <div className="settings-inline">
    <div className="settings-field">
      <div className="settings-label">语言</div>
      <select
        className="settings-input"
        value={draft.asr.language}
        onChange={(event) => updateAsr({ language: event.target.value })}
      >
        <option value="auto">自动</option>
        <option value="zh">中文</option>
        <option value="en">英文</option>
        <option value="ja">日文</option>
      </select>
    </div>
    <div className="settings-field">
      <div className="settings-label">切片（秒）</div>
      <input
        className="settings-input"
        type="number"
        min={30}
        max={300}
        value={draft.asr.chunkSeconds}
        onChange={(event) => updateAsr({ chunkSeconds: Number(event.target.value) || 120 })}
      />
    </div>
  </div>

  <div className="settings-inline">
    <div className="settings-field">
      <div className="settings-label">音频格式</div>
      <select
        className="settings-input"
        value={draft.asr.audioFormat}
        onChange={(event) =>
          updateAsr({ audioFormat: event.target.value as AppSettings['asr']['audioFormat'] })
        }
      >
        <option value="auto">自动</option>
        <option value="m4a">M4A</option>
        <option value="wav">WAV</option>
      </select>
    </div>
    <div className="settings-field">
      <div className="settings-label">并发</div>
      <input
        className="settings-input"
        type="number"
        min={1}
        max={8}
        value={draft.asr.concurrency}
        onChange={(event) => updateAsr({ concurrency: Number(event.target.value) || 1 })}
      />
    </div>
  </div>

  <div className="settings-inline">
    <div className="settings-field">
      <div className="settings-label">单请求超时（秒）</div>
      <input
        className="settings-input"
        type="number"
        min={30}
        max={1800}
        value={draft.asr.timeoutSeconds}
        onChange={(event) => updateAsr({ timeoutSeconds: Number(event.target.value) || 120 })}
      />
    </div>
    <div className="settings-field">
      <div className="settings-label">单段上限（MB）</div>
      <input
        className="settings-input"
        type="number"
        min={1}
        max={100}
        value={draft.asr.maxFileMb}
        onChange={(event) => updateAsr({ maxFileMb: Number(event.target.value) || 20 })}
      />
    </div>
    <div className="settings-field">
      <div className="settings-label">重叠切片（秒）</div>
      <input
        className="settings-input"
        type="number"
        min={0}
        max={30}
        value={draft.asr.overlapSeconds}
        onChange={(event) => updateAsr({ overlapSeconds: Number(event.target.value) || 0 })}
      />
    </div>
  </div>

  <div className="settings-label">传输方式</div>
  <select
    className="settings-input"
    value={draft.asr.transport}
    onChange={(event) =>
      updateAsr({ transport: event.target.value as AppSettings['asr']['transport'] })
    }
  >
    <option value="auto">自动（失败自动换一种）</option>
    <option value="multipart">multipart /audio/transcriptions</option>
    <option value="base64-json">base64 JSON</option>
    <option value="chat-audio">chat + input_audio</option>
  </select>
  <div className="settings-hint">
    SenseVoice 只吃 M4A；带时间戳的中文模型通常只吃 WAV。格式选「自动」会按模型判断。
  </div>
</SettingsSection>
  );
}
