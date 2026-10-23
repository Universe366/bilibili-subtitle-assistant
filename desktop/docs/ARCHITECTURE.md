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
%APPDATA%\bsub-desktop\
├─ settings.json      设置（含 API Key / 桥 Token）
├─ library.db         SQLite：视频、字幕、总结、历史
├─ startup.log
├─ fatal.log
├─ Network\           登录 Cookie
├─ Local Storage\     前端状态
└─ Cache / GPUCache / Code Cache ...   可再生成的缓存
```

### 2.2 自定义位置

- 用户可在 `设置 → 数据与备份 → 更改位置` 选择空目录。
- 迁移成功后写：

```
%APPDATA%\bsub-desktop-location.txt
```

内容是**纯文本路径**，不是 JSON。启动时 `applyDataDirOverride()` 必须在任何
`app.getPath('userData')` 读写之前执行，把 userData 指向该目录。

- 旧目录不立即删除：迁移只负责复制并写指向文件，然后重启。
- 新进程启动后 `scheduleOldDataCleanup()` 才删除旧目录；删除失败的路径写入：

```
%APPDATA%\bsub-desktop-cleanup.txt
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
  - 删默认 `%APPDATA%\bsub-desktop`；
  - 读 `bsub-desktop-location.txt` 删自定义位置；
  - 读 `bsub-desktop-cleanup.txt` 删待清理旧目录；
  - 删更新缓存与 `%TEMP%\bsub-asr-*`；
  - 删两个指向文件。
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
  `bsub-desktop-location.txt` / `bsub-desktop-cleanup.txt` 读取。

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
| 迁移后数据没变 | `%APPDATA%\bsub-desktop-location.txt` 是否存在；启动日志 `[m0] userData` |
| 迁移后旧目录没删 | `%APPDATA%\bsub-desktop-cleanup.txt`；日志 `[data] old data dir cleanup failed` |
| 卸载没删干净 | 是否勾选删除数据；自定义位置指向文件；`%LOCALAPPDATA%\bsub-desktop-updater` |

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
  - 桌面端 `desktop/package.json`（例如 0.31.0）；
  - 插件 `bilibili-subtitle-assistant/manifest.json` 及 constants/content/page-bridge（例如 2.18.2）；
  - tag 用插件版本 `v2.18.2`，CI 会同时打包桌面安装包、绿色包、插件 zip 和 `latest.yml`；
- 发布前：`npm run typecheck`、`npm run build`、`npm run release:notes` 检查发布说明能提取；
- 本机 `release/` 不入库；CI 用 `desktop-release.yml`，push tag 即触发；
- 桌面端自动更新只对安装版生效，依赖 Release 里的 `latest.yml` 与 setup exe；
- 版本号、CHANGELOG、README 产物名必须同步，详细清单见 `docs/MAINTAINERS.md`。
