import { SettingsPanel } from './components/SettingsPanel';

/** 独立设置窗口：整窗渲染设置，不再受侧栏宽度限制。 */
export function SettingsWindow() {
  return (
    <div className="settings-window">
      <SettingsPanel />
    </div>
  );
}
