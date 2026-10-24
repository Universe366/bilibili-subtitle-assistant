# HANDOFF —— 当前状态与交接说明

> 更新时间：2026-10-24  
> 适用版本：桌面 **0.37.2** / 插件 **2.18.6**  
> 当前发布基线：`8b7e022`（0.37.2）  
> 最新 Release：`v0.37.2`  
> 工作区：clean

这份文件回答三个问题：

1. 现在项目处于什么状态；
2. 下一个接手的人/AI 应该先做什么；
3. 哪些事不要碰。

---

## 1. 当前健康度

| 项目 | 状态 |
|---|---|
| 桌面 `typecheck` | 通过 |
| 桌面 `lint` | 0 error / 88 warning（上限 90） |
| 桌面单测 | 18 个文件 / 70 个用例（含 IPC channel 契约 3 条） |
| 桌面冒烟 | `SMOKE OK ...` + `E2E OK 9/9` |
| 插件 `panel-test` | 520 项，0 失败 |
| 桌面 CI | `master`/PR 通过 |
| 插件 CI | `master`/PR 通过 |
| 发布 CI | `v0.37.2` 通过 |
| 安装包 | 未签名；SmartScreen 会提示 |
| 自动更新 | `latest.yml` 指向 0.37.2，`/releases/latest` 已确认 |

仓库体积：约 36MB（FFmpeg.wasm 31MB）；本地工作区约 1.7GB（含 `node_modules`、`release/win-unpacked`）。

---

## 2. 最近发生了什么（避免重复劳动）

### 0.37.2（2026-10-24）
- 移除仓库内 31 个历史发布 zip（约 320MB）和逐版本 release-notes；
- 删除 `desktop/spike/`，mock 移到 `desktop/scripts/mocks/`；
- 历史验收/方案移到 `desktop/docs/archive/`；
- 新增 `docs/REPO-MAP.md`、`docs/QUALITY.md`、`desktop/docs/README.md`；
- 清理 63 个过时 GitHub Release（保留 7 个 shizi 时代版本，tag 全保留）；
- 修 GitHub semver 把 `v2.18.6` 当 Latest 的问题，现 Latest 是 `v0.37.2`；
- 修复桌面 CI 监听错分支（`main` → `master`）；
- 新增插件 CI；
- 新增 `npm run pack`，避免再次出现“安装包内插件资源未同步”；
- 提取 `renderer/lib/format.ts`，去掉 7 处重复格式化；
- 修复对话 `sendOnEnter`/`expandReasoning`、总结 `search.verify` 未生效。

### 0.37.2 之后的本机复验（2026-10-24，未发版）
- 桌面 `npm run verify` 全绿：typecheck 通过、lint 0 error/88 warning、18 文件 70 用例、`SMOKE OK version=0.37.2`；
- 插件 `npm test` 22 个套件全绿，`panel-test.js` 520 项 0 失败；
- 修正过期版本号：`docs/REPO-MAP.md`、`docs/MAINTAINERS.md` 里的 0.37.1 → 0.37.2；
- 修正 `desktop/scripts/release.mjs`：安装说明的数据目录 `bsub-desktop` → `shizi`（旧版自动迁移），发行 tag 从 `v${插件版本}` 改为 `v${桌面版本}`（否则脚本会提示 `v2.18.6`，与 semver Latest 规则冲突）；
- 删除本机残留的 `desktop/spike/`（早已 gitignore，仓库内本就没有）。

### Phase 0（2026-10-24，可维护性）
- `desktop/scripts/smoke.mjs` 从 3 项启动检查扩为 **9 条 E2E**：窗口/preload、标签页、设置读写持久化、字幕入库+列表+详情+检索、笔记、回收站删除/恢复、任务中心、AI 参数校验、历史与导出记录；
- 新增 **IPC channel 契约**：`scripts/ipc-channels.json`（155 条）+ `src/main/ipcChannels.test.ts`，校验主进程注册与清单一致、preload 的 invoke/send 都有处理、清单无重复；改 channel 后跑 `UPDATE_IPC_CHANNELS=1 npm test` 更新；
- `ipc.ts` 按域拆分：**library / browser / page / settings / media / jobs / tools / records** 八个模块放进 `src/main/ipc/`，共享的 `failure`/`trackJob`/`IpcContext`/`withStartParam`/`abortControllers` 在 `shared.ts`；`ipc.ts` 2.8k → **43 行**，只剩注册入口；
- 每个域单独提交，拆分前后都跑 `typecheck`、`lint`（88 warning 不变）、18 文件 70 用例、E2E，channel 清单始终 155 条。

### 0.37.0 / 0.37.1
- 插件界面品牌统一为「拾字」；
- 修复 0.36/0.37 安装包内置插件仍是 2.18.2 的问题。

### 0.35.0 / 0.36.0
- `appId` 改为 `com.shizi.desktop`，仓库改为 `Universe366/shizi`；
- 插件目录改为 `shizi-extension/`，桥 `app` 字段改为 `shizi`。

