# Edge Add-ons 提交材料（2.17.3）

> 官方流程：<https://learn.microsoft.com/zh-cn/microsoft-edge/extensions/publish/publish-extension>
> 开发者注册：<https://learn.microsoft.com/zh-cn/microsoft-edge/extensions/publish/create-dev-account>（免费，需要 Microsoft 账号 + Partner Center）

## 1. 可提交的包

Edge 使用与 Chrome 相同的 MV3 包。**zip 根目录必须直接有 `manifest.json`**，不要多套一层文件夹。

```bash
cd repo
git archive --format=zip -o edge-2.17.3.zip HEAD:bilibili-subtitle-assistant \
  manifest.json rules.json src vendor icons _locales LICENSE THIRD-PARTY-NOTICES.md LICENSES
```

只打运行时文件，不包含 `docs/`、`AGENTS.md`、`CHANGELOG.md`、`README.md`、`verify/`、`_metadata/`。

上传前检查：

```bash
unzip -l edge-2.17.3.zip | head
unzip -p edge-2.17.3.zip manifest.json | head
```

- 版本：**2.17.3**
- 运行时文件约 11 MB（主要是 `vendor/ffmpeg/ffmpeg-core.wasm`，31 MB 未压缩）
- `rules.json` 是静态 DNR 规则；`src/background/header-rules.js` 会在会话中为 TokenRhythm 动态加规则
- 包含 `_locales/zh_CN` 与 `_locales/en`，Partner Center 才能识别中文/英文列表语言
- 包含 `LICENSES/GPL-2.0.txt` 与 `THIRD-PARTY-NOTICES.md`，满足 FFmpeg GPL 构建的分发说明

## 2. Microsoft Store 一览文案

**名称**：B站字幕助手

**短描述**（manifest 的 `description`，会显示在列表顶部）：

> B站视频侧边栏字幕抓取、语音转录、AI 总结与对话、导出。所有配置在侧边栏内完成，无 Obsidian 集成。

**详细描述**（需 250–10,000 字符）：

> B站字幕助手是一个在 B 站视频页右侧边栏里工作的字幕与 AI 工具。非官方扩展，与哔哩哔哩无关联。
>
> 主要功能：
> 1. 字幕抓取：从页面网络请求、播放器实例、B 站字幕接口等多路嗅探官方字幕，按视频与分 P 校验归属，避免串视频。
> 2. 语音转录：没有官方字幕时，解析音轨、分块下载、解码、切片、逐片识别并合并；支持 FFmpeg 本地重封装、并发与随时终止。
> 3. AI 总结与对话：流式 Markdown 总结、长视频分段总结、基于字幕提问、思维链折叠、MCP 工具与 Skills。
> 4. 联网核对：生成总结前会按字幕原句逐条检索，判定证据是支持、反驳还是无关；按独立域名区分多来源一致与单一来源，外部信息只作为补充提醒，不污染正文。
> 5. 优化与导出：AI 修正错别字/术语/数字，规则组与术语表；支持 SRT、WebVTT、ASS、TXT、Markdown、JSON。
> 6. 质量与批量：章节、质量自检、批量队列、历史记录、操作留痕与回退。
> 7. 页面内嵌：默认在 B 站视频页右侧直接显示面板，面板挂在 B 站右侧栏里而不是覆盖页面，高度对齐播放器区域；可折叠/展开，也可一键切回浏览器原生侧边栏。侧边栏可打开内嵌面板，快捷键 Alt+Shift+B 可折叠/展开。
> 8. 设置与更新：设置页支持搜索、分组摘要与「去配置」；发现新版本时提示先备份设置；支持导出/导入完整设置备份，避免手动更新换目录后配置丢失。
>
> 所有配置都在侧边栏内完成；API Key 只保存在本机，不上传到开发者服务器。首次使用无需填写 Key 即可抓取官方字幕；AI 总结、语音转录与联网检索需要用户自备对应服务的 Key。
>
> 权限说明：扩展只在 B 站域名上注入内容脚本；仅在用户填写自定义 OpenAI 兼容端点时才申请对应域名权限。`declarativeNetRequest` 用于 B 站音轨 CDN 的 Referer 补全，以及 TokenRhythm 接口的浏览器上下文头清理，均按域名限定。
>
> 已知限制：MCP 仅支持远程 HTTP/SSE；非 M4A 平台的转录会把音频解码进侧边栏内存；B 站部分内容可能受地区或登录限制。
>
> 作者的话：此插件是本人 vibe coding 作品，有 bug 不代表本人能修；本人是新手，请各位大佬高抬贵手。遇到问题欢迎提 Issue，但请温柔一点 🙏
>
> 问题反馈：https://github.com/Universe366/bilibili-subtitle-assistant/issues

**类别**：Productivity（生产力）；备选 Utilities

**语言**：中文（简体）为主；包内已含 `_locales/zh_CN` 与 `_locales/en`，Partner Center 的 Add language 应能看到中文（简体）和 English。

