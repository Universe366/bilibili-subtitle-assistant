# 桌面端架构与维护笔记

> 读者：接手 `desktop/` 的维护者或 AI。
> 这里只记录**模块边界、数据流、不能拆的约束和已知坑**；发布流程见
> [`../../docs/MAINTAINERS.md`](../../docs/MAINTAINERS.md)。

## 1. 进程与目录

```
desktop/
├─ src/main/          Electron 主进程
│  ├─ index.ts        生命周期、窗口、托盘、启动参数、测试钩子
│  ├─ tabs.ts         WebContentsView 标签页（内嵌 B 站浏览器）
│  ├─ page.ts         页面桥调用、字幕/正文下载、PageInfo
│  ├─ dataDir.ts      自定义数据目录、迁移、旧目录清理
│  ├─ settings.ts     设置读写、迁移、预设、Skills
│  ├─ library.ts      SQLite 字幕/总结库
│  ├─ aiClient.ts     OpenAI 兼容 + Anthropic 协议
│  ├─ ai.ts           总结、章节、校对、长视频 map-reduce
│  ├─ verify.ts       联网核对、检索词、语义判定、外部补充
│  ├─ bridge.ts       扩展 ↔ 桌面本地 HTTP 桥
│  ├─ extension-install.ts  安装浏览器扩展的引导
│  └─ ipc.ts          IPC 注册与任务事件
├─ src/preload/       contextBridge API
├─ src/renderer/      React UI
│  ├─ App.tsx         窗口壳、首次引导、面板切换
│  ├─ components/     Sidebar / Subtitles / Summary / Chat / Settings / Library
│  └─ lib/            asrStore、translationStore（会话内缓存）
├─ src/shared/        类型、API 接口、平台预设
├─ build/installer.nsh  NSIS 自定义安装/卸载逻辑
└─ scripts/           sync-bridge、sync-extension、release
```

### 1.1 页面视图与渲染层

- B 站页面在 `WebContentsView` 里，是**原生层**，永远盖在 React DOM 上面。
- 任何全屏弹层（首次引导、设置向导、确认框）必须先 `setActiveViewVisible(false)`，否则用户点不到。
- 侧栏宽度/位置变化后要重新 `setBounds`，只改 CSS 不会移动原生视图。

## 2. 数据目录与迁移

### 2.1 默认位置

```
%APPDATA%\shizi\
├─ settings.json      设置（API Key 用 DPAPI 加密；桥 Token 仍为明文）
├─ permissions.json   站点权限记忆（摄像头/麦克风/通知等）
├─ library.db         SQLite：视频、字幕、总结、历史、回收站
├─ logs\              主进程日志（main-YYYY-MM-DD.log，保留 7 天）
├─ startup.log
├─ fatal.log
├─ Network\           登录 Cookie
├─ Local Storage\     前端状态
└─ Cache / GPUCache / Code Cache ...   可再生成的缓存
```

> 旧版目录是 `%APPDATA%\bsub-desktop`。0.33.0 起首次启动由
> `userDataMigration.ts` 把核心数据复制到 `shizi`，旧目录保留作回退。

### 2.2 自定义位置

- 用户可在 `设置 → 数据与备份 → 更改位置` 选择空目录。
- 迁移成功后写：

```
%APPDATA%\shizi-location.txt
```

内容是**纯文本路径**，不是 JSON。启动时 `applyDataDirOverride()` 必须在任何
`app.getPath('userData')` 读写之前执行，把 userData 指向该目录。旧版
`bsub-desktop-location.txt` 仍可读取，并会复制成新文件名。

- 旧目录不立即删除：迁移只负责复制并写指向文件，然后重启。
- 新进程启动后 `scheduleOldDataCleanup()` 才删除旧目录；删除失败的路径写入：

```
%APPDATA%\shizi-cleanup.txt
```

下次启动继续尝试。`%APPDATA%` 是固定位置，所以数据目录本身可以搬走。

### 2.3 迁移约束

- 目标必须是**空目录**；
- 不能是当前数据目录的子目录或父目录；
- 复制 `settings.json`、`library.db`、登录状态、日志；缓存类文件跳过；
- 复制前 `checkpointLibrary()` + `closeLibrary()`；失败会 `initLibrary()` 重开原库；
- 核心文件（`settings.json`、`library.db`）没复制成功就不写指向文件，不删旧数据；
- 迁移会重启应用；重启前旧进程不能再写数据。

### 2.4 卸载

