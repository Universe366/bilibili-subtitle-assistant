# desktop/AGENTS.md —— 桌面端专用交接

> 先读仓库根 [`AGENTS.md`](../AGENTS.md) 和 [`HANDOFF.md`](../HANDOFF.md)。
> 这里只写桌面端（Electron）特有的约束。

## 1. 进程边界

```
src/main/        Node 环境；窗口、标签、SQLite、AI、ASR、更新
src/preload/     contextBridge；只暴露 window.bsub
src/renderer/    React；不能 import main，只能走 window.bsub
src/shared/      三端共享的类型/品牌/预设
```

- 新增 IPC：优先 `src/main/ipc/<domain>.ts`；`ipc.ts` 只保留注册入口。
- 新增类型：放 `src/shared/types.ts`，不要在各端重复定义。
- 所有 IPC 返回统一 `Result<T>`，用 `failure()` 包错误。

## 2. 数据与迁移

- 默认 userData：`%APPDATA%\shizi`；旧 `bsub-desktop` 首次启动自动迁移。
- 数据库：`library.db`，`PRAGMA user_version` 迁移链在 `src/main/migrations.ts`。
- 改 schema 必须新增 migration，并更新 `LATEST_SCHEMA_VERSION`；不要只改 `SCHEMA`。
- 自定义数据目录：`shizi-location.txt`，仍在 `dataDir.ts`。
- 备份：`backup.ts` 带 SHA-256；改动数据格式时同步更新恢复逻辑。

## 3. 启动 / 打包 / 测试

```bash
unset ELECTRON_RUN_AS_NODE       # 本机必须
npm run dev
npm run check                    # typecheck + lint + unit
npm run verify                   # check + smoke
npm run pack                     # build + 同步插件 + NSIS，不发布
```

打包注意：

- `pack` 已带 `--config.electronDist=node_modules/electron/dist`；
- 不要直接 `npx electron-builder`，否则可能跳过 `prebuild`，安装包里插件还是旧版；
- `release/win-unpacked/拾字.exe` 运行时不能重打包，先杀进程；
- 安装包未签名，SmartScreen 提示是已知的。

## 4. 测试钩子

| 环境变量 | 用途 |
|---|---|
| `BSUB_USER_DATA` | 临时 userData（测试隔离） |
| `BSUB_DOWNLOAD_DIR` | 下载目录 |
| `BSUB_LOCAL_MEDIA` | 本地媒体测试文件 |
| `BSUB_DIAG_DIR` | 诊断导出目录 |
| `BSUB_RESTORE_DIR` | 备份恢复目录 |
| `BSUB_RESTORE_NO_RELAUNCH` | 恢复后不重启 |
| `BSUB_RESTORE_SKIP_CHECK` | 跳过校验（仅测试） |

冒烟：`scripts/smoke.mjs` 用临时 userData + CDP，不会碰真实数据。

## 5. 常见故障

| 现象 | 原因/处理 |
|---|---|
| `bad option` / Electron 以 Node 运行 | `ELECTRON_RUN_AS_NODE=1`，先 unset |
| 打包 `EBUSY app.asar` | 应用/win-unpacked 进程未退 |
| `unable to verify the first certificate` | 加 `--config.electronDist=node_modules/electron/dist` |
| 安装包内插件是旧版 | 没有跑 `prebuild`；用 `npm run pack` |
| 页面读不到正文 | 页面是 PDF/特殊站点，或 `readPageContext` 选择器不匹配 |
| 迁移后数据为空 | 看 `%APPDATA%\shizi` 是否存在；旧目录是否被锁 |

## 6. 当前大型文件（改前先想清楚）

- `src/main/ipc/*.ts`（~2.9k，按域拆分；`ipc.ts` 只剩 43 行注册入口）
- `src/main/library.ts`（102 行桶文件；其余域在 `src/main/library/`）
- `src/main/index.ts`（341 行装配入口；开发探针在 `devHooks.ts`）
- `src/renderer/.../SettingsPanel.tsx`（~1.25k，15 个 section 已在 `components/settings/`）
- `src/renderer/.../LibraryPanel.tsx`（~1.32k，15 个 section 已拆）
- `src/renderer/.../SubtitlesPanel.tsx`（~1.59k，翻译/校对/质检/视频头/字幕行已拆）

不要在这些文件尾部继续加功能；优先新建模块。拆分顺序见 `docs/QUALITY.md`。
