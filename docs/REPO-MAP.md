# 仓库地图（给人看的）

> 当前产品名：**拾字 / Shizi**。桌面端 0.37.1，插件 2.18.6。
> 先看这一页，再决定去读哪份文档，不要从 5 万行历史记录开始。

## 顶层目录

```
repo/
├─ README.md                用户向：功能、安装、快速开始
├─ CONTRIBUTING.md          贡献流程与测试命令
├─ PRIVACY.md / SECURITY.md 隐私与安全
├─ docs/                    跨端文档（维护、签名、仓库地图、截图）
├─ desktop/                 Windows 桌面端（Electron + React）
├─ shizi-extension/         Chrome/Edge MV3 插件（B 站侧边栏）
└─ verify/                  插件侧 Node 测试与打包脚本
```

已移除：根目录历史发布 zip（`bilibili-subtitle-assistant-v*.zip`、`edge-*.zip`）、
逐版本 `release-notes-v*.md`、`desktop/spike/` 一次性探针。发布产物只在 GitHub Releases。

## 桌面端

```
desktop/
├─ src/main/                主进程：窗口/标签/桥/库/AI/ASR/导入
├─ src/preload/             contextBridge API
├─ src/renderer/            React 界面
├─ src/shared/              跨进程类型、品牌、预设
├─ scripts/                 构建/同步/发布/冒烟
│  └─ mocks/                本地 AI/ASR/MCP mock 服务
├─ build/                   NSIS 脚本与图标
├─ docs/                    桌面端文档（见 docs/README.md）
└─ resources/               图标；extension/ 为构建时同步产物（不入库）
```

入口：`src/main/index.ts`；IPC 注册集中在 `src/main/ipc.ts`；
数据层 `src/main/library.ts`；页面/字幕 `src/main/page.ts`、`tabs.ts`。

## 插件

```
shizi-extension/
├─ src/background/          service worker、平台请求、更新检查
├─ src/content/             页面桥与内容脚本
├─ src/sidepanel/           侧边栏 UI 与设置
├─ src/shared/              常量、设置、存储
├─ icons/                   扩展图标
├─ vendor/ffmpeg/           FFmpeg.wasm（GPL，体积大但必须入库）
└─ docs/                    商店材料、历史开发记录
```

## 文档怎么选

| 想知道 | 读 |
|---|---|
| 怎么安装/使用 | 根 `README.md`、`shizi-extension/README.md` |
| 桌面端怎么分层、有哪些坑 | `desktop/docs/ARCHITECTURE.md` |
| 最近改了什么、怎么验收 | `desktop/docs/HARDENING.md` |
| 插件和桌面怎么通信 | `desktop/docs/BRIDGE.md` |
| 发布/更新/安装器 | `docs/MAINTAINERS.md` |
| 品牌与路径迁移历史 | `desktop/docs/REBRAND.md` |
| 0.30.x 旧验收/方案 | `desktop/docs/archive/`（历史，不代表现状） |
| 逐轮缺陷复盘 | `shizi-extension/docs/history/DEVELOPMENT-LOG.md`（开发记录） |

## 维护规则

1. **不提交发布产物**：zip/exe/latest.yml 由 CI 生成，根目录 `*.zip` 已被忽略。
2. **文档分“当前/历史”**：过期验收记录移到 `desktop/docs/archive/`，不要混在现行文档里。
3. **一次性探针不进主目录**：需要保留的 mock 放 `desktop/scripts/mocks/`，其余用完删除。
4. **品牌标识**：显示名「拾字」；`appId=com.shizi.desktop`；仓库 `Universe366/shizi`；
   扩展目录 `shizi-extension/`。旧 `bsub-desktop` 只允许出现在数据迁移兼容代码/文档中。
5. **改完跑**：`cd desktop && npm run typecheck && npm run lint && npm test && npm run smoke`；
   插件改完跑 `cd verify && node bundle.js && node panel-test.js`。