- `nsis.deleteAppDataOnUninstall=false`，数据默认保留。
- 自定义卸载页提供「同时删除本地数据」勾选：
  - 删默认 `%APPDATA%\shizi` 和旧版 `%APPDATA%\bsub-desktop`；
  - 读 `shizi-location.txt`（或旧版 `bsub-desktop-location.txt`）删自定义位置；
  - 读 `shizi-cleanup.txt`（或旧版 `bsub-desktop-cleanup.txt`）删待清理旧目录；
  - 删更新缓存与 `%TEMP%\bsub-asr-*`；
  - 删新旧两套指向文件。
- 静默卸载 `/S` 不会出现数据页，默认保留数据。

## 3. 字幕链路（最重要）

### 3.1 唯一可信来源：WBI 签名接口

```
GET https://api.bilibili.com/x/player/wbi/v2?bvid=&cid=&aid=
```

必须带 WBI 签名（`w_rid` + `wts`）和登录 Cookie。

**不要用无签名的 `/x/player/v2` 作为字幕来源。** 风控降级时它会返回
**别的视频的字幕**，且每次请求返回的轨可能不同；这是「视频对、字幕串片」
的根因。社区同类项目也已经改为只走 `wbi/v2`。

页面桥 `collectSubtitleTracks()` 的行为：

1. 先请求 `wbi/v2`；
2. `code===0` 时**只返回 WBI 的轨**，包括返回 0 条；
3. 只有 WBI 失败（签名失败/网络错误）才回退到播放器实例、无签名接口、
   `__INITIAL_STATE__`、网络嗅探；
4. 回退路径仍要经过 `keepOwn` 身份过滤。

### 3.2 页面身份

- `pageIdentity()` 统一计算 `bvid/aid/cid/分P → signature`；
- `getSubtitleBundle(expectSignature)` 在采集前后校验签名，变化就丢弃；
- 渲染层先取 `PageInfo`，再带 `signature` 请求字幕；
- 返回 `bundle.identity` 不一致必须丢弃。

### 3.3 轨选择与校验（渲染层 `SubtitlesPanel.tsx`）

自动选轨不是「行数最多」，而是：

1. 末句超过视频 `duration * 1.08 + 8s` → 直接拒绝（整段合集/别片）；
2. 覆盖率低于 `minCoverageOf(duration)` → 拒绝（长视频 70%，避免 30 行广告轨）；
3. 非全片覆盖（<97%）时做标题/简介关键词校验，完全对不上 → 拒绝；
4. 通过后优先「结束时间与片长对齐」的轨，再选正文最多；
5. 被拒轨置灰；自动重取最多 4 次，仍失败显示明确错误，不硬塞错误字幕。

播放器就绪校验：`getTime()` 的时长与页面时长差超过 3% 时先等待，避免
SPA 切页瞬间拿到上一个视频的预取轨。

### 3.4 缓存

- 扩展字幕缓存 key 带 `v2` 前缀；旧缓存可能来自无签名接口，升级后全部失效。
- 桌面端字幕正文缓存 30 天，key 与视频签名/轨路径绑定。
- 转录结果（`asrStore`）和翻译结果（`translationStore`）是**渲染进程内存缓存**：
  - 按 `videoKey`（ASR）或 `videoKey + 轨路径`（翻译）保存；
  - 刷新/重新获取时恢复；
  - 编辑、优化、清空、重新转录会使对应翻译缓存失效；
  - 退出应用后丢失，这是有意的（避免过期数据长期占盘）。

### 3.5 无字幕视频

- WBI 返回 0 轨 → 显示「没有找到字幕轨」，提供重新获取 / 语音转录；
- 不要为了“有内容”回退到别的轨；
- 语音转录走当前视频音轨，天然绑定当前视频。

## 4. 总结与联网核对

- `ai.ts`：`DIRECT_SUMMARY_CHARS=40000`，超过后分块 map-reduce；
- 总结每保存一次就追加一条 `summary_versions`（每个视频保留最近 20 条）；老库启动时
  会把现有总结补成一条版本记录。恢复版本只更新 `summaries`，不会伪造新版本；
- 总结 system prompt 追加插件同款格式规则（`SUMMARY_FORMAT_RULES`），不要注入
  Skills，否则格式会跑偏；
- `verify.ts`：从字幕抽具体项 → 生成检索词 → 搜索 → 语义判定；
- 判定失败时只整理 0~3 条外部补充，不把未判定网页列表塞进总结；
- 核对卡片默认折叠；
- 流式/非流式返回都必须带 `verification`；
- **取消要能穿透**：`verifySummary` / 检索失败的分支必须检查 `signal.aborted` 再决定是否
  “继续总结”，否则取消后还会发起下一次请求；`fetchWithTimeout` 在注册监听前若已取消，
  要主动 abort（`addEventListener` 不会补发已发生的事件）。

