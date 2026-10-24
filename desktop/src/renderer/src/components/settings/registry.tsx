import type { ComponentType } from 'react';
import {
  BookOpen,
  Bot,
  DatabaseBackup,
  Globe,
  LayoutPanelLeft,
  Palette,
  Plug,
  Search,
  Sparkles
} from 'lucide-react';

export interface SettingsGroup {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
}

/** 设置分组注册表：导航、标题与后续的搜索索引都从这里派生。 */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  { id: 'appearance', label: '外观', description: '主题、字号、侧栏与标签栏布局', icon: Palette },
  {
    id: 'sessions',
    label: '标签页与会话',
    description: '会话恢复、后台休眠、关闭行为',
    icon: LayoutPanelLeft
  },
  { id: 'address', label: '地址栏与搜索', description: '默认搜索引擎与自定义模板', icon: Search },
  {
    id: 'reading',
    label: '页面与阅读',
    description: '选区工具条、字幕跟随与缓存',
    icon: BookOpen
  },
  { id: 'efficiency', label: '效率工具', description: 'AI 悬浮球与桌面宠物', icon: Sparkles },
  { id: 'ai', label: 'AI 与语音', description: 'AI 平台、语音识别、提示词与校对', icon: Bot },
  { id: 'search', label: '检索与核对', description: '联网检索、证据与总结核对', icon: Globe },
  { id: 'plugins', label: '插件与集成', description: '浏览器插件桥、MCP 与技能', icon: Plug },
  {
    id: 'data',
    label: '数据与检查',
    description: '导出、备份、更新与诊断',
    icon: DatabaseBackup
  }
];
