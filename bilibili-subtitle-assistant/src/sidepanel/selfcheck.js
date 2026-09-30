// 扩展自检挂钩。
// 侧边栏面板加载时会把内部模块与版本信息挂到 window.__BSUB_SELFCHECK__，
// 便于在真实浏览器 / 自动化环境里直接验证渲染、导出、校验等纯函数。

import * as constants from '../shared/constants.js';
import * as settingsLib from '../shared/settings.js';
import * as storage from '../shared/storage.js';
import * as markdown from './modules/markdown.js';
import * as exporter from './modules/exporter.js';
import * as subtitles from './modules/subtitles.js';
import * as audio from './modules/audio.js';
import * as optimize from './modules/optimize.js';
import * as searchLib from './modules/search.js';
import * as dom from './modules/dom.js';
import * as storeModule from './modules/store.js';
import * as context from './modules/context.js';
import * as panelAi from './modules/panel-ai.js';
import * as panelActions from './modules/panel-actions.js';
import * as panelSubtitles from './modules/panel-subtitles.js';
import * as bridgeModule from './modules/bridge.js';
import * as verifyLib from '../shared/verify.js';
import * as ui from './modules/ui.js';

const api = {
  VERSION: constants.VERSION,
  CONTENT_VERSION: constants.CONTENT_VERSION,
  MODULE_COUNT: 12,
  DEFAULT_SYSTEM_PROMPT: constants.DEFAULT_SYSTEM_PROMPT,
  constants,
  settingsLib,
  storage,
  markdown,
  exporter,
  subtitles,
  audio,
  optimize,
  search: searchLib,
  dom,
  store: storeModule.store,
  context,
  app: context.app,
  panelAi,
  panelActions,
  panelSubtitles,
  bridgeModule,
  verifyLib,
  ui,
  // 面板 API（app.panels.*）在 app.js 里挂载，这里给个便捷入口
  get panels() {
    return context.app.panels;
  }
};

try {
  window.__BSUB_SELFCHECK__ = api;
} catch (err) {
  /* ignore */
}

export default api;