### 4.1 任务中心（jobs）

- `library.db` 的 `jobs` / `job_items` 是所有长任务的事实来源：总结、转录、翻译、校对、
  批量总结、链接批量都以请求 id 为主键写入；
- 写入函数在 `library.ts`（`createJob` / `updateJob` / `updateJobItem` / `finishJob`），
  `setJobsListener` 以 150ms 节流把最新列表推给渲染层，刷新时不用逐个 IPC 拉；
- 任务记录是**旁路**：写库失败只打印日志，不能让总结/转录本身失败；
- 启动时 `markStaleJobs()` 把上次遗留的 running/paused 标成失败，避免任务中心永远转圈；
- 批量停止走 `AbortSignal`：`batchSummarize` / `batchUrls` 返回 `cancelled` 而不是抛错，
  已完成条目保留，未开始项由调用方标记为 skipped；
- 批量总结用 worker 池支持 1–4 并发；`paused` 只停止取新任务，已经发出的请求会跑完，
  `removed` 只对尚未开始的条目生效。并发数写进 job 的 `meta_json`，重试失败项时沿用；
- 新增长任务时：创建 job → 进度写 `updateJob` → 结束必须 `finishJob`，
  否则任务会一直停在“进行中”。

### 4.2 库数据模型（`library.ts`）

所有表都在 `library.db`，`SCHEMA` 使用 `CREATE TABLE IF NOT EXISTS`，升级只能做加法：

| 表 | 作用 |
|---|---|
| `videos` / `tracks` / `segments` / `segments_fts` | 视频、字幕轨、行、FTS5 trigram 索引 |
| `summaries` / `summary_versions` | 当前总结 + 最近 20 个版本 |
| `notes` / `note_versions` | 当前笔记 + 最近 20 个版本（清空笔记会一并清空版本） |
| `tags` / `video_tags` | 标签与多对多关联 |
| `collections` / `collection_items` | 合集与多对多关联 |
| `collection_summaries` / `collection_summary_versions` | 合集对比 + 最近 20 个版本 |
| `jobs` / `job_items` | 任务与逐项状态 |
| `exports` | 导出登记（最近 100 条，只记路径不存文件） |
| `trash` | 回收站快照（删除前保存完整条目，30 天 / 200 条上限） |
| `schema_migrations` | 已执行的 schema 迁移记录 |

约束：

- 删除视频/合集会级联删除版本、关联、索引；`removeVideo(s)` 之后调用 `pruneOrphans()`
  清理空标签/空合集；
- 版本写入前先查最新内容，相同就不写，避免自动保存把 20 条配额刷满；
- 老库迁移：启动时把现有总结、合集对比补成一条版本；`note_versions` 从空开始；
- `collection_summaries` 与 `collection_summary_versions` 的 `item_count/model` 只做展示，
  不参与生成逻辑。

### 4.3 搜索

- `searchLibrary`：标题/UP/标签/合集/笔记 → 视频行；字幕走 FTS5 trigram，短词退化为 LIKE；
- `searchSummaries`：总结正文，返回视频维度的片段；
- `searchCollectionSummaries`：合集对比正文，返回合集维度的片段；
- `globalSearch` 合并三组，`Ctrl+K` 面板按“视频 / 字幕 / 总结 / 合集对比”分组；
- 搜索词按空格拆分 AND；`snippetAround` 只做展示，不要把命中片段写回库。

### 4.4 合集对比与 B 站合集导入

- `collectionSummary.ts`：优先取合集内各视频已保存总结，缺失时回退到字数最多的字幕轨；
  每视频截断 1.2 万字、总量 9 万字，prompt 固定输出速览表/共识/分歧/观看顺序；
  结果写入 `collection_summaries` 并追加版本；
- `biliCollection.ts`：调用 `api.bilibili.com/x/web-interface/view?bvid=`，
  优先 `ugc_season.sections[].episodes[]`（UP 合集），否则 `pages[]`（多 P），
  生成带 `?p=N` 的链接；单集返回 `kind='single'`；
- 导入统一走 `batchUrls`：主进程开后台标签逐个抓字幕，任务中心记录逐项状态；
  “识别合集”只负责展开链接，不直接写库；
- 若 B 站接口风控/需要登录，解析会返回可读错误；不要在前端重试风暴。

