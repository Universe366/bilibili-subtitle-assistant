import { Loader2, Plus, RefreshCw, Trash2, Wifi } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AiPlatform, AppSettings } from '../../../../shared/types';
import { ModelChips, SettingsSection } from './SettingsSection';

interface AiSectionProps {
  draft: AppSettings;
  active: AiPlatform | null;
  updateAi: (patch: Partial<AppSettings['ai']>) => void;
  updatePlatform: (patch: Partial<AiPlatform>) => void;
  addPlatform: () => void;
  removePlatform: () => void;
  testConnection: (kind: 'ai' | 'asr' | 'search') => void;
  probeModels: (kind: 'ai' | 'asr') => void;
  platformBusy: string;
  modelCache: Record<string, string[]>;
  showKey: Record<string, boolean>;
  setShowKey: (updater: (previous: Record<string, boolean>) => Record<string, boolean>) => void;
  setEditingAiId: (id: string) => void;
  platformStatus: (kind: 'ai' | 'asr' | 'search') => ReactNode;
  testing: boolean;
  onTest: () => void;
}

/** AI 平台：平台选择、Base URL/模型/Key、连通性与模型探测、生成参数。 */
export function AiSection({
  draft,
  active,
  updateAi,
  updatePlatform,
  addPlatform,
  removePlatform,
  testConnection,
  probeModels,
  platformBusy,
  modelCache,
  showKey,
  setShowKey,
  setEditingAiId,
  platformStatus,
  testing,
  onTest
}: AiSectionProps) {
  if (!active) return null;

  return (
<SettingsSection title="AI 平台" defaultOpen={true}>
  <div className="settings-inline">
    <select
      className="settings-input"
      value={active?.id || ''}
      onChange={(event) => setEditingAiId(event.target.value)}
    >
      {draft.ai.platforms.map((platform) => (
        <option key={platform.id} value={platform.id}>
          {platform.name}
          {platform.id === draft.ai.activeId ? '（使用中）' : ''}
          {!platform.apiKey ? ' · 未配 Key' : ''}
        </option>
      ))}
    </select>
    {active && active.id !== draft.ai.activeId && (
      <button
        className="mini-btn primary"
        onClick={() => updateAi({ activeId: active.id })}
      >
        设为使用中
      </button>
    )}
    <button className="mini-btn" title="新增平台" onClick={addPlatform}>
      <Plus size={12} />
    </button>
    <button
      className="mini-btn"
      title="删除当前平台"
      disabled={draft.ai.platforms.length <= 1}
      onClick={removePlatform}
    >
      <Trash2 size={12} />
    </button>
  </div>

  <div className="settings-label">名称</div>
  <input
    className="settings-input"
    value={active.name}
    onChange={(event) => updatePlatform({ name: event.target.value })}
  />

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
    list={`ai-models-${active.id}`}
    value={active.model}
    spellCheck={false}
    onChange={(event) => updatePlatform({ model: event.target.value })}
  />
  <datalist id={`ai-models-${active.id}`}>
    {(modelCache[active.id] || active.models || []).map((model) => (
      <option key={model} value={model} />
    ))}
  </datalist>

  <div className="settings-inline">
    <button
      className="mini-btn"
      disabled={platformBusy === 'ai:test'}
      onClick={() => void testConnection('ai')}
    >
      {platformBusy === 'ai:test' ? <Loader2 size={12} className="spin" /> : <Wifi size={12} />}
      测试连接
    </button>
    <button
      className="mini-btn"
      disabled={platformBusy === 'ai:probe'}
      onClick={() => void probeModels('ai')}
    >
      {platformBusy === 'ai:probe' ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
      探测模型
    </button>
  </div>
  {platformStatus('ai')}
  <ModelChips
    key={active.id}
    models={modelCache[active.id] || active.models || []}
    current={active.model}
    probed={Boolean(modelCache[active.id])}
    onPick={(model) => updatePlatform({ model })}
  />
  {(active.homepage || active.keyUrl) && (
    <div className="settings-inline">
      {active.homepage && (
        <button className="mini-btn" onClick={() => void window.bsub.newTab(active.homepage!)}>
          官网
        </button>
      )}
      {active.keyUrl && (
        <button className="mini-btn" onClick={() => void window.bsub.newTab(active.keyUrl!)}>
          获取 Key
        </button>
      )}
    </div>
  )}

  <details className="settings-advanced">
    <summary>高级设置</summary>
    <div className="settings-label">官网地址</div>
    <input
      className="settings-input"
      value={active.homepage || ''}
      placeholder="https://"
      onChange={(event) => updatePlatform({ homepage: event.target.value })}
    />
    <div className="settings-label">申请 Key 链接</div>
    <input
      className="settings-input"
      value={active.keyUrl || ''}
      placeholder="https://"
      onChange={(event) => updatePlatform({ keyUrl: event.target.value })}
    />
  </details>

  <div className="settings-label">API Key</div>
  <div className="settings-inline">
    <input
      className="settings-input"
      type={showKey[active.id] ? 'text' : 'password'}
      value={active.apiKey === '__CLEAR__' ? '' : active.apiKey}
      placeholder="留空保存不改动"
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => updatePlatform({ apiKey: event.target.value })}
    />
    <button
      className="mini-btn"
      onClick={() =>
        setShowKey((previous) => ({ ...previous, [active.id]: !previous[active.id] }))
      }
    >
      {showKey[active.id] ? '隐藏' : '显示'}
    </button>
    <button
      className="mini-btn"
      onClick={() => updatePlatform({ apiKey: '__CLEAR__' })}
    >
      清除
    </button>
  </div>

  <div className="settings-inline">
    <div className="settings-field">
      <div className="settings-label">温度（0–2）</div>
      <input
        className="settings-input"
        type="number"
        min={0}
        max={2}
        step={0.1}
        value={draft.ai.temperature}
        onChange={(event) => updateAi({ temperature: Number(event.target.value) })}
      />
    </div>
    <div className="settings-field">
      <div className="settings-label">最大 token</div>
      <input
        className="settings-input"
        type="number"
        min={256}
        max={64000}
        step={256}
        value={draft.ai.maxTokens}
        onChange={(event) => updateAi({ maxTokens: Number(event.target.value) })}
      />
    </div>
  </div>

  <label className="settings-check">
    <input
      type="checkbox"
      checked={draft.ai.stream !== false}
      onChange={(event) => updateAi({ stream: event.target.checked })}
    />
    流式输出
  </label>

  <label className="settings-check">
    <input
      type="checkbox"
      checked={draft.ai.preProofread === true}
      onChange={(event) => updateAi({ preProofread: event.target.checked })}
    />
    总结前先 AI 校对字幕（更慢，消耗额度）
  </label>

  <label className="settings-check">
    <input
      type="checkbox"
      checked={draft.ai.sendOnEnter !== false}
      onChange={(event) => updateAi({ sendOnEnter: event.target.checked })}
    />
    回车发送消息（关闭后改为 Ctrl / Cmd + 回车）
  </label>

  <label className="settings-check">
    <input
      type="checkbox"
      checked={draft.ai.expandReasoning === true}
      onChange={(event) => updateAi({ expandReasoning: event.target.checked })}
    />
    思维链默认展开（推理模型会显示思考过程）
  </label>

  <label className="settings-check">
    <input
      type="checkbox"
      checked={draft.ai.appTools !== false}
      onChange={(event) => updateAi({ appTools: event.target.checked })}
    />
    允许 AI 查询本地库（只读：搜字幕、读总结和笔记）
  </label>

  <button className="mini-btn" disabled={testing} onClick={onTest}>
    {testing ? <Loader2 size={12} className="spin" /> : <Wifi size={12} />} 测试连接
  </button>
  <div className="settings-hint">关闭流式后会等完整响应再显示。</div>
</SettingsSection>
  );
}