**搜索词**（最多 7 个，总计不超过 21 个字符）：`B站`、`字幕`、`哔哩哔哩`、`语音转文字`、`AI总结`、`字幕导出`

## 3. 商店素材

已生成在 `docs/store/`：

| 素材 | 文件 | 尺寸 | 说明 |
|---|---|---|---|
| 扩展徽标 | `docs/store/logo-300.png` | 300×300 | 必需；1:1 |
| 小促销图 | `docs/store/promo-small-440x280.png` | 440×280 | 可选 |
| 大促销图 | `docs/store/promo-large-1400x560.png` | 1400×560 | 可选 |

截图（可选，最多 6 张）：必须是 **640×480 或 1280×800**，且来自真实侧边栏。建议至少补 1 张：

1. 有字幕的侧边栏，显示字幕列表 + AI 总结；
2. 设置页，显示搜索框与分组摘要；
3. 「本次联网核对」展开，显示字幕原句、支持/反驳标签。

截图不是按「窗口大小」判定，而是按**导出图片的实际像素**。推荐做法：

- Windows 显示缩放设为 100%，浏览器缩放 100%；
- 打开 B 站视频 + 侧边栏，截取包含两者的窗口内容区（不要只截窄侧边栏再放大）；
- 用 Win+Shift+S / Snipaste 固定区域，或在画图/Photoshop 里新建 **1280×800** 画布，把截图等比缩放/裁切填入，不要拉伸变形；
- 检查尺寸：右键图片 → 属性 → 详细信息 → 尺寸，或运行：

```bash
python verify/tools/fit-store-screenshot.py 你的截图.png --check
python verify/tools/fit-store-screenshot.py 你的截图.png --size 1280x800 --mode contain
# 或 cover：填满画布并居中裁切
```

`contain` 会留背景边，适合整窗截图；`cover` 会裁掉边缘，适合已经接近 16:10 的截图。生成后默认输出到 `docs/store/screenshot-1280x800.png`。

> 不要伪造截图；如果暂时没有，可以先提交（官方标注为可选），之后再补。

## 4. 隐私页填写

**Single purpose**：

> 在 B 站视频侧边栏中抓取/转录字幕，并用用户配置的 AI 服务进行总结、对话、校对与导出。

**Remote code**：**No**。所有 JS 与 WebAssembly（含 FFmpeg.wasm）都打包在扩展内，不加载远程代码。

**Data usage**（按实际勾选）：

- Website content（B 站页面、字幕、评论、音轨；用户主动触发时发送给所选 AI/ASR/检索服务）
- Authentication information（用户自备的 API Key，仅本地保存并直连服务商）

不收集位置、浏览历史、个人身份信息，不出售数据，不含遥测/广告/追踪。

**Privacy policy URL**：

`https://gist.github.com/Universe366/ec06f35cf9e74238d5085b3b1bfc6ad6`

（已更新到 2.12.1，包含设置备份与 DNR 会话规则说明；仓库内 [`PRIVACY.md`](../PRIVACY.md) 是同一份内容。）

## 5. 权限理由（逐条复制到 Privacy → Permission justification）

- **storage / unlimitedStorage**：保存扩展设置、字幕缓存、历史记录与语音转录临时音频分块；`unlimitedStorage` 用于避免长视频缓存触发配额上限。
- **tabs**：定位当前 B 站标签页、打开侧边栏、在扩展更新后刷新页面。
- **scripting**：向 B 站页面注入主环境桥（MAIN world）与隔离环境内容脚本，以读取播放器状态和字幕接口。
- **sidePanel**：提供扩展的侧边栏 UI。
- **webNavigation**：监听 B 站站内导航与视频切换，更新当前视频上下文。
- **declarativeNetRequest**：
  - 静态规则仅为 B 站音轨 CDN 的 XHR 请求补充 `Referer`（`bilivideo.com`、`bilivideo.cn`、`akamaized.net`），不修改 `Origin`，不匹配媒体资源；
  - 会话规则仅对用户选择、且平台定义标记 `stripBrowserHeaders` 的接口域名（当前为 TokenRhythm）移除 `Origin` / `Referer` / `Sec-Fetch-Site`，用于通过该服务商的 CSRF 校验；按域名限定，只存在于当前浏览器会话。