### 4.5 导出记录

- `export:save`（字幕）和 `file:save-text`（笔记/总结/合集对比）写文件成功后调用
  `addExportRecord`；
- 只登记路径，不复制文件；`exports:open` / `exports:reveal` 调系统默认程序；
- 清空只删记录，不删磁盘文件；
- 导出失败不要登记，避免列表里出现坏路径。

## 5. 封面与图片

B 站图片 CDN 按 Referer 防盗链：`localhost` / `file://` 会 403。

- 渲染页 `index.html` 已加 `<meta name="referrer" content="no-referrer">`；
- 新增图片请求不要覆盖成发送本地 Referer；
- 不要把封面改成经过主进程代理，除非要处理鉴权/缓存。

## 6. 安装器（NSIS）

### 6.1 当前配置

- `nsis.allowToChangeInstallationDirectory=true`；
- `build/installer.nsh` 定义 `.onVerifyInstDir`：
  - 浏览/输入一个**已存在**的父目录后，立刻追加 `B站字幕助手` 并刷新输入框；
  - 已以程序名结尾不重复追加；
  - 进入安装页后 electron-builder 的 `instFilesPre` 不会再重复追加。
- 新输入的不存在路径不会被逐字创建，避免产生一堆中间目录；需要新父目录时
  用浏览对话框里的「新建文件夹」。

### 6.2 不能踩的坑

- `MUI_PAGE_CUSTOMFUNCTION_LEAVE` 是**全局** define：它会同时接管「安装模式」页，
  卸载器构建会报 `Call must be used with function names starting with "un."`。
  不要用它做目录追加。
- `customPageAfterChangeDir` 在 `installer.nsh` 里不一定可用：electron-builder
  的 include 位置在安装页之后，`!ifmacrodef` 不会展开。不要依赖它。
- NSIS 开了 `-WX`：未引用函数、宏参数错误都会让构建失败。
- 改完 `installer.nsh` 必须真的打一次包：

```bash
cd desktop
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win nsis --publish never \
  --config.electronDist=node_modules/electron/dist
```

`--config.electronDist` 用本地 Electron 目录，避开网络证书问题；正常发布
不需要这个参数。

### 6.3 卸载页变量

- `Var DeleteAppData` 必须放在 `customUnWelcomePage` 宏里；顶层 `Var` 会
  被安装器/卸载器都编译到，容易冲突。
- 自定义数据目录是运行时才知道的，uninstaller 只能通过
  `shizi-location.txt` / `shizi-cleanup.txt`（兼容旧版 `bsub-desktop-*`）读取。

## 7. 扩展桥

- 本地 HTTP `127.0.0.1:47821`，Bearer Token；
- `GET /v1/hello` 提供端口/Token 发现，网页来源 `https://` 会被拒绝；
- 扩展侧 `desktop-bridge.js` 自动扫描 47821–47830；
- 修改桥 API 后同步：
  - `desktop/src/main/bridge.ts`
  - `bilibili-subtitle-assistant/src/sidepanel/modules/desktop-bridge.js`
  - `docs/BRIDGE.md`

## 8. 构建与测试

```bash
cd desktop
npm run typecheck
npm run build          # prebuild 会同步 page-bridge 和 resources/extension
npm run dev            # Electron + Vite
```

扩展侧：

```bash
cd verify
node bundle.js
node panel-test.js     # 至少跑这个
```

发布前检查：

- `desktop/package.json` 版本 > 最新 Release；
- `desktop/CHANGELOG.md`、`desktop/README.md` 的产物名同步；
- `bilibili-subtitle-assistant/manifest.json` / constants / content / page-bridge
  版本一致；
- `verify/package.json` 可按需同步；
- `release/` 不提交。

## 9. 常见故障定位

| 现象 | 先看 |
|---|---|
| 字幕是别的视频 | `sources` 是否包含 `player/v2`；WBI 是否失败；`[subtitle-coverage]` / `[subtitle-content]` 日志 |
| 字幕一直转圈 | 是否同一 URL 重取；`trackNonce`；重试上限 4 |
| 封面空白 | 渲染页 Referer；`<meta name="referrer">` |
| 安装目录不能输入新路径 | `.onVerifyInstDir` 是否生效；是否把 `allowToChangeInstallationDirectory` 改回 false |
| 迁移后数据没变 | `%APPDATA%\shizi-location.txt` 是否存在；启动日志 `[m0] userData` |
| 迁移后旧目录没删 | `%APPDATA%\shizi-cleanup.txt`；日志 `[data] old data dir cleanup failed` |
| 卸载没删干净 | 是否勾选删除数据；自定义位置指向文件；`%LOCALAPPDATA%\shizi-updater` |

