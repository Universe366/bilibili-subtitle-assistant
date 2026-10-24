import { Download, FolderOpen, RefreshCw } from 'lucide-react';
import type { DiagnosticsInfo } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

interface DiagnosticsSectionProps {
  diagnostics: DiagnosticsInfo | null;
  fallbackVersion: string;
  fallbackDataDir: string;
  onRefresh: () => void;
  onCopy: () => void;
  onExport: () => void;
}

/** 诊断与关于：运行环境、库体积、日志、诊断包导出。 */
export function DiagnosticsSection({
  diagnostics,
  fallbackVersion,
  fallbackDataDir,
  onRefresh,
  onCopy,
  onExport
}: DiagnosticsSectionProps) {
  const version = diagnostics?.version || fallbackVersion;
  return (
    <SettingsSection title="诊断与关于" defaultOpen={false}>
      <div className="settings-row">
        <span>桌面端版本</span>
        <code>{version || '读取中'}</code>
      </div>
      <div className="settings-row">
        <span>Electron / Chrome / Node</span>
        <code>
          {diagnostics
            ? `${diagnostics.electron} / ${diagnostics.chrome} / ${diagnostics.node}`
            : '读取中'}
        </code>
      </div>
      <div className="settings-row">
        <span>系统</span>
        <code>{diagnostics ? `${diagnostics.platform} ${diagnostics.arch}` : '读取中'}</code>
      </div>
      <div className="settings-row">
        <span>本地库</span>
        <code>
          {diagnostics
            ? `${diagnostics.library.videos} 视频 / ${diagnostics.library.segments} 段 / ${(
                diagnostics.library.bytes /
                1024 /
                1024
              ).toFixed(1)} MB`
            : '读取中'}
        </code>
      </div>
      <div className="settings-row">
        <span>日志</span>
        <code>
          {diagnostics?.logs.length
            ? diagnostics.logs
                .map((log) => `${log.name} ${(log.size / 1024).toFixed(1)} KB`)
                .join(' · ')
            : '暂无日志'}
        </code>
      </div>
      <pre className="settings-diagnostics">
        {[
          `版本: ${version}`,
          `Electron: ${diagnostics?.electron || ''}`,
          `Chrome: ${diagnostics?.chrome || ''}`,
          `Node: ${diagnostics?.node || ''}`,
          `系统: ${diagnostics?.platform || ''} ${diagnostics?.arch || ''}`,
          `数据目录: ${diagnostics?.dataDir || fallbackDataDir}`,
          `设置: ${diagnostics?.settingsPath || ''}`,
          `数据库: ${diagnostics?.dbPath || ''}`,
          `库: ${diagnostics?.library.videos || 0} 视频 / ${diagnostics?.library.segments || 0} 段`
        ].join('\n')}
      </pre>
      <div className="settings-inline">
        <button className="mini-btn" onClick={onRefresh}>
          <RefreshCw size={12} /> 刷新
        </button>
        <button className="mini-btn" onClick={onCopy}>
          复制诊断
        </button>
        <button className="mini-btn" onClick={onExport}>
          <Download size={12} /> 导出诊断包
        </button>
        <button className="mini-btn" onClick={() => void window.bsub.openDataDir()}>
          <FolderOpen size={12} /> 打开数据目录
        </button>
        <button
          className="mini-btn"
          onClick={() =>
            void window.bsub.openExternal('https://github.com/Universe366/shizi-extension/issues')
          }
        >
          反馈
        </button>
        <button className="mini-btn" onClick={() => void window.bsub.setWizardVisible(true)}>
          重新显示引导
        </button>
      </div>
    </SettingsSection>
  );
}
