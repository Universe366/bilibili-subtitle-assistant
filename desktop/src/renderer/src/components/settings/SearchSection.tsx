import { Loader2, Plus, Search, Trash2, Wifi } from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  AppSettings,
  SearchPlatform,
  SearchTimeRange,
  WebReference
} from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

interface SearchSectionProps {
  draft: AppSettings;
  activeSearch: SearchPlatform | null | undefined;
  updateSearch: (patch: Partial<AppSettings['search']>) => void;
  updateSearchPlatform: (patch: Partial<SearchPlatform>) => void;
  addSearchPlatform: () => void;
  removeSearchPlatform: () => void;
  testConnection: (kind: 'ai' | 'asr' | 'search') => void;
  platformBusy: string;
  setEditingSearchId: (id: string) => void;
  platformStatus: (kind: 'ai' | 'asr' | 'search') => ReactNode;
  showKey: Record<string, boolean>;
  setShowKey: (
    updater: (previous: Record<string, boolean>) => Record<string, boolean>
  ) => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchTesting: boolean;
  searchResults: WebReference[] | null;
  onTestSearch: () => void;
}

/** 联网检索：平台选择/协议/Key、结果数与时间范围、核对与兜底配置。 */
export function SearchSection({
  draft,
  activeSearch,
  updateSearch,
  updateSearchPlatform,
  addSearchPlatform,
  removeSearchPlatform,
  testConnection,
  platformBusy,
  setEditingSearchId,
  platformStatus,
  showKey,
  setShowKey,
  searchQuery,
  setSearchQuery,
  searchTesting,
  searchResults,
  onTestSearch
}: SearchSectionProps) {
  return (
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
      {platformStatus('search')}

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
    <button className="mini-btn" disabled={searchTesting} onClick={() => onTestSearch()}>
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
  );
}