## 10. 界面信息架构（0.31+）

侧栏只保留五个入口，**不要再随意加一级入口**：

| 入口 | 职责 |
|---|---|
| 字幕 | 当前视频的信息、字幕轨、转写/翻译/校对/入库/合集导入 |
| 总结 | 当前字幕的总结、章节、问答；版本与 diff |
| 对话 | 基于字幕/总结的问答与工具调用 |
| 库 | 所有已入库内容：搜索、筛选、详情、标签/合集、批量、笔记、合集对比、导入链接 |
| 设置 | AI、字幕、搜索、插件桥、数据与备份 |

库顶部的四个动作是固定主线：

- **＋合集**：新建空合集，之后在「选择」模式里加视频；
- **导入链接**：单条/多条链接；可先「识别合集 / 多 P」再整包导入；
- **筛选**：排序、标签、合集、管理标签/合集都收在这里；
- **选择**：进入多选后底部才出现批量总结、加标签、加合集、删除。

任务与导出统一在侧栏底部「任务」抽屉：`任务` 页签看进度/暂停/取消/重试，
`导出` 页签看历史导出。不要再为“记录/批量”新增侧栏项，也不要恢复已删除的
`BatchPanel` / `HistoryPanel`（历史见 git）。

空状态必须给下一步：空库 →「打开 B 站 / 导入链接」；空合集 →「选择视频加入」。

## 11. 发布与版本

- 一次合并发布包含桌面端与插件两个版本号：
  - 桌面端 `desktop/package.json`（例如 0.32.0）；
  - 插件 `bilibili-subtitle-assistant/manifest.json` 及 constants/content/page-bridge（例如 2.18.2）；
  - tag 用插件版本 `v2.18.2`，CI 会同时打包桌面安装包、绿色包、插件 zip 和 `latest.yml`；
- 发布前：`npm run typecheck`、`npm run build`、`npm run release:notes` 检查发布说明能提取；
- 本机 `release/` 不入库；CI 用 `desktop-release.yml`，push tag 即触发；
- 桌面端自动更新只对安装版生效，依赖 Release 里的 `latest.yml` 与 setup exe；
- 版本号、CHANGELOG、README 产物名必须同步，详细清单见 `docs/MAINTAINERS.md`。

## 12. 加固与可观测性（0.31.x）

这一层是「加功能之前先补的地基」，改动集中在主进程启动路径，后续不要绕过。
验收命令与手工测试记录见 [`HARDENING.md`](HARDENING.md)。

### 12.1 单实例

`index.ts` 在模块顶层调用 `app.requestSingleInstanceLock()`：

- 拿不到锁直接 `app.quit()`，避免第二个进程共用 `library.db` / 桥端口，
  并在 `initLibrary()` 里把第一个实例的运行中任务标成失败；
- 拿到锁时监听 `second-instance`：显示已有窗口，并把命令行里的 http(s) URL 作为新标签打开。

### 12.2 API Key 加密

- `secrets.ts`：`sealSecret` / `openSecret`，前缀 `enc:v1:`，底层是 `safeStorage`（Windows DPAPI）；
- `settings.ts` 的 `loadSettings()` 解密、`saveSettings()` 加密，内存里始终是明文；
- 启动时 `migrateSettingsSecrets()` 把老版本明文原地加密；
- 导出设置、数据备份、诊断包都走 `stripSecrets()`，**不含 Key 与桥 Token**；
- 恢复备份时 `restoreSettingsFromBackup()` 用「合并」而不是覆盖，保留本机 Key；
- 解密失败（换机器/换账户）返回空串，让用户重填，不能把密文当 Key 发出去。

### 12.3 站点权限

`permissions.ts`：

- 应用自己的渲染进程（按 webContents.id 判断）直接放行；
- 普通网站首次请求摄像头/麦克风/通知/剪贴板/位置时弹窗，可记住选择；
- 选择写入 `permissions.json`，默认全部拒绝；
- `setDevicePermissionHandler` 一律拒绝 HID/串口；
- `fullscreen` / `pointerLock` / `clipboard-sanitized-write` 视为安全权限直接放行。

### 12.4 生产 CSP

`csp.ts` 只给应用 UI 的响应加 `Content-Security-Policy`，按 `webContentsId` 过滤，
内嵌网页完全不受影响；开发模式跳过，避免挡住 Vite HMR。

