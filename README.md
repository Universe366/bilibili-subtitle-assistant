<div align="center">
  <img src="bilibili-subtitle-assistant/icons/icon128.png" width="96" alt="B站字幕助手" />
  <h1>B站字幕助手</h1>
  <p>在 B 站视频的侧边栏里，完成字幕抓取 → 语音转录 → AI 总结 → 对话 → 联网检索 → 导出。</p>
</div>

[![Release](https://img.shields.io/github/v/release/Universe366/bilibili-subtitle-assistant?sort=semver&display_name=tag)](https://github.com/Universe366/bilibili-subtitle-assistant/releases)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4)](https://developer.chrome.com/docs/extensions/develop/migrate)
[![Chrome](https://img.shields.io/badge/Chrome-116%2B-4285F4)](https://www.google.com/chrome/)

> Chrome / Edge MV3 扩展 · 所有配置都在侧边栏内完成 · 无 Obsidian 集成 · 密钥只保存在本机

完整文档见 **[bilibili-subtitle-assistant/README.md](bilibili-subtitle-assistant/README.md)**。

---

## 功能

- **字幕抓取**：网络嗅探 / 播放器实例 / wbi 签名接口 / 无签名接口 / 主动触发，五路汇总；带时长与归属校验，避免串分 P、串视频。
- **语音转录**：没有官方字幕时，解析音轨 → 分块下载 → 解码 → 单声道 16 kHz → 重叠切片 → 逐片识别 → 去重合并；支持 FFmpeg 流复制重封装、并发切片、随时终止。
- **AI 总结与对话**：流式输出 + Markdown 渲染、思维链独立折叠、长视频分段总结再合并、生成前可先联网校对字幕、支持 MCP 工具与 Skills。
- **联网检索**：默认 DeepSeek 官方搜索（复用 AI Key）；也支持 Tavily / 博查 / Serper / 智谱 / 秘塔 / 百度千帆 / Brave / Exa / Jina / SearXNG；没配 Key 时自动落到免费引擎。
- **优化与替换**：AI 修正错别字 / 同音字 / 术语 / 数字 / 时间，支持联网核对、规则组、术语表、一键全部应用与回退。
- **导出**：SRT / WebVTT / ASS / TXT / Markdown / JSON，6 种格式 × 4 种模板。
- **质量与批量**：章节、质量自检、批量队列、历史记录、操作留痕与回退。

## 快速开始

1. 从 [Releases](https://github.com/Universe366/bilibili-subtitle-assistant/releases) 下载最新 zip，或直接 `git clone` 本仓库。
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）→ 开启「开发者模式」→「加载已解压的扩展程序」。
3. 选择 **`bilibili-subtitle-assistant/`** 这个目录（包含 `manifest.json` 的那一层，不是仓库根目录）。
4. 打开任意 B 站视频页，点击工具栏上的扩展图标，侧边栏会在右侧打开。
5. 第一次使用：设置 → AI 平台（默认 DeepSeek）填 Key → 保存 → 测试连接；需要语音转录时再配语音识别平台。

> 扩展更新后：在 `chrome://extensions` 点扩展卡片上的刷新按钮，并**刷新所有已打开的 B 站页面**（主环境脚本无法热替换）。

## 仓库结构

| 路径 | 内容 |
|---|---|
| `bilibili-subtitle-assistant/` | **扩展本体**，加载扩展时选择这个目录 |
| `bilibili-subtitle-assistant/src/background/` | service worker：RPC、平台适配、MCP、检索 |
| `bilibili-subtitle-assistant/src/content/` | 主环境桥（MAIN world）+ 隔离环境内容脚本 |
| `bilibili-subtitle-assistant/src/sidepanel/` | 侧边栏 UI 与业务逻辑 |
| `bilibili-subtitle-assistant/src/shared/` | 设置、常量、存储、检索路由等 |
| `bilibili-subtitle-assistant/vendor/ffmpeg/` | FFmpeg.wasm 内核（约 31MB，已入库） |
| `verify/` | 自动化测试套件，**不属于扩展运行时** |

## 开发与测试

```bash
cd verify
npm install
node bundle.js       # 把面板打包成 IIFE（jsdom 不执行 type=module）
node panel-test.js   # 以及其他套件，见 verify/README.md
```

当前 **21 个 node 测试套件、1356 项断言**全部通过。浏览器相关套件（CSP / FFmpeg / M4A / MP4）需要真实 Chrome，未在 CI 中运行。

## 文档

| 文件 | 内容 |
|---|---|
| [`bilibili-subtitle-assistant/README.md`](bilibili-subtitle-assistant/README.md) | 用户文档：安装、配置、功能、故障排查 |
| [`bilibili-subtitle-assistant/CHANGELOG.md`](bilibili-subtitle-assistant/CHANGELOG.md) | 按版本汇总的新增 / 修复 / 清理 |
| [`bilibili-subtitle-assistant/AGENTS.md`](bilibili-subtitle-assistant/AGENTS.md) | 给 AI / 贡献者：环境硬约束、踩坑、排查方法论 |
| [`bilibili-subtitle-assistant/docs/DEVELOPMENT-LOG.md`](bilibili-subtitle-assistant/docs/DEVELOPMENT-LOG.md) | 逐轮缺陷与修复复盘 |
| [`PRIVACY.md`](PRIVACY.md) | 隐私政策（Edge 商店提交用） |
| [`bilibili-subtitle-assistant/docs/EDGE-STORE.md`](bilibili-subtitle-assistant/docs/EDGE-STORE.md) | Edge 商店文案、权限理由与认证备注 |
| [`verify/README.md`](verify/README.md) | 测试套件说明与运行方式 |

## 说明

- API Key 只保存在 `chrome.storage.local`，不同步到其它设备，也不会上传。
- MCP 只支持远程 `http` / `sse`；浏览器扩展无法启动本地进程，因此不支持 `stdio`。
- 非 M4A 平台的语音转录会把音频解码进侧边栏内存，长视频转录时请保持侧边栏打开。
- DeepSeek 官方搜索按**成功请求**计费（$0.75 / 1000 次），可在设置中换回免费引擎。