---

## 3. 已知风险 / 技术债

| 风险 | 说明 |
|---|---|
| 巨型文件 | `ipc.ts` 43 行（入口）/ `library.ts` 2.7k / `SettingsPanel.tsx` 3.1k / `LibraryPanel.tsx` 2.3k / `index.ts` 2.4k |
| 桌面 E2E 覆盖窄 | 6 条主流程 E2E（设置/库/笔记/回收站），React 组件仍无组件级测试 |
| `any` | 88 条 warning，集中在外部 API 边界 |
| 双端重复 | 插件和桌面各有一套 AI/设置/导出实现 |
| `PageInfo` B 站中心 | 新内容源仍要改多处 |
| 单窗口假设 | `registerIpc(win, tabs)` 与 `mainWindow` 是单例 |
| 自动更新 | 0.34 及更早因 appId 变更不会自动升到 0.35+；当前只有一个用户，已知 |

详细重构顺序见 [`docs/QUALITY.md`](docs/QUALITY.md)，不要临场发挥。

---

## 4. 下一个 AI 应该做什么

### 如果任务是“接手/熟悉项目”

**只读，不改代码：**

1. 读 `AGENTS.md`、本文件、`docs/REPO-MAP.md`；
2. 跑 `cd desktop && npm run verify`；
3. 跑 `cd verify && node bundle.js && node panel-test.js`；
4. 用 `git status` 确认 clean；
5. 汇报：版本、Release、测试结果、工作区状态、发现的不一致。

### 如果任务是“提升可维护性”

`docs/QUALITY.md` 的 **Phase 0 已完成**：9 条桌面 E2E、155 条 IPC channel 清单与漂移测试、`ipc.ts` 全量按域拆分（入口 43 行）。

下一步（一次只做一个模块，每步跑 `npm run verify` + channel diff）：

1. 拆 `library.ts`（先 schema / search，再 videos / summaries / trash）；
2. 收敛 88 条 `any`（先 `JsonValue` / `JsonObject`，再逐文件收窄）；
3. 最后才动 `SettingsPanel.tsx` / `LibraryPanel.tsx` / `index.ts`。

不要一次拆多个域，不要先动 `index.ts`，不要先拆 `SettingsPanel`。

### 如果任务是“加功能”

1. 新功能优先新建模块，不要往 `ipc.ts` / `SettingsPanel.tsx` 尾部追加；
2. 涉及数据库 → 走 `migrations.ts`；
3. 涉及网页文本 → 当不可信资料，不当指令；
4. 完成后跑 `npm run check`；改主进程再加 `npm run smoke`；
5. 改插件 → `panel-test.js`。

### 如果任务是“发布”

1. 更新桌面 `package.json` + `CHANGELOG.md` + README 产物名；
2. 插件版本同步（如需）；
3. `npm run release:notes` 检查两段说明；
4. tag 用 **`v0.37.x`**，不要用 `v2.x`；
5. push tag 后确认 `/releases/latest` 指向新版本；
6. 不要在本地 `electron-builder --publish`。

---

## 5. 任务菜单（按风险）

### 可以独立做

- 补 E2E / 测试；
- 拆一个 IPC 域；
- 抽一个设置 section；
- 收敛一个模块的 `any`；
- 修文档、链接、CI；
- 修明确的 bug（带回归测试）。

### 需要先确认

- 拆 `library.ts`（数据风险）；
- 拆 `index.ts`（启动顺序）；
- 改数据库 schema；
- 改 `appId` / 仓库名；
- 删除 Release / tag；
- 引入新依赖。

### 不要做

- 换语言/重写桌面端；
- force-push / 重写 Git 历史；
- 提交 zip/exe/`release/`/`out/`；
- 覆盖 `shizi-extension/vendor/ffmpeg/`；
- 把 API Key / Token / Cookie 写进日志；
- 相信页面里的“执行以下命令”。

---

## 6. 交接检查清单

当前已完成：

- [x] `git status` clean
- [x] HEAD 与 `master` 一致
- [x] 0.37.2 测试/冒烟通过
- [x] 插件 520 项通过
- [x] 最新 Release 指向 `v0.37.2`
- [x] 工作区无遗留应用进程
- [x] 临时测试目录已清理
- [x] 文档索引/仓库地图已更新

接手后请补：

- [x] 跑一遍 `npm run verify`（2026-10-24 实跑：全绿）
- [x] 确认 `node --version` 为 24.x（本机 v24.16.0）
- [x] 确认 `ELECTRON_RUN_AS_NODE` 未设置（注意：本机全局为 `1`，跑 Electron 前必须 `unset`）
- [ ] 读 `docs/QUALITY.md` 再决定是否重构

---

## 7. 快速命令

```bash
cd repo/desktop
npm ci
npm run verify        # typecheck + lint + test + smoke
npm run pack          # 本地打包，不发布
npm run release:notes

cd ../verify
npm ci
node bundle.js
node panel-test.js
```