### 12.5 日志与诊断

- `logger.ts` 安装一次 console 钩子，把主进程日志写到 `logs/main-YYYY-MM-DD.log`，保留 7 天；
- 落盘前脱敏（`sk-*`、`Bearer`、apiKey/token 字段）；
- 设置 → 诊断 → **导出诊断包**：版本、数据规模、脱敏设置、站点权限、日志，
  不包含字幕/总结正文与 Key。

### 12.6 schema 迁移与回收站

- `migrations.ts`：`PRAGMA user_version` + 顺序迁移，`LATEST_SCHEMA_VERSION = 4`；
  新加列/表必须新增一个迁移版本，不能改老迁移；
- `trash` 保存删除前的完整快照（视频、所有字幕轨、总结与版本、笔记与版本、标签、合集），
  恢复时重新插入并重建 FTS 索引；
- 删除统一走 `removeVideos(ids, { trash: false })` 才是彻底删除；
- 启动时清理 30 天前与第 200 条之后的回收站记录；
- 设置 → 数据与备份 → **压缩数据库**：`wal_checkpoint` + `PRAGMA optimize` + `VACUUM`。

### 12.7 测试与 CI

- `npm run lint`：ESLint flat config；存量 `any`/未使用变量以 warning 呈现，错误会阻塞；
- `npm test`：Vitest，覆盖 URL 归一化、导出格式、选轨、密钥加解密、schema 迁移、
  回收站恢复、备份校验、诊断包；
- `.github/workflows/desktop-ci.yml`：PR / push main 跑 typecheck + lint + test + build。

### 12.8 已知取舍

- `safeStorage` 的同步 API 在 Electron 45 已标记 deprecated；改成 async 会牵动
  `loadSettings()` 的所有同步调用点，暂时保留并在升级 Electron 大版本时处理；
- 权限弹窗在回调前是异步的，窗口关闭后回调仍会执行，但已做 `isDestroyed` 判断；
- 回收站快照按 JSON 存库，超大字幕（数万行）会明显增大 `library.db`，上限与 30 天清理是兜底。

## 13. 浏览器基础盘与 AI 上下文（0.32 开发中）

### 13.1 浏览器数据（schema v3）

`history` / `bookmarks` / `downloads` 三张表在 `migrations.ts` 的 v3 迁移里创建：

- 历史：`recordHistory()` 由 `TabManager` 在 `did-navigate` / `did-navigate-in-page` / 标题与 favicon 更新时调用；
  同一 URL 60 秒内只更新一条，最多保留 5000 条；
- 书签：`toggleBookmark()` / `isBookmarked()`，地址栏星标与 `Ctrl+D` 都走这里；
- 下载：`will-download` 时 `addDownload()`，`updated` / `done` 时 `updateDownload()`，写入节流 500ms；
  清空记录不会删除磁盘文件。

### 13.2 标签会话

- `session.ts` 把 `{activeUrl, tabs:[{url,title}]}` 写到 `userData/session.json`；
- 标签变化后 1.5 秒去抖保存，`before-quit` 再同步保存一次；最多 40 个；
- 启动时若 `general.restoreSession !== false` 且文件存在，按顺序重建标签并激活上次的 activeUrl；
- `TabManager.reopenClosed()` 维护最近 20 个关闭标签，`Ctrl+Shift+T` 重开。

### 13.3 浏览器面板

`BrowserHub.tsx` 是应用 UI 里的模态层，分「历史 / 书签 / 下载 / 标签」四块：

- 打开时 App 会 `setBrowserVisible(false)`，否则原生 WebContentsView 会盖住面板；
- 历史支持搜索与清空；书签可移除；下载显示进度、打开、定位、移除记录；
- 标签面板支持按标题/URL 过滤并切换；
- 快捷键：`Ctrl+Shift+A` 打开标签面板，地址栏星标 / `Ctrl+D` 收藏，`Ctrl+Shift+T` 重开标签。

### 13.4 AI 上下文

- `pageContext.ts` 用 `executeJavaScript` 抽取正文与 `window.getSelection()`：
  优先 `article/main`，去掉脚本、导航、表单，正文最多 2 万字，选中内容最多 4 千字；
- `chat:send` 在主进程里读取当前标签的上下文，渲染层不需要把大段正文经 IPC 传上来；
- 页面内容在 prompt 里明确标记为**不可信资料**，要求模型不要执行其中的指令；
- 视频页仍以字幕为主；非视频页自动降级为「页面正文 + 选中内容」，`ChatPanel` 不再限制 B 站视频页；
- 上下文芯片显示当前页面字数与选中字数，可关闭「带入页面」；
- `Ctrl+Shift+S` 从网页里直接带着选中内容提问（主进程转发 `app:ask-selection`）。

