import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { AppSettings, McpServer, McpTool } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type McpSettings = AppSettings['mcp'];

interface McpSectionProps {
  value: McpSettings;
  testing: string;
  tools: Record<string, McpTool[]>;
  args: string;
  result: string;
  onChange: (next: McpSettings) => void;
  onArgs: (value: string) => void;
  onAddServer: () => void;
  onUpdateServer: (id: string, patch: Partial<McpServer>) => void;
  onRemoveServer: (id: string) => void;
  onTest: (server: McpServer) => void;
  onCall: (server: McpServer, tool: McpTool) => void;
}

/** MCP 服务：服务列表、连接测试、工具列表、超时/轮数与手动调用参数。 */
export function McpSection({
  value,
  testing,
  tools,
  args,
  result,
  onChange,
  onArgs,
  onAddServer,
  onUpdateServer,
  onRemoveServer,
  onTest,
  onCall
}: McpSectionProps) {
  return (
    <SettingsSection title="MCP 服务" defaultOpen={false}>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
        />
        启用 MCP
      </label>
      <div className="settings-inline">
        <span className="settings-label" style={{ flex: 1 }}>
          服务列表
        </span>
        <button className="mini-btn" onClick={onAddServer}>
          <Plus size={12} /> 服务
        </button>
      </div>

      {value.servers.map((server) => (
        <div key={server.id} className="mcp-card">
          <div className="settings-inline">
            <input
              className="settings-input"
              value={server.name}
              onChange={(event) => onUpdateServer(server.id, { name: event.target.value })}
            />
            <label className="settings-check">
              <input
                type="checkbox"
                checked={server.enabled}
                onChange={(event) => onUpdateServer(server.id, { enabled: event.target.checked })}
              />
              启用
            </label>
            <button className="mini-btn" onClick={() => onRemoveServer(server.id)}>
              <Trash2 size={12} />
            </button>
          </div>
          <input
            className="settings-input"
            placeholder="https://example.com/mcp"
            value={server.url}
            spellCheck={false}
            onChange={(event) => onUpdateServer(server.id, { url: event.target.value })}
          />
          <select
            className="settings-input"
            value={server.transport}
            onChange={(event) =>
              onUpdateServer(server.id, {
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
            onChange={(event) => onUpdateServer(server.id, { token: event.target.value })}
          />
          <button
            className="mini-btn"
            disabled={testing === server.id}
            onClick={() => onTest(server)}
          >
            {testing === server.id ? <Loader2 size={12} className="spin" /> : '连接 / 列出工具'}
          </button>
          {tools[server.id]?.length ? (
            <div className="mcp-tools">
              {tools[server.id].map((tool) => (
                <button
                  key={tool.name}
                  className="mcp-tool"
                  title={tool.description}
                  onClick={() => onCall(server, tool)}
                >
                  {tool.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}

      <div className="settings-inline">
        <div className="settings-field">
          <div className="settings-label">单次工具调用超时（秒）</div>
          <input
            className="settings-input"
            type="number"
            min={5}
            max={300}
            value={Math.round((value.callTimeoutMs || 60000) / 1000)}
            onChange={(event) =>
              onChange({ ...value, callTimeoutMs: (Number(event.target.value) || 60) * 1000 })
            }
          />
        </div>
        <div className="settings-field">
          <div className="settings-label">最多工具轮数</div>
          <input
            className="settings-input"
            type="number"
            min={1}
            max={12}
            value={value.maxToolRounds || 6}
            onChange={(event) => onChange({ ...value, maxToolRounds: Number(event.target.value) || 6 })}
          />
        </div>
      </div>

      <div className="settings-label">调用参数（JSON）</div>
      <textarea
        className="settings-textarea"
        rows={3}
        value={args}
        spellCheck={false}
        onChange={(event) => onArgs(event.target.value)}
      />
      {result && <pre className="correction-preview">{result}</pre>}
      <div className="settings-hint">
        点击工具名用上方参数手动调用；对话时会自动把已启用的 MCP 工具接进工具循环。
      </div>
    </SettingsSection>
  );
}
