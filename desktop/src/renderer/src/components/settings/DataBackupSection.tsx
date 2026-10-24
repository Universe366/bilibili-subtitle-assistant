import { Download, FolderOpen, RefreshCw, Upload } from 'lucide-react';
import { SettingsSection } from './SettingsSection';

interface DataBackupSectionProps {
  dataDir: string;
  migrating: boolean;
  onChangeLocation: () => void;
  onExportSettings: () => void;
  onImportSettings: () => void;
  onBackup: () => void;
  onRestore: () => void;
  onCompact: () => void;
  onClearBrowsingData: () => void;
}

/** 数据与备份：目录展示、迁移、设置导入导出、整库备份恢复、压缩、清浏览数据。 */
export function DataBackupSection({
  dataDir,
  migrating,
  onChangeLocation,
  onExportSettings,
  onImportSettings,
  onBackup,
  onRestore,
  onCompact,
  onClearBrowsingData
}: DataBackupSectionProps) {
  return (
    <SettingsSection title="数据与备份" defaultOpen={false}>
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
        <button className="mini-btn" onClick={onChangeLocation} disabled={migrating}>
          <FolderOpen size={12} /> {migrating ? '迁移中…' : '更改位置'}
        </button>
        <button className="mini-btn" onClick={onExportSettings}>
          <Download size={12} /> 导出设置
        </button>
        <button className="mini-btn" onClick={onImportSettings}>
          <Upload size={12} /> 导入设置
        </button>
      </div>
      <div className="settings-inline">
        <button className="mini-btn primary" onClick={onBackup}>
          <Download size={12} /> 备份数据
        </button>
        <button className="mini-btn" onClick={onRestore}>
          <Upload size={12} /> 恢复备份
        </button>
        <button className="mini-btn" onClick={onCompact}>
          <RefreshCw size={12} /> 压缩数据库
        </button>
        <button className="mini-btn danger" onClick={onClearBrowsingData}>
          清除浏览数据
        </button>
      </div>
      <div className="settings-hint">
        更改位置会把设置、字幕库、总结、登录状态和日志复制到新目录，然后自动重启；
        缓存类文件不会复制。日志在数据目录的 logs/ 下（保留 7 天）。
        导出设置与数据备份都不含 API Key / 桥 Token；恢复备份后需要在设置里重新填写 Key，
        桥 Token 会自动重新生成。
      </div>
    </SettingsSection>
  );
}
