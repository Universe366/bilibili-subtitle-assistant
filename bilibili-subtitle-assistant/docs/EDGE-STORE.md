# Edge Add-ons 提交材料

> 当前发布方式以 **GitHub Releases** 为主；本文档保留，等以后要上 Edge 商店时直接使用。
> 官方流程：<https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension>

## 1. 包

- 版本：**2.9.0**
- 包内根目录必须直接有 `manifest.json`
- 不要包含 `verify/`、`.git/`、`node_modules/`
- 构建：

```bash
git -C repo archive --format=zip -o edge-2.9.0.zip HEAD:bilibili-subtitle-assistant
```

## 2. 商店文案（中文，≥250 字符）

**名称**：B站字幕助手

**短描述**（manifest 里的 description，约 60 字）：

> B站视频侧边栏字幕抓取、语音转录、AI 总结与对话、导出。所有配置在侧边栏内完成，无 Obsidian 集成。

**详细描述**：

> B站字幕助手是一个在 B 站视频页右侧边栏里工作的字幕与 AI 工具，非官方扩展，与哔哩哔哩无关联。
>
> 主要功能：
> 1. 字幕抓取：从页面网络请求、播放器实例、B 站字幕接口等多路嗅探官方字幕，按视频与分 P 校验归属，避免串视频。
> 2. 语音转录：没有官方字幕时，解析音轨、分块下载、解码、切片、逐片识别并合并；支持 FFmpeg 本地重封装、并发与随时终止。
> 3. AI 总结与对话：流式 Markdown 总结、长视频分段总结、基于字幕提问、思维链折叠、MCP 工具与 Skills。
> 4. 联网核对：生成总结前可对字幕里的术语、数字、时间逐条检索核对；外部信息只作为补充提醒，不列来源、不污染正文。
> 5. 优化与导出：AI 修正错别字/术语/数字，规则组与术语表；支持 SRT、WebVTT、ASS、TXT、Markdown、JSON。
> 6. 质量与批量：章节、质量自检、批量队列、历史记录、操作留痕与回退。
>
> 所有配置都在侧边栏内完成；API Key 只保存在本机，不上传到开发者服务器。首次使用无需填写 Key 即可抓取官方字幕；AI 总结、语音转录与联网检索需要用户自备对应服务的 Key。
>
> 已知限制：MCP 仅支持远程 HTTP/SSE；非 M4A 平台的转录会把音频解码进侧边栏内存；B 站部分内容可能受地区或登录限制。问题反馈：https://github.com/Universe366/bilibili-subtitle-assistant/issues

## 3. 权限理由（逐条复制到 Privacy → Permission justification）

- **storage / unlimitedStorage**：保存扩展设置、字幕缓存、历史记录与语音转录临时音频分块；`unlimitedStorage` 用于避免长视频缓存触发配额上限。
- **tabs**：定位当前 B 站标签页、打开侧边栏、在扩展更新后刷新页面。
- **scripting**：向 B 站页面注入主环境桥（MAIN world）与隔离环境内容脚本，以读取播放器状态和字幕接口。
- **sidePanel**：提供扩展的侧边栏 UI。
- **webNavigation**：监听 B 站站内导航与视频切换，更新当前视频上下文。
- **declarativeNetRequest**：仅为 B 站音轨 CDN 的 XHR 请求补充 `Referer` 头，不修改 `Origin`，也不匹配 media 资源类型；用于修复音轨 403。
- **host permissions（B 站域名）**：抓取字幕、音轨、评论与合集信息。
- **host permissions（AI/ASR 域名）**：向用户配置的 AI / 语音识别服务发送请求。
- **optional_host_permissions（http/https 任意域名）**：仅当用户填写自定义 OpenAI 兼容端点时，用于访问该端点；不填写则不使用。
- **alarms**：每天检查一次新版本。

## 4. 隐私表单

- **Single Purpose**：在 B 站视频侧边栏中抓取/转录字幕，并用用户配置的 AI 服务进行总结、对话、校对与导出。
- **Remote code**：**No**。所有 JS 与 WebAssembly（含 FFmpeg.wasm）都打包在扩展内，不加载远程代码。
- **Data usage**：
  - Website content（B 站页面、字幕、评论、音轨）
  - Authentication information（用户自备的 API Key，仅本地保存并直连服务商）
  - 不收集位置、浏览历史、个人身份信息，不出售数据
- **Privacy policy URL**：`https://gist.github.com/Universe366/ec06f35cf9e74238d5085b3b1bfc6ad6`（公开 gist，仓库 public/private 都能用）

## 5. 商店素材清单

- 扩展 logo：1:1，推荐 300×300，最小 128×128（可由 `icons/icon128.png` 放大）
- 截图：最多 6 张，必须是 640×480 或 1280×800
- 小促销图：440×280（可选）
- 大促销图：1400×560（可选）
- 搜索词：最多 7 个，总计不超过 21 个词
- 描述：250–10,000 字符

## 6. 认证备注（Notes for certification）

> 本扩展无需登录即可测试官方字幕抓取：安装后打开任意公开的 B 站视频页，点击工具栏图标打开侧边栏，点“抓取字幕”。
>
> AI 总结、语音转录、联网检索需要用户自备 API Key，认证时可不配置；不配置时这些按钮会给出明确提示，不影响字幕抓取与导出。
>
> `declarativeNetRequest` 仅用于给 B 站音轨 CDN 的 XHR 请求补 `Referer`，不修改 `Origin`，不匹配 media 资源。
>
> FFmpeg.wasm 与全部 JS 均打包在扩展内，无远程代码。B 站部分视频可能受地区/登录限制。

## 7. 更新

商店版由 Edge 自动更新。发布新版本时：

1. 递增 `manifest.json` 的 `version`
2. 重新打包
3. Partner Center → Packages → 上传新 zip
4. 提交认证
