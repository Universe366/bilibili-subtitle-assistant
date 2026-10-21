import { useEffect, useState } from 'react';
import {
  Download,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  Wifi
} from 'lucide-react';
import type {
  AiPlatform,
  AppSettings,
  BridgeStatus,
  CorrectionRule,
  CorrectionRuleGroup,
  ExportFormat,
  GlossaryTerm,
  PromptTemplate,
  SearchProvider,
  SearchTimeRange,
  ThemeMode,
  UpdateStatus,
  WebReference
} from '../../../shared/types';

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

const EXPORT_LABELS: Record<ExportFormat, string> = {
  md: 'Markdown',
  srt: 'SRT 字幕',
  txt: '纯文本',
  json: 'JSON'
};

export function SettingsPanel() {
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [dataDir, setDataDir] = useState('');
  const [version, setVersion] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [searchTesting, setSearchTesting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('B站 视频 总结');
  const [searchResults, setSearchResults] = useState<WebReference[] | null>(null);
  const [correctionTest, setCorrectionTest] = useState('这是一段测试字幕，AI 和 GPU 可能会被写错。');
  const [correctionPreview, setCorrectionPreview] = useState('');
  const [correctionTesting, setCorrectionTesting] = useState(false);
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
  const activeTemplate = draft
    ? draft.prompt.templates.find((template) => template.id === draft.prompt.activeId) ||
      draft.prompt.templates[0] ||
      null
    : null;

  const updateGeneral = (patch: Partial<AppSettings['general']>) => {
    if (!draft) return;
    setDraft({ ...draft, general: { ...draft.general, ...patch } });
  };

  const updateAi = (patch: Partial<AppSettings['ai']>) => {
    if (!draft) return;
    setDraft({ ...draft, ai: { ...draft.ai, ...patch } });
  };

  const updateSearch = (patch: Partial<AppSettings['search']>) => {
    if (!draft) return;
    setDraft({ ...draft, search: { ...draft.search, ...patch } });
  };

  const uid = (prefix: string) =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const updateCorrection = (patch: Partial<AppSettings['correction']>) => {
    if (!draft) return;
    setDraft({ ...draft, correction: { ...draft.correction, ...patch } });
  };

  const updateGroup = (id: string, patch: Partial<CorrectionRuleGroup>) => {
    if (!draft) return;
    updateCorrection({
      groups: draft.correction.groups.map((group) =>
        group.id === id ? { ...group, ...patch } : group
      )
    });
  };

  const addGroup = () => {
    if (!draft) return;
    const group: CorrectionRuleGroup = {
      id: uid('group'),
      name: '新规则组',
      enabled: true,
      rules: []
    };
    updateCorrection({ groups: [...draft.correction.groups, group] });
  };

  const removeGroup = (id: string) => {
    if (!draft) return;
    updateCorrection({ groups: draft.correction.groups.filter((group) => group.id !== id) });
  };

  const updateRule = (groupId: string, ruleId: string, patch: Partial<CorrectionRule>) => {
    if (!draft) return;
    updateCorrection({
      groups: draft.correction.groups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              rules: group.rules.map((rule) =>
                rule.id === ruleId ? { ...rule, ...patch } : rule
              )
            }
          : group
      )
    });
  };

  const addRule = (groupId: string) => {
    if (!draft) return;
    const group = draft.correction.groups.find((item) => item.id === groupId);
    if (!group) return;
    const rule: CorrectionRule = {
      id: uid('rule'),
      pattern: '',
      replacement: '',
      regex: false,
      caseSensitive: false
    };
    updateGroup(groupId, { rules: [...group.rules, rule] });
  };

  const removeRule = (groupId: string, ruleId: string) => {
    if (!draft) return;
    const group = draft.correction.groups.find((item) => item.id === groupId);
    if (!group) return;
    updateGroup(groupId, { rules: group.rules.filter((rule) => rule.id !== ruleId) });
  };

  const updateGlossary = (patch: Partial<AppSettings['correction']['glossary']>) => {
    if (!draft) return;
    updateCorrection({ glossary: { ...draft.correction.glossary, ...patch } });
  };

  const addTerm = () => {
    if (!draft) return;
    const term: GlossaryTerm = { id: uid('term'), from: '', to: '', note: '' };
    updateGlossary({ terms: [...draft.correction.glossary.terms, term] });
  };

  const updateTerm = (id: string, patch: Partial<GlossaryTerm>) => {
    if (!draft) return;
    updateGlossary({
      terms: draft.correction.glossary.terms.map((term) =>
        term.id === id ? { ...term, ...patch } : term
      )
    });
  };

  const removeTerm = (id: string) => {
    if (!draft) return;
    updateGlossary({
      terms: draft.correction.glossary.terms.filter((term) => term.id !== id)
    });
  };

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

  const addPlatform = () => {
    if (!draft) return;
    const id = `custom-${Date.now().toString(36)}`;
    const platform: AiPlatform = {
      id,
      name: '自定义平台',
      baseUrl: '',
      apiKey: '',
      model: ''
    };
    setDraft({
      ...draft,
      ai: { ...draft.ai, activeId: id, platforms: [...draft.ai.platforms, platform] }
    });
  };

  const removePlatform = () => {
    if (!draft || !active || draft.ai.platforms.length <= 1) return;
    const platforms = draft.ai.platforms.filter((platform) => platform.id !== active.id);
    setDraft({
      ...draft,
      ai: { ...draft.ai, activeId: platforms[0].id, platforms }
    });
  };

  const updateTemplate = (patch: Partial<PromptTemplate>) => {
    if (!draft || !activeTemplate) return;
    setDraft({
      ...draft,
      prompt: {
        ...draft.prompt,
        templates: draft.prompt.templates.map((template) =>
          template.id === activeTemplate.id ? { ...template, ...patch } : template
        )
      }
    });
  };

  const addTemplate = () => {
    if (!draft) return;
    const id = `tpl-${Date.now().toString(36)}`;
    const template: PromptTemplate = { id, name: '新模板', text: '' };
    setDraft({
      ...draft,
      prompt: {
        ...draft.prompt,
        activeId: id,
        templates: [...draft.prompt.templates, template]
      }
    });
  };

  const removeTemplate = () => {
    if (!draft || !activeTemplate || draft.prompt.templates.length <= 1) return;
    const templates = draft.prompt.templates.filter((template) => template.id !== activeTemplate.id);
    setDraft({
      ...draft,
      prompt: { ...draft.prompt, activeId: templates[0].id, templates }
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

  const testSearch = async () => {
    setSearchTesting(true);
    setMessage('');
    setError('');
    setSearchResults(null);
    try {
      const response = await window.bsub.testSearch(searchQuery);
      if (response.ok) {
        setSearchResults(response.data);
        setMessage(
          response.data.length
            ? `检索到 ${response.data.length} 条参考资料`
            : '没有检索到结果'
        );
      } else {
        setError(response.error);
      }
    } finally {
      setSearchTesting(false);
    }
  };

  const previewCorrection = async () => {
    if (!draft) return;
    setCorrectionTesting(true);
    setError('');
    try {
      const response = await window.bsub.previewCorrection(correctionTest, draft);
      if (response.ok) setCorrectionPreview(response.data);
      else setError(response.error);
    } finally {
      setCorrectionTesting(false);
    }
  };

  const exportSettings = async () => {
    setMessage('');
    setError('');
    const response = await window.bsub.exportSettings();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setMessage(response.data.canceled ? '已取消' : `已导出到 ${response.data.path}`);
  };

  const importSettings = async () => {
    if (!window.confirm('导入会覆盖当前设置（含 API Key 和插件桥 Token），继续？')) return;
    setMessage('');
    setError('');
    const response = await window.bsub.importSettings();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (response.data.canceled || !response.data.snapshot) {
      setMessage('已取消');
      return;
    }
    setDraft(response.data.snapshot.settings);
    setDataDir(response.data.snapshot.dataDir);
    setVersion(response.data.snapshot.version);
    setMessage('设置已导入');
    const status = await window.bsub.getBridgeStatus();
    if (status.ok) setBridge(status.data);
  };

  if (!draft || !active || !activeTemplate) {
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
    <div className="panel settings-panel">
      <div className="panel-toolbar">
        <div className="panel-title">设置</div>
        <div className="toolbar-actions">
          <button className="mini-btn primary" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 size={12} className="spin" /> : <Save size={12} />} 保存
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">通用</div>
        <div className="settings-label">主题</div>
        <select
          className="settings-input"
          value={draft.general.theme}
          onChange={(event) => updateGeneral({ theme: event.target.value as ThemeMode })}
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.general.closeToTray !== false}
            onChange={(event) => updateGeneral({ closeToTray: event.target.checked })}
          />
          关闭窗口时缩到托盘
        </label>

        <div className="settings-label">后台标签休眠（分钟）</div>
        <input
          className="settings-input"
          type="number"
          min={1}
          max={120}
          value={draft.general.suspendMinutes}
          onChange={(event) =>
            updateGeneral({ suspendMinutes: Number(event.target.value) || 5 })
          }
        />
        <div className="settings-hint">1–120 分钟；正在出声的标签不会被回收。</div>
      </div>

      <div className="settings-section">
        <div className="settings-label">AI 平台</div>
        <div className="settings-inline">
          <select
            className="settings-input"
            value={draft.ai.activeId}
            onChange={(event) => updateAi({ activeId: event.target.value })}
          >
            {draft.ai.platforms.map((platform) => (
              <option key={platform.id} value={platform.id}>
                {platform.name}
              </option>
            ))}
          </select>
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

        <button className="mini-btn" disabled={testing} onClick={() => void test()}>
          {testing ? <Loader2 size={12} className="spin" /> : <Wifi size={12} />} 测试连接
        </button>
        <div className="settings-hint">关闭流式后会等完整响应再显示。</div>
      </div>

      <div className="settings-section">
        <div className="settings-label">提示词模板</div>
        <div className="settings-inline">
          <select
            className="settings-input"
            value={draft.prompt.activeId}
            onChange={(event) => setDraft({ ...draft, prompt: { ...draft.prompt, activeId: event.target.value } })}
          >
            {draft.prompt.templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <button className="mini-btn" title="新增模板" onClick={addTemplate}>
            <Plus size={12} />
          </button>
          <button
            className="mini-btn"
            title="删除当前模板"
            disabled={draft.prompt.templates.length <= 1}
            onClick={removeTemplate}
          >
            <Trash2 size={12} />
          </button>
        </div>

        <div className="settings-label">模板名称</div>
        <input
          className="settings-input"
          value={activeTemplate.name}
          onChange={(event) => updateTemplate({ name: event.target.value })}
        />

        <textarea
          className="settings-textarea"
          rows={9}
          value={activeTemplate.text}
          onChange={(event) => updateTemplate({ text: event.target.value })}
        />

        <div className="settings-label">对话提示词</div>
        <textarea
          className="settings-textarea"
          rows={5}
          value={draft.prompt.chat}
          onChange={(event) =>
            setDraft({ ...draft, prompt: { ...draft.prompt, chat: event.target.value } })
          }
        />
      </div>

      <div className="settings-section">
        <div className="settings-label">联网检索</div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.search.enabled}
            onChange={(event) => updateSearch({ enabled: event.target.checked })}
          />
          总结时自动检索参考资料
        </label>

        <div className="settings-label">服务商</div>
        <select
          className="settings-input"
          value={draft.search.provider}
          onChange={(event) =>
            updateSearch({ provider: event.target.value as SearchProvider })
          }
        >
          <option value="exa">Exa（免 Key，推荐）</option>
          <option value="anysearch">AnySearch（免 Key）</option>
          <option value="tavily">Tavily（需 Key）</option>
          <option value="brave">Brave（需 Key）</option>
        </select>

        {(draft.search.provider === 'tavily' || draft.search.provider === 'brave') && (
          <>
            <div className="settings-label">检索 API Key</div>
            <input
              className="settings-input"
              type="password"
              value={draft.search.apiKey}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => updateSearch({ apiKey: event.target.value })}
            />
          </>
        )}

        <div className="settings-inline">
          <div className="settings-field">
            <div className="settings-label">结果数</div>
            <input
              className="settings-input"
              type="number"
              min={1}
              max={10}
              value={draft.search.maxResults}
              onChange={(event) => updateSearch({ maxResults: Number(event.target.value) || 5 })}
            />
          </div>
          <div className="settings-field">
            <div className="settings-label">时间范围</div>
            <select
              className="settings-input"
              value={draft.search.timeRange}
              onChange={(event) =>
                updateSearch({ timeRange: event.target.value as SearchTimeRange })
              }
            >
              <option value="any">不限</option>
              <option value="year">最近一年</option>
              <option value="month">最近一月</option>
              <option value="week">最近一周</option>
            </select>
          </div>
        </div>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.search.includeContent}
            onChange={(event) => updateSearch({ includeContent: event.target.checked })}
          />
          包含网页正文（Tavily）
        </label>

        <div className="settings-inline">
          <input
            className="settings-input"
            value={searchQuery}
            spellCheck={false}
            placeholder="测试查询"
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <button className="mini-btn" disabled={searchTesting} onClick={() => void testSearch()}>
            {searchTesting ? <Loader2 size={12} className="spin" /> : <Search size={12} />} 测试检索
          </button>
        </div>
        {searchResults && (
          <div className="settings-hint">
            找到 {searchResults.length} 条：
            {searchResults
              .slice(0, 3)
              .map((item) => item.title)
              .join(' / ')}
          </div>
        )}
        <div className="settings-hint">
          免 Key 引擎可能被限流；失败会自动换另一个免 Key 引擎。检索结果只作为总结参考。
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">字幕校对与术语表</div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.correction.enabled}
            onChange={(event) => updateCorrection({ enabled: event.target.checked })}
          />
          读取字幕 / 入库时应用规则
        </label>

        <div className="settings-inline">
          <span className="settings-label" style={{ flex: 1 }}>
            规则组
          </span>
          <button className="mini-btn" onClick={addGroup}>
            <Plus size={12} /> 规则组
          </button>
        </div>

        {draft.correction.groups.map((group) => (
          <div key={group.id} className="correction-group">
            <div className="settings-inline">
              <input
                className="settings-input"
                value={group.name}
                onChange={(event) => updateGroup(group.id, { name: event.target.value })}
              />
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={group.enabled}
                  onChange={(event) => updateGroup(group.id, { enabled: event.target.checked })}
                />
                启用
              </label>
              <button
                className="mini-btn"
                title="删除规则组"
                onClick={() => removeGroup(group.id)}
              >
                <Trash2 size={12} />
              </button>
            </div>

            {group.rules.map((rule) => (
              <div key={rule.id} className="correction-rule">
                <input
                  className="settings-input"
                  placeholder="匹配内容"
                  value={rule.pattern}
                  spellCheck={false}
                  onChange={(event) =>
                    updateRule(group.id, rule.id, { pattern: event.target.value })
                  }
                />
                <input
                  className="settings-input"
                  placeholder="替换为"
                  value={rule.replacement}
                  spellCheck={false}
                  onChange={(event) =>
                    updateRule(group.id, rule.id, { replacement: event.target.value })
                  }
                />
                <div className="settings-inline">
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={rule.regex}
                      onChange={(event) =>
                        updateRule(group.id, rule.id, { regex: event.target.checked })
                      }
                    />
                    正则
                  </label>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={rule.caseSensitive}
                      onChange={(event) =>
                        updateRule(group.id, rule.id, { caseSensitive: event.target.checked })
                      }
                    />
                    区分大小写
                  </label>
                  <button
                    className="mini-btn"
                    title="删除规则"
                    onClick={() => removeRule(group.id, rule.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}

            <button className="mini-btn" onClick={() => addRule(group.id)}>
              <Plus size={12} /> 规则
            </button>
          </div>
        ))}

        <div className="settings-label">术语表</div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.correction.glossary.enabled}
            onChange={(event) => updateGlossary({ enabled: event.target.checked })}
          />
          启用术语替换，并注入总结提示词
        </label>

        {draft.correction.glossary.terms.map((term) => (
          <div key={term.id} className="correction-term">
            <div className="settings-inline">
              <input
                className="settings-input"
                placeholder="原词"
                value={term.from}
                spellCheck={false}
                onChange={(event) => updateTerm(term.id, { from: event.target.value })}
              />
              <span className="settings-arrow">→</span>
              <input
                className="settings-input"
                placeholder="统一写法"
                value={term.to}
                spellCheck={false}
                onChange={(event) => updateTerm(term.id, { to: event.target.value })}
              />
              <button className="mini-btn" title="删除术语" onClick={() => removeTerm(term.id)}>
                <Trash2 size={12} />
              </button>
            </div>
            <input
              className="settings-input"
              placeholder="备注（可选）"
              value={term.note}
              onChange={(event) => updateTerm(term.id, { note: event.target.value })}
            />
          </div>
        ))}

        <button className="mini-btn" onClick={addTerm}>
          <Plus size={12} /> 术语
        </button>

        <div className="settings-label">预览</div>
        <input
          className="settings-input"
          value={correctionTest}
          spellCheck={false}
          onChange={(event) => setCorrectionTest(event.target.value)}
        />
        <button className="mini-btn" disabled={correctionTesting} onClick={() => void previewCorrection()}>
          {correctionTesting ? <Loader2 size={12} className="spin" /> : <Search size={12} />} 预览结果
        </button>
        {correctionPreview && <pre className="correction-preview">{correctionPreview}</pre>}
        <div className="settings-hint">
          规则按组顺序执行，术语替换在规则之后；非法正则自动跳过。
        </div>
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
        <div className="settings-label">导出默认值</div>
        <div className="settings-label">默认格式</div>
        <select
          className="settings-input"
          value={draft.export.format}
          onChange={(event) =>
            setDraft({
              ...draft,
              export: { ...draft.export, format: event.target.value as ExportFormat }
            })
          }
        >
          {(Object.keys(EXPORT_LABELS) as ExportFormat[]).map((format) => (
            <option key={format} value={format}>
              {EXPORT_LABELS[format]}
            </option>
          ))}
        </select>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.export.includeTimestamps !== false}
            onChange={(event) =>
              setDraft({
                ...draft,
                export: { ...draft.export, includeTimestamps: event.target.checked }
              })
            }
          />
          Markdown / TXT 保留时间戳
        </label>

        <div className="settings-label">文件名模板</div>
        <input
          className="settings-input"
          value={draft.export.filenamePattern}
          spellCheck={false}
          placeholder="{title}-{bvid}"
          onChange={(event) =>
            setDraft({
              ...draft,
              export: { ...draft.export, filenamePattern: event.target.value }
            })
          }
        />
        <div className="settings-hint">可用变量：{'{title}'}、{'{bvid}'}、{'{date}'}。</div>
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
        <div className="settings-label">数据与备份</div>
        <div className="settings-row">
          <span>数据目录</span>
        </div>
        <div className="settings-path" title={dataDir}>
          {dataDir}
        </div>
        <div className="settings-row">
          <span>数据库</span>
          <code>{dataDir}\library.db</code>
        </div>
        <div className="settings-inline">
          <button className="mini-btn" onClick={() => void window.bsub.openDataDir()}>
            <FolderOpen size={12} /> 打开目录
          </button>
          <button className="mini-btn" onClick={() => void exportSettings()}>
            <Download size={12} /> 导出设置
          </button>
          <button className="mini-btn" onClick={() => void importSettings()}>
            <Upload size={12} /> 导入设置
          </button>
        </div>
        <div className="settings-hint">
          导出文件包含 API Key 与桥 Token；日志在数据目录的 startup.log / fatal.log。
        </div>
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