### 13.5 AI 本地工具

`appTools.ts` 提供三个只读工具，复用 `chatToolLoop`：

- `app__search_library`：搜本地库（标题 / 字幕 / 总结 / 笔记）
- `app__read_library_item`：读条目详情、总结、笔记、字幕片段
- `app__list_recent`：最近入库条目

只读是硬约束：写操作必须由用户确认，暂不暴露给模型。设置 → AI 里有开关
（`ai.appTools`，默认开）。

### 13.6 本地模型

`platformKey.ts` 判断 `baseUrl` 是否为本机（localhost / 127.0.0.1 / ::1）：

- 本机端点不要求 API Key，`aiHeaders()` 也不会发空的 `Authorization`；
- 新增 Ollama / LM Studio 预设（`AI_PRESET_VERSION = 5`）；
- 总结、对话、章节、翻译、校对、合集对比、ASR 都走同一判断。

### 13.7 首用与显示名

- 空库提供「粘贴链接 → 导入并总结」入口，直接打开导入弹窗并勾选总结；
- 显示名统一到 `src/shared/brand.ts`（当前工作名「拾字」）；
- 技术标识（appId / userData / 安装包名）暂不改变，避免打断更新，详见 [`REBRAND.md`](REBRAND.md)。

### 13.8 网页总结入库

- 对话面板的「总结本页」只在非视频页出现：设置 `autoSaveRef` 后发送固定提示词，并在
  `chat:done` 时调用 `library:save-page-summary`；
- 主进程用 `PageInfo {kind:'page', url, title, bvid:null}` 调 `saveSummary()`，
  `uidOf()` 会生成 `u:<url>`，因此同一网页再次总结会覆盖当前总结并追加版本；
- 这种条目没有字幕轨（`bundle === null`），库详情页已经支持「只有总结」的展示；
- 地址栏星标、历史、下载与网页总结共用同一套 `library.db`，不需要额外文件。

### 13.9 本地音视频导入

- `local:import`：`dialog.showOpenDialog` 选文件（自动化可用 `BSUB_LOCAL_MEDIA` 绕过）；
- `media.ts` 用 ffmpeg 的 stderr 解析时长；`transcribeFile()` 复用现有 ASR 管线；
- 入库时构造 `PageInfo {kind:'local', url:file:///..., title:文件名}`，字幕轨 `source='local'`，
  库详情里用系统默认播放器打开（`library:open-source` 校验 URL 与文件存在），不会走地址栏 `normalizeUrl`；
- 任务中心用 `asr` job 记录进度；`asrControllers` 注册同一个 requestId，取消按钮可中止；
- 下载的自动化测试钩子：`BSUB_DOWNLOAD_DIR` 有值时跳过保存对话框。

## 14. YouTube 适配（0.32 开发中）

`youtube.ts` 不调用需要签名的 InnerTube 接口，而是读取页面自身的
`ytInitialPlayerResponse`：

- `youtubeVideoId()` 识别 `watch?v=` / `youtu.be` / `shorts` / `embed` / `live`；
- `readYouTubeData()` 用 `executeJavaScript` 取 `videoDetails` 与 `captionTracks`，
  5 秒内按 WebContents 缓存；页面没有 playerResponse 时返回 `null`，由上层显示无字幕；
- 字幕 URL 统一补 `fmt=json3`，主进程 `getTrackBody()` 允许 youtube.com / google.com 域名，
  先用 `parseJson3()`，失败再退化到 `parseTimedTextXml()`；
- `getPageInfo()` / `getSubtitles()` / `getTime()` / `seek()` 在 `page.ts` 里按 URL 分派，
  YouTube 走页面 DOM（`video.currentTime`），B 站继续走页面桥；
- `videoKeyOf()` 用 `y:<videoId>`，忽略 `t` / `list` 参数；
- 字幕的 `source='youtube'`，入库、总结、搜索、导出复用现有链路；
- 「导入链接」的批量解析也接受 YouTube 单条视频；
- 限制：YouTube 暂不支持语音转录（`转写`按钮置灰），合集解析仍是 B 站专属。

### 13.10 划词工具条

- `selectionToolbar.ts` 导出注入脚本，`TabManager.prepare()` 在目标页加载前通过
  `Page.addScriptToEvaluateOnNewDocument` 注入；开关是 `general.selectionToolbar`（默认开）。
