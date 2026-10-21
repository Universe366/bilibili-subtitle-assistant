# V1 方案（一页纸）

> 目标：Windows 桌面端，自用优先；内置 B 站浏览器 + 本地字幕/总结库 + 与浏览器插件双入口。
> 基于 2026-10-21 的技术验证（见 `spike/README.md`）。

## 1. 产品定义

**一个带完整 B 站浏览体验的本地知识库。** 插件是“传感器”，桌面端是“浏览器 + 大脑 + 仓库”。

- 程序内：打开 B 站、登录、播放、弹幕、评论；侧栏直接看字幕、总结、导出。
- 程序外：原有浏览器插件照常使用，抓到的内容推送到桌面库。
- 库：只存字幕、总结、元数据、笔记；**不落音视频**。

## 2. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 壳 | **Electron 45** | 完整 Chromium、`WebContentsView` 多标签成熟、全 TS |
| UI | React 19 + TypeScript + Vite | 生态大，AI 易维护 |
| 样式 | Tailwind 4 + lucide-react + 自建 token | 参考 Patina 的“克制”设计系统，不抄布局 |
| 数据 | SQLite（better-sqlite3）+ FTS5 | 本地、可搜索、可备份 |
| 浏览器 | `WebContentsView` + 每账号独立 session | 真多标签；多账号隔离 |
| 注入 | CDP `Page.addScriptToEvaluateOnNewDocument` | 复用 `page-bridge.js`，文档开始时生效 |
| 桥 | 本地 HTTP + Bearer token | Patina Web Sync 已验证商店可接受 |

## 3. 架构

```
Electron 主进程 (TS)
├─ Window / TabManager（每个标签一个 WebContentsView）
├─ Session 管理（persist:account-<id>）
├─ Injector（注入 page-bridge.js）
├─ HostBridge（页面 DOM 通道 <-> 主进程 RPC）
├─ SQLite（库 / 任务 / 设置镜像 / 桥客户端）
├─ 本地 HTTP（127.0.0.1 + token，供插件推送）
├─ 下载管理 / 托盘 / 快捷键 / 更新器
└─ Updater（GitHub Releases + 国内镜像）
React 渲染进程
├─ 标签栏 / 地址栏 / 前进后退 / 缩放
├─ 侧栏工作台：字幕 / 总结 / 库 / 设置
└─ 状态与 IPC（contextBridge，默认拒绝）
```

## 4. 数据模型（SQLite）

| 表 | 关键字段 |
|---|---|
| `videos` | id, bvid, cid, title, owner, duration, cover, pubdate, created_at |
| `tracks` | id, video_id, lang, source, is_ai, signature, created_at |
| `segments` | id, track_id, start_ms, end_ms, text |
| `summaries` | id, video_id, kind, content_md, model, created_at |
| `notes` | id, video_id, content_md, created_at |
| `tags` / `video_tags` | 标签与多对多 |
| `jobs` | id, type, payload_json, status, progress, error, created_at |
| `settings_mirror` | key, value_json, updated_at |
| `bridge_clients` | client_id, browser_kind, extension_version, last_seen |

去重键：`bvid + cid + lang + source + content_hash`。

## 5. 插件 ↔ 桌面桥（草案）

```
POST /v1/ingest
Authorization: Bearer <token>
{
  "protocolVersion": 1,
  "clientId": "...",
  "browserKind": "chrome|edge",
  "extensionVersion": "2.16.2",
  "type": "video|subtitles|summary|state",
  "payload": { ... }
}
→ { "ok": true, "id": 123, "deduped": false }

GET /v1/health → { ok, version, libraryCount }
WS  /v1/events  ← 桌面端下发指令（刷新、打开、重新抓取）
```

- token 在桌面设置里生成，插件设置页粘贴。
- 插件离线时本地排队，连上后补传。
- 桌面端是库的唯一事实源；插件设置仍是设置的唯一事实源，桌面只做镜像编辑。

## 6. V1 范围

**Must**
- 多标签浏览器：地址栏、前进后退、刷新、缩放、页内查找、右键菜单、基础文件下载
- B 站优化：BV/链接/搜索词识别、扫码登录、视频播放、弹幕、评论
- 抓取：注入 page-bridge，读取视频信息 / 字幕轨 / 播放器状态
- 入库：一键入库、自动去重、字幕分段
- 库：列表、全文搜索、按 UP/合集/标签筛选、时间戳回跳
- 总结：复用现有平台与提示词，流式输出
- 导出：Markdown / SRT / JSON 到指定目录
- 设置：平台/Key/提示词、数据目录、导入导出
- 桥：token 配对、插件推送入库
- 托盘、全局快捷键、开机自启

**Should（V1.5）**
- 标签休眠（后台 5 分钟回收）
- 本地 ASR（延后，锦上添花）
- 多账号切换 UI
- 书签 / 历史
- 更新器（绿色版 + 安装包）

**Won't（V1）**
- B 站视频下载
- 云同步 / 账号体系
- 本地 LLM、MCP、RAG
- 广告拦截、扩展支持
- macOS / Linux

## 7. 里程碑

| 阶段 | 内容 | 预估 |
|---|---|---|
| M0 | 工程脚手架：Electron + React + TS + Tailwind + 构建/打包 | 1–2 天 |
| M1 | 浏览器壳：多标签、地址栏、导航、下载、缩放、查找 | 1 周 |
| M2 | 注入 + HostBridge + 抓取入库（视频信息/字幕） | 1 周 |
| M3 | 库 UI：列表、搜索、筛选、时间戳回跳 | 1 周 |
| M4 | 总结、导出、设置、平台逻辑迁移 | 1 周 |
| M5 | 插件桥、托盘、快捷键、打包、自动更新 | 1 周 |

总计约 **6 周**（AI 写码、你验收的节奏）。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| B 站风控 / UA 识别 | 使用正常 Edge UA；不并发狂刷；保持人类节奏 |
| app 内登录态独立 | 首次扫码登录一次；多账号用不同 session |
| 单页应用切换导致身份错乱 | 直接复用现有 `signature` 四层防线 |
| CDP 注入与 DevTools 冲突 | 产品模式不开 DevTools；调试时用独立窗口 |
| 内存随标签上涨 | 标签休眠 + 关闭即退 + 不预加载评论 iframe |
| 绿色版自更新 | 独立小更新器，退出时替换 exe |
| 未签名触发 SmartScreen | 自用先接受；上架前再签名 |

## 9. 已确认 / 待确认

**已确认（2026-10-21 验证）**
- 登录后可 1080p 播放，字幕轨 2 条 `ai-zh`，正文可下载（1476 行）。
- 空窗口 209MB；1080p 播放约 1.5GB，与 Edge 同页同量级；多标签需要标签休眠。
- 页面侧 `page-bridge.js` 可原样注入 Electron。

**待确认**
1. 侧栏信息架构：字幕 / 总结 / 库 / 设置，是否按这个顺序？
2. 总结用的默认平台与提示词，是否沿用插件现有配置？
