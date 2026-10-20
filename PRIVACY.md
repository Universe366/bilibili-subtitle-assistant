# 隐私政策 / Privacy Policy

**生效日期：2026-10-20**

B站字幕助手（以下简称“本扩展”）是一个在浏览器侧边栏中运行的 B 站视频字幕工具。本政策说明本扩展会处理哪些数据、为什么处理，以及这些数据去了哪里。

## 1. 本地保存的数据

以下数据只保存在你的浏览器本地（`chrome.storage.local` / IndexedDB），不会上传到开发者服务器：

- 扩展设置、界面偏好；
- 你填写的 AI / 语音识别 / 联网检索服务的 API Key；
- 字幕缓存、历史记录、操作留痕；
- 语音转录产生的临时音频分块（可在设置中清理）。

API Key 不会同步到其它设备，也不会被开发者读取。你可以随时在设置中清除，或卸载扩展来删除全部本地数据。

## 2. 会发送到第三方的数据

为了完成你主动触发的功能，本扩展会把必要的数据发送到对应服务：

| 功能 | 接收方 | 数据 |
|---|---|---|
| 抓取字幕 / 音轨 / 评论 / 合集 | `*.bilibili.com`、B 站 CDN | 视频 URL、cid/aid、分页信息、请求头（由浏览器生成） |
| AI 总结 / 对话 / 校对 | 你选择的 AI 服务（如 DeepSeek、OpenAI、硅基流动等） | 视频标题、字幕文本、你输入的问题、视频简介/评论（仅在你开启时） |
| 语音转录 | 你选择的 ASR 服务 | 音频分片 |
| 联网检索 | 你选择的检索服务或免费引擎 | 检索词、原问题、时间范围 |
| 更新检查 | GitHub | 扩展版本号（不含任何个人数据） |

这些请求直接由你的浏览器发往对应服务商，不经过开发者服务器。各服务商如何保存和处理数据，适用其各自的隐私政策。

## 3. 开发者不收集的数据

开发者不运营任何接收用户数据的中转服务器，不收集：

- 浏览历史、账号密码、Cookie；
- 字幕内容、视频内容、AI 对话内容；
- API Key；
- 设备标识、位置、广告标识。

本扩展不含分析统计、遥测、广告或第三方追踪脚本。

## 4. 权限用途

- **storage / unlimitedStorage**：保存设置、字幕缓存、历史与临时音频分块。
- **tabs / scripting / webNavigation**：在 B 站页面注入内容脚本、感知视频切换、刷新页面。
- **sidePanel**：提供侧边栏界面。
- **declarativeNetRequest**：仅为 B 站音轨 CDN 的 XHR 请求补充 `Referer`，不修改 `Origin`，不影响播放器媒体流。
- **host permissions**：访问 B 站域名以抓取字幕/音轨；访问你配置的 AI/ASR 服务域名以完成请求。
- **optional_host_permissions**：仅当你填写了自定义 OpenAI 兼容端点时，才用于访问该端点。
- **alarms**：每天检查一次新版本。

## 5. 数据保留与删除

本地数据由你控制：可在设置中清理缓存/历史，或卸载扩展。第三方服务上的数据保留时间由对应服务商决定。

## 6. 联系方式

如有隐私相关问题，请在本仓库提交 Issue：

https://github.com/Universe366/bilibili-subtitle-assistant/issues

---

## English summary

This extension stores settings, API keys, subtitle caches, history and temporary audio chunks locally in your browser. It sends only the data required for a feature you trigger (Bilibili video metadata/subtitles/audio, and prompts/subtitles to the AI/ASR/search provider you configure). The developer operates no server that receives user data, and does not collect, sell or share personal data. API keys never leave your device except when sent directly to the provider you selected. You can delete all local data by clearing caches in the settings or uninstalling the extension.

Contact: https://github.com/Universe366/bilibili-subtitle-assistant/issues