- **host permissions（B 站域名）**：抓取字幕、音轨、评论与合集信息。
- **host permissions（AI/ASR/检索域名）**：向用户配置的服务发送请求；默认只声明内置平台域名。
- **host permissions（tokenrhythm.studio）**：TokenRhythm 是内置 AI 平台之一，仅用于用户选择该平台时的对话请求。
- **optional_host_permissions（http/https 任意域名）**：仅当用户填写自定义 OpenAI 兼容端点或自建 SearXNG 时，才在运行时申请对应域名权限；不填写则不使用。
- **web_accessible_resources（src/content/*、src/sidepanel/*）**：前者用于页面主环境桥的兜底注入；后者用于「页面内嵌面板」——把扩展自己的 `panel.html` 作为 iframe 加载到 B 站页面，不向网页暴露 API 或数据。
- **alarms**：每天检查一次新版本。

## 6. 认证备注（Notes for certification）

> 本扩展无需登录即可测试官方字幕抓取：安装后打开任意公开的 B 站视频页，点击工具栏图标打开侧边栏，点「获取字幕」。若视频没有官方字幕，会给出明确提示。
>
> AI 总结、语音转录、联网检索需要用户自备 API Key，认证时可不配置；不配置时这些按钮会给出明确提示，不影响字幕抓取与导出。
>
> `declarativeNetRequest` 的静态规则只给 B 站音轨 CDN 的 XHR 请求补 `Referer`；会话规则只在用户选择 TokenRhythm 平台时，对该域名移除浏览器上下文头，不涉及 B 站媒体流。
>
> FFmpeg.wasm 与全部 JS 均打包在扩展内，无远程代码。B 站部分视频可能受地区/登录限制。
>
> 设置备份导出包含用户自己的 API Key 明文，由用户主动下载到本机；扩展不会上传备份文件。

### 认证信息问题（Do testers need an account...）

这里有两种填法，按你是否愿意提供临时 Key 选：

**A. 愿意提供临时 Key**：选「是的」，填说明 + 凭据；认证结束后立刻吊销。

**B. 不想提供 Key（推荐给个人项目）**：选「否」，并在认证备注里主动说明。不要选「是」却留空，容易被当成信息不完整。

选「否」时，在 Certification notes 里加这段英文（Partner Center 是英文界面）：

```text
No developer account or extension login is required.

Core features (official subtitle fetching, subtitle list, search, export) can be fully tested without any credentials.

AI summary, speech transcription, and web search are optional BYOK (bring-your-own-key) integrations: they require the tester's own third-party API key. They are not needed to verify the extension's core functionality. Without a key, the UI shows a clear setup prompt and does not crash.

No developer-provided credentials are included.
```

这样写是如实说明「没有开发者账号/凭据」，而不是声称「所有 AI 功能都能无 Key 测试」。如果审核追问，再决定是否补一个限额临时 Key。

**A 方案的说明文字**：

```text
本扩展没有自己的账号或登录体系，不需要用户名/密码。

核心功能（官方字幕抓取、字幕列表、搜索、导出）安装后打开任意公开 B 站视频即可测试，无需任何 Key。

AI 总结、语音转录、联网检索是可选功能，需要用户自备第三方服务的 API Key。认证时可以跳过这些功能，或使用测试人员自己的 Key；未配置时界面会给出明确提示，不会崩溃。

如需完整测试 AI 功能，可使用下方提供的临时测试 Key（仅限认证期间使用，请勿使用生产 Key）。
```

如果提供了临时 Key，填在凭据字段，并在认证结束后吊销；**不要填假 Key，也不要用生产 Key**。

## 7. 提交步骤

1. 注册 Partner Center → Microsoft Edge 计划（免费）。
2. **Create new extension** → 上传 `edge-2.17.3.zip`。
3. **Availability**：Public；市场默认全部（或按需选择）。
4. **Properties**：类别 Productivity；网站填 GitHub 仓库；支持链接填 Issues。
5. **Privacy**：按第 4、5 节填写 Single purpose、权限理由、Remote code=No、Data usage、Privacy URL。
6. **Microsoft Store listing**：填名称、详细描述、短描述、logo、可选促销图/截图、搜索词。
7. **Certification notes**：粘贴第 6 节。
8. **Publish** → 认证通常最多 7 个工作日。
9. 通过后获得 `https://microsoftedge.microsoft.com/addons/detail/...` 列表 URL；把它补进 README。

## 8. 上架后更新

商店版由 Edge 自动更新，扩展 ID 稳定，不会再出现“换目录丢设置”的问题。发布新版本：

1. 递增 `manifest.json` 的 `version`；
2. 重新打上面的 zip；
3. Partner Center → Packages → 上传新 zip；
4. 提交认证。

> GitHub Releases 仍可保留，作为商店审核期间的备用分发；但商店版用户应优先走自动更新。

### 审核中想换最新包

审核中的 submission **不能直接替换 zip**。正确流程：

1. Partner Center → 该扩展 → Submission status；
2. 如果状态是 **In review**，找 **Withdraw / Cancel review**（不同界面文案可能不同）；
3. 撤回后回到 **Packages**，上传最新的 `edge-2.17.3.zip`；
4. 如果功能/文案有变化，顺手更新 Store listing（尤其是“页面内嵌 / 多语言 / AI 翻译”这些新能力）；
5. 重新 **Publish**，会重新排队认证。

注意：

- **不要新建一个 extension** 来传新版：那会得到新的扩展 ID，老用户不会自动更新；
- 撤回会丢失当前审核队列位置，但已安装用户不受影响；
- 如果不急，等当前版本通过后再提交 update 也可以，商店会自动更新到新版本；
- 不要为了换包伪造截图或测试 Key；认证备注按第 6 节如实填写。
