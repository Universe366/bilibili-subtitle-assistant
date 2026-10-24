import { useEffect, useRef, useState } from 'react';
import type { DiagnosticsInfo } from '../../../shared/types';
import { ModelChips, SettingsSection } from './settings/SettingsSection';
import { BridgeSection } from './settings/BridgeSection';
import { DataBackupSection } from './settings/DataBackupSection';
import { CorrectionSection } from './settings/CorrectionSection';
import { DiagnosticsSection } from './settings/DiagnosticsSection';
import { PromptSection } from './settings/PromptSection';
import { GeneralSection } from './settings/GeneralSection';
import { McpSection } from './settings/McpSection';
import { ExportDefaultsSection } from './settings/ExportDefaultsSection';
import { SitePermissionsSection } from './settings/SitePermissionsSection';
import { SkillsSection } from './settings/SkillsSection';
import { UpdateSection } from './settings/UpdateSection';
import {
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Wifi
} from 'lucide-react';
import type {
  AiPlatform,
  AsrPlatform,
  AppSettings,
  BridgeStatus,
  CorrectionRule,
  CorrectionRuleGroup,
  GlossaryTerm,
  McpServer,
  McpTool,
  SkillItem,
  PromptTemplate,
  SearchPlatform,
  SearchTimeRange,
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
      return `已是最新版本（v${status.currentVersion}）`;
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
  const [migrating, setMigrating] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);
  const [version, setVersion] = useState('');
  const [message, setMessage] = useState('');
  const [installingExtension, setInstallingExtension] = useState(false);
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
  const [editingAiId, setEditingAiId] = useState('');
  const [editingAsrId, setEditingAsrId] = useState('');
  const [editingSearchId, setEditingSearchId] = useState('');
  const [modelCache, setModelCache] = useState<Record<string, string[]>>({});
  const [platformBusy, setPlatformBusy] = useState('');
  const [dirty, setDirty] = useState(false);
  const [sitePermissions, setSitePermissions] = useState<
    Array<{ origin: string; permission: string; decision: 'allow' | 'deny' }>
  >([]);

  useEffect(() => {
    void window.bsub.listSitePermissions().then((response) => {
      if (response.ok) setSitePermissions(response.data);
    });
  }, []);
  const savedJsonRef = useRef('');
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [platformStatus, setPlatformStatus] = useState<{
    key: string;
    text: string;
    ok: boolean;
  } | null>(null);
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
    void window.bsub.getDiagnostics().then((response) => {
      if (response.ok) setDiagnostics(response.data);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    window.bsub
      .getSettings()
      .then((response) => {
        if (!alive) return;
        if (response.ok) {
          setDraft(response.data.settings);
          savedJsonRef.current = JSON.stringify(response.data.settings);
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
      if (match) {
        count += 1;
        if (query) (section as HTMLDetailsElement).open = true;
      }
    }
    setVisibleSections(count);
  }, [settingsQuery, draft]);

  const active = draft
    ? draft.ai.platforms.find((platform) => platform.id === editingAiId) ||
      draft.ai.platforms.find((platform) => platform.id === draft.ai.activeId) ||
      draft.ai.platforms[0]
    : null;
  const activeTemplate = draft
    ? draft.prompt.templates.find((template) => template.id === draft.prompt.activeId) ||
      draft.prompt.templates[0] ||
      null
    : null;
  const activeAsr = draft
    ? draft.asr.platforms.find((platform) => platform.id === editingAsrId) ||
      draft.asr.platforms.find((platform) => platform.id === draft.asr.activeId) ||
      draft.asr.platforms[0] ||
      null
    : null;
  const activeSearch = draft
    ? draft.search.platforms.find((platform) => platform.id === editingSearchId) ||
      draft.search.platforms.find((platform) => platform.id === draft.search.activeId) ||
      draft.search.platforms[0] ||
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
          icon: '✨',
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

  const updateSearchPlatform = (patch: Partial<SearchPlatform>) => {
    if (!draft || !activeSearch) return;
    setDraft({
      ...draft,
      search: {
        ...draft.search,
        platforms: draft.search.platforms.map((platform) =>
          platform.id === activeSearch.id ? { ...platform, ...patch } : platform
        )
      }
    });
  };

  const addSearchPlatform = () => {
    if (!draft) return;
    const id = `search-${Date.now().toString(36)}`;
    const platform: SearchPlatform = {
      id,
      name: '自定义搜索',
      kind: 'custom',
      baseUrl: '',
      apiKey: '',
      homepage: '',
      keyUrl: '',
      reuseAiKey: ''
    };
    setEditingSearchId(id);
    setDraft({
      ...draft,
      search: {
        ...draft.search,
        activeId: id,
        platforms: [...draft.search.platforms, platform]
      }
    });
  };

  const removeSearchPlatform = () => {
    if (!draft || !activeSearch || draft.search.platforms.length <= 1) return;
    const platforms = draft.search.platforms.filter(
      (platform) => platform.id !== activeSearch.id
    );
    setEditingSearchId(platforms[0].id);
    setDraft({
      ...draft,
      search: { ...draft.search, activeId: platforms[0].id, platforms }
    });
  };

  const testConnection = async (kind: 'ai' | 'asr' | 'search') => {
    const platform =
      kind === 'ai' ? active : kind === 'asr' ? activeAsr : activeSearch;
    if (!platform) return;
    setPlatformBusy(`${kind}:test`);
    setError('');
    setPlatformStatus({ key: `${kind}:test`, text: '测试中…', ok: true });
    try {
      const response = await window.bsub.testPlatform(kind, platform);
      if (response.ok) {
        const text = `连接正常（${response.data.ms}ms）${response.data.sample ? ` · ${response.data.sample}` : ''}`;
        setPlatformStatus({ key: `${kind}:test`, text, ok: true });
        setMessage(text);
      } else {
        setPlatformStatus({ key: `${kind}:test`, text: response.error, ok: false });
        setError(response.error);
      }
    } catch (caught) {
      const text = (caught as Error)?.message || String(caught);
      setPlatformStatus({ key: `${kind}:test`, text, ok: false });
      setError(text);
    } finally {
      setPlatformBusy('');
    }
  };

  const probeModels = async (kind: 'ai' | 'asr') => {
    const platform = kind === 'ai' ? active : activeAsr;
    if (!platform) return;
    setPlatformBusy(`${kind}:probe`);
    setError('');
    setPlatformStatus({ key: `${kind}:probe`, text: '探测中…', ok: true });
    try {
      const response = await window.bsub.probePlatformModels(kind, platform);
      if (response.ok) {
        setModelCache((previous) => ({
          ...previous,
          [platform.id]: response.data.models
        }));
        const text = `探测到 ${response.data.models.length} 个模型`;
        setPlatformStatus({ key: `${kind}:probe`, text, ok: true });
        setMessage(text);
      } else {
        setPlatformStatus({ key: `${kind}:probe`, text: response.error, ok: false });
        setError(response.error);
      }
    } catch (caught) {
      const text = (caught as Error)?.message || String(caught);
      setPlatformStatus({ key: `${kind}:probe`, text, ok: false });
      setError(text);
    } finally {
      setPlatformBusy('');
    }
  };

  const platformStatusNode = (kind: 'ai' | 'asr' | 'search') => {
    if (!platformStatus || !platformStatus.key.startsWith(`${kind}:`)) return null;
    return (
      <div className={`platform-status${platformStatus.ok ? ' ok' : ' err'}`}>
        {platformStatus.text}
      </div>
    );
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
    setEditingAsrId(id);
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
    setEditingAsrId(platforms[0].id);
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

  const exportRuleGroup = async (group: CorrectionRuleGroup) => {
    const response = await window.bsub.exportRuleGroup(group);
    if (response.ok) {
      setMessage(response.data.canceled ? '已取消' : `已导出规则组：${response.data.path || ''}`);
    } else {
      setError(response.error);
    }
  };

  const importRuleGroups = async () => {
    if (!draft) return;
    const response = await window.bsub.importRuleGroups();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (!response.data.length) {
      setMessage('未选择规则组文件');
      return;
    }
    updateCorrection({
      groups: [...draft.correction.groups, ...response.data]
    });
    setMessage(`已导入 ${response.data.length} 个规则组`);
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
    setEditingAiId(id);
    setDraft({
      ...draft,
      ai: { ...draft.ai, activeId: id, platforms: [...draft.ai.platforms, platform] }
    });
  };

  const removePlatform = () => {
    if (!draft || !active || draft.ai.platforms.length <= 1) return;
    const platforms = draft.ai.platforms.filter((platform) => platform.id !== active.id);
    setEditingAiId(platforms[0].id);
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
        savedJsonRef.current = JSON.stringify(response.data.settings);
        setDirty(false);
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

  const skipCurrentUpdate = async () => {
    if (!updateState?.version) return;
    const response = await window.bsub.skipUpdate(updateState.version);
    if (response.ok) {
      setUpdateState(response.data);
      setMessage(`已跳过 v${updateState.version}，下次自动检查不再提示`);
    } else {
      setError(response.error);
    }
  };

  const installExtension = async () => {
    setInstallingExtension(true);
    setError('');
    try {
      const response = await window.bsub.installExtension();
      if (response.ok) {
        setMessage(
          `插件目录：${response.data.path}${response.data.browser ? ` · ${response.data.browser}` : ''}`
        );
      } else {
        setError(response.error);
      }
    } finally {
      setInstallingExtension(false);
    }
  };

  const refreshDiagnostics = async () => {
    const response = await window.bsub.getDiagnostics();
    if (response.ok) {
      setDiagnostics(response.data);
      setMessage('诊断信息已刷新');
    } else {
      setError(response.error);
    }
  };

  const copyDiagnostics = async () => {
    const data = diagnostics;
    if (!data) return;
    const text = [
      `版本: ${data.version}`,
      `Electron: ${data.electron}`,
      `Chrome: ${data.chrome}`,
      `Node: ${data.node}`,
      `系统: ${data.platform} ${data.arch}`,
      `数据目录: ${data.dataDir}`,
      `设置: ${data.settingsPath}`,
      `数据库: ${data.dbPath}`,
      `库: ${data.library.videos} 视频 / ${data.library.segments} 段`,
      `日志: ${data.logs.map((log) => `${log.name}=${log.size}B`).join(', ')}`
    ].join('\n');
    await window.bsub.writeClipboard(text);
    setMessage('诊断信息已复制');
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

  const backupAll = async () => {
    const response = await window.bsub.backupData();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setMessage(response.data.canceled ? '已取消' : `数据已备份到：${response.data.path || ''}`);
  };

  const changeDataLocation = async () => {
    if (migrating) return;
    setMigrating(true);
    setError('');
    try {
      const response = await window.bsub.changeDataDir();
      if (!response.ok) {
        setError(response.error);
        return;
      }
      if (response.data.canceled) {
        setMessage('已取消');
        return;
      }
      setMessage(`数据已迁移到：${response.data.target || ''}，正在重启…`);
    } catch (err) {
      setError((err as Error).message || '迁移失败');
    } finally {
      setMigrating(false);
    }
  };

  const restoreAll = async () => {
    if (
      !window.confirm(
        '恢复备份会覆盖当前设置与字幕库，并自动重启程序。当前数据会先留一份 pre-restore 备份。继续？'
      )
    ) {
      return;
    }
    const response = await window.bsub.restoreData();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (response.data.canceled) {
      setMessage('已取消');
      return;
    }
    setMessage('备份已恢复，程序正在重启…');
  };

  const exportDiag = async () => {
    setMessage('');
    setError('');
    const response = await window.bsub.exportDiagnostics();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setMessage(
      response.data.canceled ? '已取消' : `诊断包已导出到：${response.data.path || ''}`
    );
  };

  const compactDatabase = async () => {
    if (
      !window.confirm(
        '压缩数据库会重建 library.db 并回收磁盘空间；库里条目很多时可能需要几十秒，期间不要关闭程序。继续？'
      )
    ) {
      return;
    }
    setMessage('');
    setError('');
    const response = await window.bsub.vacuumLibrary();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    const { before, after } = response.data;
    const saved = Math.max(0, before - after);
    setMessage(
      `数据库已压缩：${(before / 1024 / 1024).toFixed(1)} MB → ${(after / 1024 / 1024).toFixed(
        1
      )} MB（回收 ${(saved / 1024 / 1024).toFixed(1)} MB）`
    );
  };

  const clearPermissions = async () => {
    if (!window.confirm('清除所有已记住的站点权限？下次访问这些站点时会重新询问。')) return;
    const response = await window.bsub.clearSitePermissions();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setSitePermissions([]);
    setMessage(`已清除 ${response.data.removed} 条站点权限记录`);
  };

  const refreshSitePermissions = async () => {
    const response = await window.bsub.listSitePermissions();
    if (response.ok) setSitePermissions(response.data);
  };

  const revokePermission = async (origin: string, permission: string) => {
    const response = await window.bsub.revokeSitePermission(origin, permission);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    await refreshSitePermissions();
  };

  const clearBrowsingData = async () => {
    if (
      !window.confirm(
        '将清除所有网站的 Cookie、缓存、站点数据和登录状态，所有网站都需要重新登录。确认继续？'
      )
    ) {
      return;
    }
    const response = await window.bsub.clearBrowsingData();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setMessage('浏览数据已清除，建议刷新已打开的页面');
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

  const jumpToSection = (label: string) => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('.settings-section')
    );
    const target = sections.find((section) =>
      (section.querySelector('.settings-section-title')?.textContent || '').includes(label)
    );
    if (target) {
      (target as HTMLDetailsElement).open = true;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    if (!draft) return;
    const current = JSON.stringify(draft);
    if (!savedJsonRef.current) savedJsonRef.current = current;
    setDirty(current !== savedJsonRef.current);
  }, [draft]);

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
      <div className="settings-sticky">
        <div className="panel-toolbar">
          <div className="panel-title">设置</div>
          <div className="toolbar-actions">
            {dirty ? (
              <span className="settings-dirty">未保存</span>
            ) : (
              <span className="settings-saved">已保存</span>
            )}
            <button className="mini-btn primary" disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 size={12} className="spin" /> : <Save size={12} />} 保存
            </button>
          </div>
        </div>

        <div className="settings-search-row">
          <Search size={14} />
          <input
            className="settings-search-input"
            placeholder="搜索设置（Key / 导出 / 超时…）"
            value={settingsQuery}
            spellCheck={false}
            onChange={(event) => setSettingsQuery(event.target.value)}
          />
          {settingsQuery && (
            <button className="mini-btn" onClick={() => setSettingsQuery('')}>
              清除
            </button>
          )}
          <select
            className="settings-jump"
            value=""
            title="跳转到分组"
            onChange={(event) => {
              if (event.target.value) jumpToSection(event.target.value);
              event.target.value = '';
            }}
          >
            <option value="">分组</option>
            {['通用', 'AI', '语音', '提示词', '检索', '校对', '导出', 'MCP', 'Skills', '更新', '数据', '诊断'].map(
              (label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              )
            )}
          </select>
        </div>

        {settingsQuery && (
          <div className="settings-hint">匹配 {visibleSections} 个分组</div>
        )}
      </div>

      <GeneralSection value={draft.general} onChange={(patch) => updateGeneral(patch)} />


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
        {platformStatusNode('ai')}
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

        <button className="mini-btn" disabled={testing} onClick={() => void test()}>
          {testing ? <Loader2 size={12} className="spin" /> : <Wifi size={12} />} 测试连接
        </button>
        <div className="settings-hint">关闭流式后会等完整响应再显示。</div>
      </SettingsSection>

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
        {platformStatusNode('asr')}
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

      <PromptSection
        value={draft.prompt}
        onPatch={(patch) => setDraft({ ...draft, prompt: { ...draft.prompt, ...patch } })}
        onAddTemplate={addTemplate}
        onRemoveTemplate={removeTemplate}
        onUpdateTemplate={(patch) => updateTemplate(patch)}
      />


      <SettingsSection title="联网检索" defaultOpen={false}>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.search.enabled}
            onChange={(event) => updateSearch({ enabled: event.target.checked })}
          />
          总结时自动检索参考资料
        </label>

        <div className="settings-label">检索平台</div>
        <div className="settings-inline">
          <select
            className="settings-input"
            value={activeSearch?.id || ''}
            onChange={(event) => setEditingSearchId(event.target.value)}
          >
            {draft.search.platforms.map((platform) => (
              <option key={platform.id} value={platform.id}>
                {platform.name}
                {platform.id === draft.search.activeId ? '（使用中）' : ''}
                {!platform.apiKey && !platform.reuseAiKey ? ' · 未配 Key' : ''}
              </option>
            ))}
          </select>
          {activeSearch && activeSearch.id !== draft.search.activeId && (
            <button
              className="mini-btn primary"
              onClick={() => updateSearch({ activeId: activeSearch.id })}
            >
              设为使用中
            </button>
          )}
          <button className="mini-btn" title="新增检索平台" onClick={addSearchPlatform}>
            <Plus size={12} />
          </button>
          <button
            className="mini-btn"
            title="删除当前检索平台"
            disabled={draft.search.platforms.length <= 1}
            onClick={removeSearchPlatform}
          >
            <Trash2 size={12} />
          </button>
        </div>

        {activeSearch && (
          <>
            <div className="settings-label">名称</div>
            <input
              className="settings-input"
              value={activeSearch.name}
              onChange={(event) => updateSearchPlatform({ name: event.target.value })}
            />

            <div className="settings-label">协议</div>
            <select
              className="settings-input"
              value={activeSearch.kind}
              onChange={(event) => updateSearchPlatform({ kind: event.target.value })}
            >
              <option value="deepseek-search">DeepSeek 搜索</option>
              <option value="tavily">Tavily</option>
              <option value="bocha">博查 Bocha</option>
              <option value="serper">Serper（Google）</option>
              <option value="zhipu">智谱 Web 搜索</option>
              <option value="metaso">秘塔搜索</option>
              <option value="baidu">百度千帆 AI 搜索</option>
              <option value="brave">Brave</option>
              <option value="exa">Exa（MCP，免 Key）</option>
              <option value="jina">Jina 搜索</option>
              <option value="searxng">SearXNG</option>
              <option value="anysearch">AnySearch</option>
              <option value="custom">自定义（GET ?q=）</option>
            </select>

            <div className="settings-label">接口地址</div>
            <input
              className="settings-input"
              value={activeSearch.baseUrl}
              spellCheck={false}
              onChange={(event) => updateSearchPlatform({ baseUrl: event.target.value })}
            />

            <div className="settings-inline">
              <button
                className="mini-btn"
                disabled={platformBusy === 'search:test'}
                onClick={() => void testConnection('search')}
              >
                {platformBusy === 'search:test' ? (
                  <Loader2 size={12} className="spin" />
                ) : (
                  <Wifi size={12} />
                )}
                测试连接
              </button>
            </div>
            {platformStatusNode('search')}

            <div className="settings-label">检索 API Key</div>
            <div className="settings-inline">
              <input
                className="settings-input"
                type={showKey[activeSearch.id] ? 'text' : 'password'}
                value={activeSearch.apiKey === '__CLEAR__' ? '' : activeSearch.apiKey}
                placeholder="留空保存不改动"
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => updateSearchPlatform({ apiKey: event.target.value })}
              />
              <button
                className="mini-btn"
                onClick={() =>
                  setShowKey((previous) => ({
                    ...previous,
                    [activeSearch.id]: !previous[activeSearch.id]
                  }))
                }
              >
                {showKey[activeSearch.id] ? '隐藏' : '显示'}
              </button>
              <button
                className="mini-btn"
                onClick={() => updateSearchPlatform({ apiKey: '__CLEAR__' })}
              >
                清除
              </button>
            </div>

            <div className="settings-label">复用 AI Key（可选）</div>
            <select
              className="settings-input"
              value={activeSearch.reuseAiKey || ''}
              onChange={(event) =>
                updateSearchPlatform({ reuseAiKey: event.target.value })
              }
            >
              <option value="">不重用</option>
              {draft.ai.platforms.map((platform) => (
                <option key={platform.id} value={platform.id}>
                  {platform.name}
                </option>
              ))}
            </select>

            {(activeSearch.homepage || activeSearch.keyUrl) && (
              <div className="settings-inline">
                {activeSearch.homepage && (
                  <button
                    className="mini-btn"
                    onClick={() => void window.bsub.newTab(activeSearch.homepage!)}
                  >
                    官网
                  </button>
                )}
                {activeSearch.keyUrl && (
                  <button
                    className="mini-btn"
                    onClick={() => void window.bsub.newTab(activeSearch.keyUrl!)}
                  >
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
                value={activeSearch.homepage || ''}
                placeholder="https://"
                onChange={(event) => updateSearchPlatform({ homepage: event.target.value })}
              />
              <div className="settings-label">申请 Key 链接</div>
              <input
                className="settings-input"
                value={activeSearch.keyUrl || ''}
                placeholder="https://"
                onChange={(event) => updateSearchPlatform({ keyUrl: event.target.value })}
              />
            </details>
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
          包含网页正文（支持的平台）
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.search.verify}
            onChange={(event) => updateSearch({ verify: event.target.checked })}
          />
          AI 优化时联网核对改动（较慢，消耗检索与 AI 额度）
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.search.verifySummary !== false}
            onChange={(event) => updateSearch({ verifySummary: event.target.checked })}
          />
          总结前联网核对字幕（抽具体数字/术语逐条检索，推荐）
        </label>
        {draft.search.verifySummary !== false && (
          <>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={draft.search.aiQueryGeneration !== false}
                onChange={(event) =>
                  updateSearch({ aiQueryGeneration: event.target.checked })
                }
              />
              让 AI 挑选待核实项（关闭则只用规则抽数字/术语，省一次小调用）
            </label>
            <div className="settings-field">
              <div className="settings-label">每次核对条数</div>
              <input
                className="settings-input"
                type="number"
                min={1}
                max={20}
                value={draft.search.verifyItemCount || 12}
                onChange={(event) =>
                  updateSearch({ verifyItemCount: Number(event.target.value) || 12 })
                }
              />
            </div>
            <div className="settings-label">额外核实查询（每行一条，可留空）</div>
            <textarea
              className="settings-input"
              rows={3}
              placeholder="例如：DeepSeek V4 发布时间"
              value={draft.search.extraVerifyQueries || ''}
              onChange={(event) =>
                updateSearch({ extraVerifyQueries: event.target.value })
              }
            />
          </>
        )}

        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.search.keylessFallback !== false}
            onChange={(event) => updateSearch({ keylessFallback: event.target.checked })}
          />
          配置的平台失败时用免费引擎兜底
        </label>
        {draft.search.keylessFallback !== false && (
          <div className="settings-field">
            <div className="settings-label">兜底顺序（exa / anysearch / searxng，逗号分隔）</div>
            <input
              className="settings-input"
              value={(draft.search.keylessOrder || []).join(', ')}
              placeholder="exa, anysearch"
              onChange={(event) =>
                updateSearch({
                  keylessOrder: event.target.value
                    .split(/[,\s]+/)
                    .map((item) => item.trim().toLowerCase())
                    .filter((item) => ['exa', 'anysearch', 'searxng'].includes(item))
                })
              }
            />
          </div>
        )}

        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.search.autoSearchOnChat === true}
            onChange={(event) => updateSearch({ autoSearchOnChat: event.target.checked })}
          />
          对话自动联网（问题涉及最新/是谁/多少钱等）
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.search.alwaysSearchOnChat === true}
            onChange={(event) => updateSearch({ alwaysSearchOnChat: event.target.checked })}
          />
          每轮对话都联网（最准，但每次都消耗检索额度）
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.search.useVideoMeta !== false}
            onChange={(event) => updateSearch({ useVideoMeta: event.target.checked })}
          />
          总结/对话时带视频简介
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.search.useComments === true}
            onChange={(event) => updateSearch({ useComments: event.target.checked })}
          />
          总结时带热门评论（默认关闭；仅作观众观点参考）
        </label>

        <div className="settings-label">检索结果缓存（分钟，0 = 关闭）</div>
        <input
          className="settings-input"
          type="number"
          min={0}
          max={60}
          value={draft.search.cacheMinutes}
          onChange={(event) =>
            updateSearch({ cacheMinutes: Number(event.target.value) || 0 })
          }
        />

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
          Exa / AnySearch / SearXNG 免 Key；DeepSeek 搜索可复用 AI 平台 Key。测试使用已保存配置。
        </div>
      </SettingsSection>

      <CorrectionSection
        value={draft.correction}
        testText={correctionTest}
        preview={correctionPreview}
        testing={correctionTesting}
        onToggle={(enabled) => updateCorrection({ enabled })}
        onAddGroup={addGroup}
        onImportGroups={() => void importRuleGroups()}
        onUpdateGroup={(id, patch) => updateGroup(id, patch)}
        onExportGroup={(group) => void exportRuleGroup(group)}
        onRemoveGroup={removeGroup}
        onAddRule={addRule}
        onUpdateRule={(groupId, ruleId, patch) => updateRule(groupId, ruleId, patch)}
        onRemoveRule={(groupId, ruleId) => removeRule(groupId, ruleId)}
        onToggleGlossary={(enabled) => updateGlossary({ enabled })}
        onAddTerm={addTerm}
        onUpdateTerm={(id, patch) => updateTerm(id, patch)}
        onRemoveTerm={removeTerm}
        onTestText={setCorrectionTest}
        onPreview={() => void previewCorrection()}
      />


      <BridgeSection
        value={draft.bridge}
        status={bridge}
        installing={installingExtension}
        onChange={(next) => setDraft({ ...draft, bridge: next })}
        onInstall={installExtension}
      />


      <ExportDefaultsSection
        value={draft.export}
        onChange={(next) => setDraft({ ...draft, export: next })}
      />


      <UpdateSection
        version={version}
        status={updateState}
        statusText={updateText(updateState)}
        value={draft.update}
        onChange={(next) => setDraft({ ...draft, update: next })}
        onCheck={() => void window.bsub.checkForUpdates()}
        onDownload={() => void window.bsub.downloadUpdate()}
        onSkip={() => void skipCurrentUpdate()}
        onInstall={() => void window.bsub.installUpdate()}
        onOpenReleases={() => void window.bsub.openReleasesPage()}
      />


      <McpSection
        value={draft.mcp}
        testing={mcpTesting}
        tools={mcpTools}
        args={mcpArgs}
        result={mcpResult}
        onChange={(next) => updateMcp(next)}
        onArgs={setMcpArgs}
        onAddServer={addMcpServer}
        onUpdateServer={(id, patch) => updateMcpServer(id, patch)}
        onRemoveServer={removeMcpServer}
        onTest={(server) => void testMcp(server)}
        onCall={(server, tool) => void callMcp(server, tool)}
      />


      <SkillsSection
        value={draft.skills}
        onToggle={(enabled) => updateSkills({ enabled })}
        onImport={() => void importSkill()}
        onCreate={addSkill}
        onUpdate={(id, patch) => updateSkill(id, patch)}
        onRemove={removeSkill}
      />


      <DiagnosticsSection
        diagnostics={diagnostics}
        fallbackVersion={version}
        fallbackDataDir={dataDir}
        onRefresh={() => void refreshDiagnostics()}
        onCopy={() => void copyDiagnostics()}
        onExport={() => void exportDiag()}
      />


      <SitePermissionsSection
        items={sitePermissions}
        onRevoke={(origin, permission) => void revokePermission(origin, permission)}
        onRefresh={() => void refreshSitePermissions()}
        onClear={() => void clearPermissions()}
      />


      <DataBackupSection
        dataDir={dataDir}
        migrating={migrating}
        onChangeLocation={() => void changeDataLocation()}
        onExportSettings={() => void exportSettings()}
        onImportSettings={() => void importSettings()}
        onBackup={() => void backupAll()}
        onRestore={() => void restoreAll()}
        onCompact={() => void compactDatabase()}
        onClearBrowsingData={() => void clearBrowsingData()}
      />


      {(message || error) && (
        <div
          className={`settings-toast ${error ? 'err' : 'ok'}`}
          onClick={() => {
            setMessage('');
            setError('');
          }}
          title="点击关闭"
        >
          {error || message}
        </div>
      )}

      <div className="panel-foot">
        <span>API Key 用系统 DPAPI 加密后保存在本机</span>
        <span>v{version}</span>
      </div>
    </div>
  );
}
