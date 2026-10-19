# 更新记录

> 完整逐轮复盘（含「当时为什么想错」）见 [`docs/DEVELOPMENT-LOG.md`](docs/DEVELOPMENT-LOG.md)。

## 1.63.10（2026-10-19）

### 新增
- **DeepSeek 官方搜索**：接入 `POST /v1/tools/search` 与 `/v1/tools/fetch`，复用 AI 平台里的 DeepSeek Key，无需再填一次。结果保留 `summary`、`rerank_score`、`authority`、发布日期与站点，按相关度排序后去重。
- 检索词清理（去掉「帮我查一下 / 请问」等口语前缀），原问题作为 `ori_question` 透传；时间过滤映射为 `after:` 查询语法。
- 来源面板优先展示 `summary`，带站点与发布日期，悬停可看更长摘要。
- 自动检索判定收紧：「为什么 / 多少 / 对比 / 区别」这类泛问句不再触发联网。

### 修复
- 检索缓存键补上 `oriQuestion`，不同原问题不再共用缓存。
- 外部 `chrome.storage` 变更会让 service worker 的设置缓存失效。
- 检索结果 URL 只保留 `http(s)`，避免 `javascript:` / `data:` 进入来源链接。
- 身份校验签名透传、页面调用超时映射（`fetchAudioRange` 不再被 15s 掐断）。
- 字幕菜单触发按当前视频过滤，尝试次数按视频重置。
- 「清除」API Key 现在会真正清空。
- 长视频分段总结可以终止；生成总结的校对阶段也可以终止。
- 「刷新页面」改为真正 reload（新增 `tab.reload`）。
- 字幕行编辑按 Esc 取消不再被 blur 误保存。
- 向导不可被 × / Esc 绕过，第 1 步能正确展开 AI 分组。

### 其它
- 音频下载入口归一：整条音轨与分块下载都走 `audio.range`（页面优先、后台兜底）。
- 嗅探缓存加上限（字幕 32 条 / 音轨 16 条），长会话不再慢性增长。
- 批量队列按钮按状态禁用；批量输入在重绘后保留。
- 「清空字幕」加二次确认，并提示可从操作留痕回退。
- 清理未实现的音频缓存配置、3 个无引用配置键与 17 个死函数。

## 1.63.1（2026-10-19）

- 修复基元律动（TokenRhythm）的 403 `CSRF_INVALID`：用 declarativeNetRequest 去掉浏览器上下文头。
- 新增基元律动平台与它自家的错误信封解析。

## 1.63.0 及更早

- 接入基元律动、长视频总结分段、ASR 分片默认 600s、FFmpeg 流复制重封装、MCP / Skills、免费引擎兜底等。
- 详见 [`docs/DEVELOPMENT-LOG.md`](docs/DEVELOPMENT-LOG.md)。
