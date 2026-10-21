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
  AsrPlatform,
  AppSettings,
  BridgeStatus,
  CorrectionRule,
  CorrectionRuleGroup,
  ExportFormat,
  GlossaryTerm,
  McpServer,
  McpTool,
  SkillItem,
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
  vtt: 'WebVTT',
  ass: 'ASS 字幕',
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
  const [mcpTools, setMcpTools] = useState<Record<string, McpTool[]>>({});
  const [mcpTesting, setMcpTesting] = useState('');
  const [mcpArgs, setMcpArgs] = useState('{}');
  const [mcpResult, setMcpResult] = useState('');
  const [settingsQuery, setSettingsQuery] = useState('');
  const [visibleSections, setVisibleSections] = useState(0);
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

  useEffect(() => {
    const query = settingsQuery.trim().toLowerCase();
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('.settings-section')
    );
    let count = 0;
    for (const section of sections) {
      const match =
        !query || (section.textContent || '').toLowerCase().includes(query);
      section.style.display = match ? '' : 'none';
      if (match) count += 1;
    }
    setVisibleSections(count);
  }, [settingsQuery, draft]);

  const active = draft
    ? draft.ai.platforms.find((platform) => platform.id === draft.ai.activeId) || draft.ai.platforms[0]
    : null;
  const activeTemplate = draft
    ? draft.prompt.templates.find((template) => template.id === draft.prompt.activeId) ||
      draft.prompt.templates[0] ||
      null
    : null;
  const activeAsr = draft
    ? draft.asr.platforms.find((platform) => platform.id === draft.asr.activeId) ||
      draft.asr.platforms[0] ||
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

  const updateMcp = (patch: Partial<AppSettings['mcp']>) => {
    if (!draft) return;
    setDraft({ ...draft, mcp: { ...draft.mcp, ...patch } });
  };

  const updateMcpServer = (id: string, patch: Partial<McpServer>) => {
    if (!draft) return;
    updateMcp({
      servers: draft.mcp.servers.map((server) =>
        server.id === id ? { ...server, ...patch } : server
      )
    });
  };

  const addMcpServer = () => {
    if (!draft) return;
    updateMcp({
      servers: [
        ...draft.mcp.servers,
        {
          id: uid('mcp'),
          name: 'MCP 服务',
          url: '',
          token: '',
          headers: {},
          enabled: true,
          transport: 'http'
        }
      ]
    });
  };

  const removeMcpServer = (id: string) => {
    if (!draft) return;
    updateMcp({ servers: draft.mcp.servers.filter((server) => server.id !== id) });
    setMcpTools((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };

  const testMcp = async (server: McpServer) => {
    setMcpTesting(server.id);
    setMcpResult('');
    try {
      const response = await window.bsub.testMcp(server);
      if (response.ok) {
        setMcpTools((previous) => ({ ...previous, [server.id]: response.data }));
        setMessage(`MCP 连接成功，${response.data.length} 个工具`);
      } else {
        setError(response.error);
      }
    } finally {
      setMcpTesting('');
    }
  };

  const callMcp = async (server: McpServer, tool: McpTool) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(mcpArgs || '{}');
    } catch {
      setError('MCP 参数不是合法 JSON');
      return;
    }
    setMcpResult(`调用 ${tool.name}…`);
    const response = await window.bsub.callMcp(server, tool.name, args);
    setMcpResult(response.ok ? response.data : `调用失败：${response.error}`);
  };

  const updateSkills = (patch: Partial<AppSettings['skills']>) => {
    if (!draft) return;
    setDraft({ ...draft, skills: { ...draft.skills, ...patch } });
  };

  const updateSkill = (id: string, patch: Partial<SkillItem>) => {
    if (!draft) return;
    updateSkills({
      items: draft.skills.items.map((item) => (item.id === id ? { ...item, ...patch } : item))
    });
  };

  const addSkill = () => {
    if (!draft) return;
    updateSkills({
      items: [
        ...draft.skills.items,
        {
          id: uid('skill'),
          name: '新技能',
          description: '',
          body: '',
          enabled: true,
          source: 'manual'
        }
      ]
    });
  };

  const removeSkill = (id: string) => {
    if (!draft) return;
    updateSkills({ items: draft.skills.items.filter((item) => item.id !== id) });
  };

  const importSkill = async () => {
    if (!draft) return;
    const response = await window.bsub.importSkill();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (response.data) {
      updateSkills({ items: [...draft.skills.items, response.data] });
      setMessage(`已导入技能：${response.data.name}`);
    }
  };

  const updateSearch = (patch: Partial<AppSettings['search']>) => {
    if (!draft) return;
    setDraft({ ...draft, search: { ...draft.search, ...patch } });
  };

  const uid = (prefix: string) =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const updateAsr = (patch: Partial<AppSettings['asr']>) => {
    if (!draft) return;
    setDraft({ ...draft, asr: { ...draft.asr, ...patch } });
  };

  const updateAsrPlatform = (patch: Partial<AsrPlatform>) => {
    if (!draft || !activeAsr) return;
    setDraft({
      ...draft,
      asr: {
        ...draft.asr,
        platforms: draft.asr.platforms.map((platform) =>
          platform.id === activeAsr.id ? { ...platform, ...patch } : platform
        )
      }
    });
  };

  const addAsrPlatform = () => {
    if (!draft) return;
    const id = uid('asr');
    setDraft({
      ...draft,
      asr: {
        ...draft.asr,
        activeId: id,
        platforms: [
          ...draft.asr.platforms,
          { id, name: '自定义语音识别', baseUrl: '', apiKey: '', model: '' }
        ]
      }
    });
  };

  const removeAsrPlatform = () => {
    if (!draft || !activeAsr || draft.asr.platforms.length <= 1) return;
    const platforms = draft.asr.platforms.filter((platform) => platform.id !== activeAsr.id);
    setDraft({ ...draft, asr: { ...draft.asr, activeId: platforms[0].id, platforms } });
  };

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

  if (!draft || !active || !activeTemplate || !activeAsr) {
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

      <input
        className="settings-input settings-search"
        placeholder="搜索设置（Key / 导出 / 超时…）"
        value={settingsQuery}
        spellCheck={false}
        onChange={(event) => setSettingsQuery(event.target.value)}
      />
      {settingsQuery && (
        <div className="settings-hint">匹配 {visibleSections} 个分组</div>
      )}

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

        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.general.cacheSubtitles !== false}
            onChange={(event) => updateGeneral({ cacheSubtitles: event.target.checked })}
          />
          缓存字幕正文（30 分钟，最多 100 条）
        </label>

        <div className="settings-label">
          界面字号（{Math.round((draft.general.fontScale || 1) * 100)}%）
        </div>
        <input
          className="settings-range"
          type="range"
          min={0.8}
          max={1.6}
          step={0.05}
          value={draft.general.fontScale || 1}
          onChange={(event) => updateGeneral({ fontScale: Number(event.target.value) })}
        />

        <div className="settings-label">侧栏宽度</div>
        <select
          className="settings-input"
          value={draft.general.sidebarWidth || 320}
          onChange={(event) => updateGeneral({ sidebarWidth: Number(event.target.value) })}
        >
          <option value={280}>窄（280px）</option>
          <option value={320}>标准（320px）</option>
          <option value={400}>宽（400px）</option>
          <option value={480}>超宽（480px）</option>
        </select>

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
        <div className="settings-inline">
          <input
            className="settings-input"
            type="password"
            value={active.apiKey === '__CLEAR__' ? '' : active.apiKey}
            placeholder="留空保存不改动"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => updatePlatform({ apiKey: event.target.value })}
          />
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

        <button className="mini-btn" disabled={testing} onClick={() => void test()}>
          {testing ? <Loader2 size={12} className="spin" /> : <Wifi size={12} />} 测试连接
        </button>
        <div className="settings-hint">关闭流式后会等完整响应再显示。</div>
      </div>

      <div className="settings-section">
        <div className="settings-label">语音识别（ASR）</div>
        <div className="settings-inline">
          <select
            className="settings-input"
            value={draft.asr.activeId}
            onChange={(event) => updateAsr({ activeId: event.target.value })}
          >
            {draft.asr.platforms.map((platform) => (
              <option key={platform.id} value={platform.id}>
                {platform.name}
              </option>
            ))}
          </select>
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
          value={activeAsr.model}
          spellCheck={false}
          onChange={(event) => updateAsrPlatform({ model: event.target.value })}
        />

        <div className="settings-label">API Key</div>
        <div className="settings-inline">
          <input
            className="settings-input"
            type="password"
            value={activeAsr.apiKey === '__CLEAR__' ? '' : activeAsr.apiKey}
            placeholder="留空保存不改动"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => updateAsrPlatform({ apiKey: event.target.value })}
          />
          <button
            className="mini-btn"
            onClick={() => updateAsrPlatform({ apiKey: '__CLEAR__' })}
          >
            清除
          </button>
        </div>

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
              max={3}
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
              max={600}
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
              max={15}
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

        <div className="settings-label">翻译提示词</div>
        <textarea
          className="settings-textarea"
          rows={6}
          value={draft.prompt.translate}
          onChange={(event) =>
            setDraft({ ...draft, prompt: { ...draft.prompt, translate: event.target.value } })
          }
        />

        <div className="settings-label">AI 优化提示词</div>
        <textarea
          className="settings-textarea"
          rows={6}
          value={draft.prompt.optimize}
          onChange={(event) =>
            setDraft({ ...draft, prompt: { ...draft.prompt, optimize: event.target.value } })
          }
        />

        <div className="settings-label">章节提示词</div>
        <textarea
          className="settings-textarea"
          rows={5}
          value={draft.prompt.chapters}
          onChange={(event) =>
            setDraft({ ...draft, prompt: { ...draft.prompt, chapters: event.target.value } })
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
          <option value="bocha">博查 Bocha（需 Key）</option>
          <option value="serper">Serper Google（需 Key）</option>
        </select>

        {['tavily', 'brave', 'bocha', 'serper'].includes(draft.search.provider) && (
          <>
            <div className="settings-label">检索 API Key</div>
            <div className="settings-inline">
              <input
                className="settings-input"
                type="password"
                value={draft.search.apiKey === '__CLEAR__' ? '' : draft.search.apiKey}
                placeholder="留空保存不改动"
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => updateSearch({ apiKey: event.target.value })}
              />
              <button
                className="mini-btn"
                onClick={() => updateSearch({ apiKey: '__CLEAR__' })}
              >
                清除
              </button>
            </div>
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

        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.search.verify}
            onChange={(event) => updateSearch({ verify: event.target.checked })}
          />
          AI 优化时联网核对改动（较慢，消耗检索与 AI 额度）
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

        <div className="settings-label">Markdown 模板</div>
        <select
          className="settings-input"
          value={draft.export.template}
          onChange={(event) =>
            setDraft({
              ...draft,
              export: { ...draft.export, template: event.target.value as AppSettings['export']['template'] }
            })
          }
        >
          <option value="timestamped">带时间戳</option>
          <option value="plain">纯内容</option>
          <option value="notes">学习笔记</option>
          <option value="meeting">会议纪要</option>
        </select>

        <div className="settings-label">ASS 字号</div>
        <input
          className="settings-input"
          type="number"
          min={12}
          max={96}
          value={draft.export.assFontSize}
          onChange={(event) =>
            setDraft({
              ...draft,
              export: { ...draft.export, assFontSize: Number(event.target.value) || 28 }
            })
          }
        />

        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.export.estimateTimestamps !== false}
            onChange={(event) =>
              setDraft({
                ...draft,
                export: { ...draft.export, estimateTimestamps: event.target.checked }
              })
            }
          />
          缺少时间戳时自动估算
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
        <div className="settings-hint">可用变量：{'{title}'}、{'{bvid}'}、{'{lang}'}、{'{date}'}。</div>
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
        <div className="settings-label">MCP 服务</div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.mcp.enabled}
            onChange={(event) => updateMcp({ enabled: event.target.checked })}
          />
          启用 MCP
        </label>
        <div className="settings-inline">
          <span className="settings-label" style={{ flex: 1 }}>
            服务列表
          </span>
          <button className="mini-btn" onClick={addMcpServer}>
            <Plus size={12} /> 服务
          </button>
        </div>

        {draft.mcp.servers.map((server) => (
          <div key={server.id} className="mcp-card">
            <div className="settings-inline">
              <input
                className="settings-input"
                value={server.name}
                onChange={(event) => updateMcpServer(server.id, { name: event.target.value })}
              />
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={server.enabled}
                  onChange={(event) =>
                    updateMcpServer(server.id, { enabled: event.target.checked })
                  }
                />
                启用
              </label>
              <button className="mini-btn" onClick={() => removeMcpServer(server.id)}>
                <Trash2 size={12} />
              </button>
            </div>
            <input
              className="settings-input"
              placeholder="https://example.com/mcp"
              value={server.url}
              spellCheck={false}
              onChange={(event) => updateMcpServer(server.id, { url: event.target.value })}
            />
            <select
              className="settings-input"
              value={server.transport}
              onChange={(event) =>
                updateMcpServer(server.id, {
                  transport: event.target.value as McpServer['transport']
                })
              }
            >
              <option value="http">HTTP JSON-RPC</option>
              <option value="sse">SSE 传输</option>
            </select>
            <input
              className="settings-input"
              type="password"
              placeholder="Token（可选）"
              value={server.token}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => updateMcpServer(server.id, { token: event.target.value })}
            />
            <button
              className="mini-btn"
              disabled={mcpTesting === server.id}
              onClick={() => void testMcp(server)}
            >
              {mcpTesting === server.id ? (
                <Loader2 size={12} className="spin" />
              ) : (
                '连接 / 列出工具'
              )}
            </button>
            {mcpTools[server.id]?.length ? (
              <div className="mcp-tools">
                {mcpTools[server.id].map((tool) => (
                  <button
                    key={tool.name}
                    className="mcp-tool"
                    title={tool.description}
                    onClick={() => void callMcp(server, tool)}
                  >
                    {tool.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        <div className="settings-label">调用参数（JSON）</div>
        <textarea
          className="settings-textarea"
          rows={3}
          value={mcpArgs}
          spellCheck={false}
          onChange={(event) => setMcpArgs(event.target.value)}
        />
        {mcpResult && <pre className="correction-preview">{mcpResult}</pre>}
        <div className="settings-hint">
          点击工具名用上方参数调用。当前是手动调用；自动接入 AI 工具循环待补。
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">Skills</div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.skills.enabled}
            onChange={(event) => updateSkills({ enabled: event.target.checked })}
          />
          启用技能提示词
        </label>
        <div className="settings-inline">
          <button className="mini-btn" onClick={() => void importSkill()}>
            <Plus size={12} /> 导入 SKILL.md
          </button>
          <button className="mini-btn" onClick={addSkill}>
            <Plus size={12} /> 新建技能
          </button>
        </div>

        {draft.skills.items.map((skill) => (
          <div key={skill.id} className="skill-card">
            <div className="settings-inline">
              <input
                className="settings-input"
                value={skill.name}
                onChange={(event) => updateSkill(skill.id, { name: event.target.value })}
              />
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  onChange={(event) => updateSkill(skill.id, { enabled: event.target.checked })}
                />
                启用
              </label>
              <button className="mini-btn" onClick={() => removeSkill(skill.id)}>
                <Trash2 size={12} />
              </button>
            </div>
            <input
              className="settings-input"
              placeholder="触发条件 / 描述"
              value={skill.description}
              onChange={(event) => updateSkill(skill.id, { description: event.target.value })}
            />
            <textarea
              className="settings-textarea"
              rows={4}
              value={skill.body}
              onChange={(event) => updateSkill(skill.id, { body: event.target.value })}
            />
            <div className="settings-hint">来源：{skill.source}</div>
          </div>
        ))}
        <div className="settings-hint">启用后会注入总结和对话的系统提示词。</div>
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