- 脚本用 Shadow DOM + CSSOM 画「解释 / 翻译 / 总结」三个按钮，监听 `mouseup` 和
  `getSelection()`，不侵入站点自己的选区逻辑；
- 页面通过 CDP `Runtime.addBinding('__bsubSelectionAction')` 把 `{action,text}` 送回主进程，
  主进程转发 `app:selection-action`，App 切到「对话」并把动作派发给 `ChatPanel`；
- `ChatPanel` 自动发送带引用的提示词，并强制 `includePage`，页面正文仍作为不可信资料；
- 站点如果拦截内联样式，工具条可能没有圆角/阴影，但按钮与事件仍然可用。

### 13.11 播客 / RSS 导入

- `podcast.ts` 解析 RSS 2.0 + iTunes 扩展：`channel.title`、`item`、`enclosure url`、
  `itunes:duration`、`link`、`guid`；最多 60 集，单文件上限 8MB；
- `podcast:preview` 只读取订阅、不下载音频；`podcast:import` 在后台下载音频到
  `%TEMP%/bsub-podcast-<requestId>`，用 ffprobe 同款 ffmpeg 时长解析，再走 `transcribeFile()`；
- 入库 `PageInfo {kind:'podcast', url:单集页面或音频地址}`、字幕轨 `source='podcast'`；
- 任务记在 `jobs`（type=asr），取消走 `asrControllers`；结束后删除临时音频；
- 只支持 RSS 2.0 的 `<item>`，Atom 仅做格式识别，不承诺完整解析。

### 13.12 阅读模式

- 地址栏书本按钮或 `Alt+R`（网页内由 TabManager 转发 `app:reader`）打开 `ReaderMode`；
- 主进程 `page:document` 复用 `readPageContext()`，把上限放宽到 20 万字，只返回标题/URL/纯文本；
- 渲染层用 `reader.ts` 拆段并生成 Markdown：复制、保存 `.md`、跳转原网页、调字号；
- 「AI 总结」关闭阅读层、切到「对话」并派发 `bsub:reader-summary`，由 ChatPanel 自动发送总结提示词；
- 页面没有正文时显示明确错误，不会打开空白阅读层。

### 13.13 下载控制与清除浏览数据

- `downloads.ts` 保存活跃的 Electron `DownloadItem`（按 `downloads.id`），`done` 后移除；
- `downloads:control` 支持 pause / resume / cancel，并把状态写回 `downloads.state`；
- 下载面板对进行中的任务显示暂停/继续/取消，完成的任务才显示打开/定位；
- `browser:clear-data` 调用 `session.clearStorageData`（cookies / localstorage / indexdb /
  serviceworkers / cachestorage 等）、`clearCache()`、`clearAuthCache()`；
- 清除会登出所有站点，UI 必须二次确认；不会删除本地字幕库和设置。

### 13.14 items 类型（schema v4）

- `videos` 新增 `kind` / `source`：`video`、`youtube`、`page`、`podcast`、`local`；
- 迁移 v4 按 URL 回填老数据；`ensureVideo()` 在入库时写入，`restoreTrash` 一并恢复；
- `LibraryVideo` 带出类型，库列表/详情按类型展示，不再把网页当成 0 秒视频；
- 网页总结 uid 用 `canonicalUrl()` 去掉 `utm_*`、`spm_id_from`、`vd_source` 和锚点。

### 13.15 AI 上下文与对话持久化

- `pageContext.ts` 的注入脚本遍历 DOM，输出 Markdown 风格文本：
  标题保留 `#` 层级，列表 `-`、表格 `|`、代码块 ```；
- `selectRelevantChunks()` 把长文切成约 2.2k 的块，按问题关键词粗排，
  始终保留开头，再按原文顺序拼到 1.8 万字预算；
- 对话消息按 `videoKey` 存 `localStorage`（最多 60 条），切标签/重启后恢复；
- 对话面板显示正文的粗略 token 估算，便于判断请求成本。

### 13.16 站点权限管理

- 权限闸门的选择写入 `permissions.json`；
- 设置 → 站点权限通过 `permissions:list` / `permissions:revoke` 查看和撤销；
- `permissions:clear` 仍保留为一次性清空。

### 13.17 桌面冒烟

- `npm run smoke` 启动真实 Electron（临时 userData + CDP），验证窗口标题、
  preload API、版本号和标签页；
- 脚本提交在 `scripts/smoke.mjs`；Linux CI 需要 xvfb，目前只在本地/Windows 跑。
