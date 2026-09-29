// 测试入口：把面板应用与自检挂钩打包进同一个 IIFE（仅供 jsdom 渲染测试使用）。
// 该文件只用于验证，不属于扩展运行时。
import * as selfcheck from '../bilibili-subtitle-assistant/src/sidepanel/selfcheck.js';
import '../bilibili-subtitle-assistant/src/sidepanel/app.js';

try {
  window.__BSUB_SELFCHECK__ = selfcheck.default || selfcheck;
} catch (err) {
  /* ignore */
}
