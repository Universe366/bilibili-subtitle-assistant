# 维护者手册

> 读者：下一个接手仓库的人（或 AI）。这里只记录**发布流程、易踩坑和不能随便改的约束**。
> 桌面端模块/数据流/安装器细节见 [`../desktop/docs/ARCHITECTURE.md`](../desktop/docs/ARCHITECTURE.md)；
> 环境限制与历史复盘见 [`../bilibili-subtitle-assistant/AGENTS.md`](../bilibili-subtitle-assistant/AGENTS.md) 和
> [`../bilibili-subtitle-assistant/docs/history/DEVELOPMENT-LOG.md`](../bilibili-subtitle-assistant/docs/history/DEVELOPMENT-LOG.md)。

## 1. 仓库地图

| 路径 | 作用 |
|---|---|
| `bilibili-subtitle-assistant/` | 扩展运行时（加载这一层，不是仓库根目录） |
| `bilibili-subtitle-assistant/src/background/` | Service Worker：RPC、平台适配、检索、缓存 |
| `bilibili-subtitle-assistant/src/content/` | `page-bridge.js`（MAIN world）+ `content.js`（ISOLATED） |
| `bilibili-subtitle-assistant/src/sidepanel/` | 侧边栏 / 内嵌面板 UI |
| `bilibili-subtitle-assistant/src/shared/` | 设置、常量、存储、校验 |
| `desktop/` | Windows 桌面端（Electron + React + SQLite） |
| `desktop/src/main/` | 主进程：窗口、WebContentsView 标签、CDP 注入、IPC、更新、托盘 |
| `desktop/src/main/dataDir.ts` | 自定义数据目录、迁移、旧目录清理 |
| `desktop/src/renderer/` | 桌面端 React UI（浏览器区域 + 侧栏 + 设置） |
| `desktop/src/renderer/src/lib/` | ASR / 翻译会话缓存 |
| `desktop/build/installer.nsh` | NSIS 自定义安装目录与卸载页（可选删除本地数据） |
| `verify/` | 测试与发布脚本（不属于扩展运行时） |
| `docs/screenshots/` | README / 商店用界面截图 |
| `docs/EDGE-STORE.md` | Edge 提交材料、权限理由、认证备注 |

## 2. 发布前检查清单

### 2.1 版本号必须同步

一次版本 bump 至少检查这些位置：

```text
bilibili-subtitle-assistant/manifest.json                     2.18.1
bilibili-subtitle-assistant/src/shared/constants.js          VERSION
bilibili-subtitle-assistant/src/content/content.js            CONTENT_VERSION
bilibili-subtitle-assistant/src/content/page-bridge.js        bridge version
desktop/package.json                                          0.30.12
desktop/package-lock.json                                     顶层与 packages[""].version
desktop/README.md / CHANGELOG.md                              产物名与版本说明
verify/package.json                                           测试包版本（按需同步）
```

`verify/panel-test.js` 里的「构建指纹」断言最容易漏；扩展版本改动后先跑
`node panel-test.js`，再跑浏览器冒烟。

### 2.2 跑测试

```bash
cd verify
npm install
node bundle.js
npm test                    # 21 个 node 套件
npm run test:browser:smoke  # 真实扩展冒烟，需要本地 Edge/Chrome + 网络
```

浏览器冒烟覆盖：

- 内嵌面板 Shadow DOM / 折叠 / 关闭；
- B 站评论区是否被卸载；
- 侧边栏「▣」开关的返回值；
- 设置页真实渲染。

Chromium 153+ 可能禁用 `--load-extension`；脚本会输出 `SKIP`，不要把它当失败。可用 `BROWSER_PATH` 指定浏览器。

### 2.3 打包与发布

```bash
# Edge 商店包（manifest.json 必须在 zip 根目录）
git archive --format=zip -o edge-<ver>.zip HEAD:bilibili-subtitle-assistant \
  manifest.json rules.json src vendor icons _locales LICENSE \
  THIRD-PARTY-NOTICES.md LICENSES

# GitHub Release（会生成 release-notes 并上传 zip）
cd verify
GITHUB_TOKEN=... NODE_OPTIONS=--use-system-ca node tools/release.mjs --create --update
```

`GITHUB_TOKEN` 不要写进脚本或 README；用本机 credential helper 临时取。

### 2.4 Edge 商店

- 包内不能带 `verify/`、`docs/`、`.git`、测试文件；
- `_locales` 必须存在，`default_locale` 为 `zh_CN`；
- 英文 `short_name` ≤12 字符；
- 权限理由、隐私政策 URL、认证备注见 `docs/EDGE-STORE.md`；
- 商店审核期间不要中途换包；审核通过后再提交新版本更新。

### 2.5 桌面端（desktop/）

#### 构建与打包

```bash
cd desktop
npm install
unset ELECTRON_RUN_AS_NODE        # Windows 本机若设置过，必须清掉
npm run typecheck
npm run dist                      # NSIS + 绿色包 + latest.yml
```

- 国内下载 Electron 失败时用镜像：
  `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`，
  `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
- `ffmpeg-static` 约 82MB，已配置 `asarUnpack`；不要把它打进 asar，否则 ASR 找不到可执行文件。
- 打包产物在 `desktop/release/`，已被 `.gitignore` 忽略，不要提交。
- 本机证书下载失败时，可复用已安装的 Electron 目录先验证 NSIS：
  `npx electron-builder --win nsis --publish never --config.electronDist=node_modules/electron/dist`；
  正式发布不要带这个参数。

#### 版本与发布

- 桌面版本在 `desktop/package.json`，同步更新 `desktop/CHANGELOG.md`、`desktop/README.md` 的产物名和版本说明。
- 发布仍用**合并 Release**：一个 `v*` tag 同时带插件 zip 与桌面 setup/green/latest.yml。
- CI 是 `.github/workflows/desktop-release.yml`；构建必须带 `--publish never`，由 workflow 自己创建 Release，否则 electron-builder 会抢先自动发布。
- 自动更新读取最新 Release 里 `latest.yml` 指向的 **ASCII 文件名**；`artifactName` 和 `latest.yml` 必须一致（当前 `bsub-desktop-setup-${version}.exe`）。
- 当前最新 Release 的桌面资产可能落后于源码；发布前先确认 `desktop/package.json` 版本高于 Release 资产，否则客户端会显示“已是最新”。

#### 自动更新

- `electron-updater` + GitHub provider；`autoCheck` 默认开启，`autoDownload` 默认关闭，安装仍要重启。
- 只有**安装版**能自动更新；绿色版手动替换。
- 自定义 generic 源通过设置 `update.feedUrl`，修改后下次启动生效。
- 未签名时 SmartScreen 仍会提示；签名后再谈“无感更新”。

#### 数据目录、迁移与卸载

- 默认数据在 `%APPDATA%\bsub-desktop`；设置 → 数据与备份 → 更改位置可迁移。
- 自定义位置写在 `%APPDATA%\bsub-desktop-location.txt`（纯文本路径）；启动时
  `applyDataDirOverride()` 必须早于任何 `userData` 读写。
- 迁移只复制、不立即删旧目录；新进程启动后 `scheduleOldDataCleanup()` 删除旧目录，
  失败路径写入 `%APPDATA%\bsub-desktop-cleanup.txt`，下次启动重试。
- 复制前 `checkpointLibrary()` + `closeLibrary()`；核心文件未复制成功不写指向、不删旧数据；
  失败会 `initLibrary()` 重开原库。
- 安装包 `nsis.include=build/installer.nsh`，`deleteAppDataOnUninstall=false`。
- 自定义卸载页默认只删程序；勾选后删除默认数据目录、自定义位置（读指向文件）、
  待清理旧目录、`%LOCALAPPDATA%\bsub-desktop-updater` 和 `%TEMP%\bsub-asr-*`。
- 静默卸载 `/S` 不会弹数据页，默认保留数据。
- NSIS 开了 `-WX`（警告即错误）：`Var` 不能声明在安装器也会编译到的顶层；当前把
  `Var DeleteAppData` 放在 `customUnWelcomePage` 宏里。
- 安装目录页用 `.onVerifyInstDir` 立即补全 `父目录\B站字幕助手`；
  不要用全局 `MUI_PAGE_CUSTOMFUNCTION_LEAVE`（会接管安装模式页并让卸载器构建失败）。
- 改 `installer.nsh` 后必须真的打一次包验证 NSIS 编译。

### 2.6 代码签名

- 工作流已预留 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` 两个 Secrets；为空时走未签名构建。
- 签名后必须用 `signtool verify /pa /v` 验证 setup 与主 exe，并检查时间戳。
- 更换证书前先测试旧版本自动更新；publisher 不一致会导致更新失败，保留手动下载入口。
- 详细流程见 [`SIGNING.md`](SIGNING.md)。

### 2.7 总结核对、字幕身份与 Markdown

**总结核对链路**（`desktop/src/main/verify.ts`、`ai.ts`）：

- 从字幕分段抽具体项（数字/年份/版本/术语），用命中行前后 2 行构造上下文窗口。
- 搜索用上下文整句，相关性过滤用**短标签**（如 `500次` / `IPHONE`），不要把整句拿去做相关性，否则证据会被全杀。
- 只把有证据的项展示到核对面板；语义判定失败时保留原始证据，不要静默清空。
- **流式和非流式返回都必须带 `verification`**。0.30.6 之前的 bug 是非流式有、流式漏，导致界面看不到核对。
- 输出上限走 `settings.ai.maxTokens`（当前 64000）；字幕上下文 `MAX_TRANSCRIPT_CHARS=200000`，不要再用 30000 截断。
- `buildVerifyBlock` 抛错不能丢掉已判定的 `verification`；先赋值，再格式化。

**字幕身份**：

- **只信 WBI 签名接口 `/x/player/wbi/v2`**。无签名的 `/x/player/v2` 在风控降级时会
  返回别的视频的字幕，且请求间结果会变；它是「视频对、字幕串片」的根因。
- 页面桥先请求 WBI；`code===0` 时只返回它的结果（包括 0 条）；播放器实例、
  无签名接口、`__INITIAL_STATE__`、网络嗅探只在 WBI 失败时兜底。
- IPC `page:subtitles` 接收 `expectSignature`；页面桥 `getSubtitleBundle` 用它做 identity guard。
- 渲染层先取 `PageInfo`，再带 `signature` 请求字幕；返回 `bundle.identity` 不一致必须丢弃。
- 自动选轨：末句超出片尾 8%+8s、覆盖率低于 `minCoverageOf(duration)` 直接拒绝；
  非全片覆盖再做标题/简介关键词校验；通过后优先「结束时间与片长对齐」的轨，再选正文最多。
  不要无脑选最长轨。
- 播放器时长未就绪时先等待；被拒轨重取最多 4 次，仍失败显示明确错误，不硬塞。
- 无官方字幕视频优先显示空状态 + 转录；不要把上一页的 `track` 状态留着。
- 扩展字幕缓存 key 带 `v2`；旧缓存可能来自无签名接口，升级后必须失效。

**总结跨页**：

- 切浏览器标签时不要取消 `summarize`、不要清空流式状态；用 `streamingRef` 防止新标签的已保存总结覆盖当前生成。
- 切走侧栏分组会卸载 SummaryPanel，仍会丢失界面监听；要彻底解决需要把总结任务提升到全局 store。

**Markdown**：

- 桌面端是自写解析器（`Markdown.tsx`），不是 react-markdown；新增语法必须补解析和 CSS。
- 已支持 GFM 表格；改动后用 `react-dom/server` 静态渲染一段表格验证 `<table>` 输出。
- 长字幕行是单行横向滚动，表格容器单独 `overflow-x:auto`，不要互相影响。

## 3. 不能随便改的约束

### 3.1 内嵌面板：Shadow DOM + 延迟挂载

- 面板内部必须放在 `attachShadow({mode:'open'})` 里。B 站右侧栏脚本会遍历 light DOM 子节点并调用 `setAttribute`；直接放按钮/iframe 会抛 `HierarchyRequestError`，导致**评论区被卸载、页面点击失效**。
- 面板必须在 B 站首屏稳定后再插入（当前约 2.2s；切页后约 1.8s）。过早插入会打断 B 站自己的 DOM 初始化。
- 右侧栏重建时**复用已有 iframe**，不要 remove 后重建；否则会白闪/重载。
- 修改挂载逻辑后必须跑 `npm run test:browser:smoke`，并确认评论区还在。

### 3.2 侧边栏开关

- `chrome.sidePanel` 没有可靠的 `isOpen()`；当前用侧边栏页面建立的 `bsub:sidepanel` 长连接端口判断。
- 端口断开后会自动重连；不要删掉重连逻辑，否则 service worker 休眠后第一次点击会误判。
- 关闭优先用 `chrome.sidePanel.close()`；旧内核回退为禁用再启用。
- 侧边栏页面的 `chrome.runtime.onMessage` **不要对所有消息 `sendResponse`**。以前它抢在后台前面回 `{ok:true}`，导致按钮拿到空响应、提示错误。

### 3.3 字幕身份：四层防线

“标题对、字幕错”已经被修过多次，四层都不能拆：

1. `pageIdentity()` 统一提供 bvid/cid/signature；
2. `getSubtitleBundle` 接收 `expectSignature`，采集前后校验页面身份；
3. 播放器 / `__INITIAL_STATE__` 的无标识字幕轨，只有来源自身 cid 与当前一致才采用，否则丢弃；
4. 网络嗅探正文只保留路径能匹配当前轨的条目；缓存写入/读取都带 `signature`，旧缓存自动删除。

诊断入口：字幕工具栏「⋯ → 查看明细 / 诊断」，重点看：

- `identityMismatch` / `identityUnstable`；
- `foreignTracks`（被排除的跨视频轨）；
- 候选轨 `cacheRejected`（缓存签名不符）。

不要把“抽不到标识就放行”改回来；那会直接复现串视频。

### 3.4 设置页：离屏构建

设置页 `render()` 必须先在离屏容器构建，成功后再替换 `#settings-body`。中途异常时保留旧内容，不能先 `clear()` 再逐块填；否则会出现设置内容整块消失。

### 3.5 字幕行：单行横向滚动

- 字幕文字区 `white-space: nowrap; overflow-x:auto`，长句不换行、不撑高行；
- 行尾统计压缩为「N字」，操作按钮是绝对定位悬浮层，平时不占文本宽度；
- 虚拟列表估算按固定行高，真实高度再测量修正；改行高/内边距时要同步 `estimate()`；
- 编辑长句时通过 `data-editing` 临时恢复换行。

### 3.6 桌面端页面视图与侧栏布局

- `BrowserStage` 用 `ResizeObserver` 上报 `WebContentsView` 的 bounds；它**只监听尺寸，不监听位置**。侧栏左右换边只改位置、不改尺寸，所以位置/折叠/宽度变化必须额外强制上报一次，否则页面视图会留在旧 x 坐标（左边空白、右边被页面盖住）。
- 拖拽侧栏时鼠标会跨到 `WebContentsView`，渲染层收不到 mouseup。拖拽期间隐藏视图，并在 `BrowserStage` 内部放页面快照占位；不要再用固定坐标快照，否则会和侧栏叠层。结束/失焦/12 秒兜底必须恢复视图。
- 页面视图恢复时要重新 `setBounds` + `invalidate`，只 `setVisible(true)` 可能仍然空白。
- 标题栏拖拽换边、边缘拖拽折叠、双击拖动条折叠、折叠图标方向都依赖 `sidebarPosition` / `sidebarCollapsed`；改布局时同步检查这四条路径。

### 3.7 桌面端平台目录

- 平台预设集中放在 `desktop/src/shared/presets.ts`，由插件 `settings.js` 导出；AI/检索/ASR 的 ID、模型、地址不要散落在 UI。
- 旧配置迁移靠 `ai.presetVersion`；新增内置平台时提高版本号，并确保用户删掉的平台不会被反复加回。
- 当前 AI 同时支持 OpenAI 兼容协议与 **Anthropic 原生 `/v1/messages`**（`aiClient.ts`）；新增平台时两种 `kind` 都要考虑。
- 设置快照会掩码 API Key；保存时靠 `mergeSecrets` 保留未修改的 Key，清空要用显式 `__CLEAR__`。

### 3.8 封面、ASR 与翻译缓存

- B 站图片 CDN 按 Referer 防盗链：`localhost` / `file://` 会 403。渲染页
  `index.html` 的 `<meta name="referrer" content="no-referrer">` 不能删；新增图片
  请求也不要覆盖成发送本地 Referer。
- ASR 结果缓存在 `src/renderer/src/lib/asrStore.ts`，翻译在 `translationStore.ts`，
  都是**渲染进程内存缓存**：刷新/切视频可恢复，退出应用丢失。
- 翻译 key 是 `videoKey + 轨路径`；编辑、优化、清空、重新转录必须调用
  `clearTranslationResult()`，否则译文会和改过的原文对不上。
- 无官方轨时刷新要恢复 ASR 结果，并在 `bundle.tracks` 里补一个「语音转录」伪轨，
  否则会出现“转录后一刷新就没了”。

## 4. 调试与诊断

- 内容脚本版本不一致：先刷新 B 站页面；`ping2` 握手只认新版。
- 设置 → 诊断与关于 → 诊断：包含 `pageInfo`、`senderInfo`、权限、平台摘要；
- 字幕候选轨明细：页面侧/接口侧轨数、采用来源、缓存状态、被排除轨；
- 页面桥旧版本会报“主环境不支持该方法”，刷新页面即可。

## 5. 文档职责

改动以下内容时必须同步文档：

| 改动 | 需要更新 |
|---|---|
| 用户可见功能 / 设置项 | `bilibili-subtitle-assistant/README.md`、根 README 功能表 |
| 版本 / 修复 | `CHANGELOG.md`、Release notes |
| 权限 / 隐私 / 商店文案 | `PRIVACY.md`、`docs/EDGE-STORE.md` |
| 测试命令 / 新增套件 | `verify/README.md`、根 README |
| 架构 / 环境坑 | `AGENTS.md`、本文件、`desktop/docs/ARCHITECTURE.md` |
| 桌面端功能 / 平台 / 验收 | `desktop/README.md`、`desktop/docs/PARITY.md`、`desktop/docs/PLATFORMS.md` |
| 桌面端真实回归 | `desktop/docs/REAL-REGRESSION.md` |

## 6. Issue 排查顺序

1. 让用户提供扩展版本、页面 URL、诊断 JSON（不要发 API Key）；
2. 先看 Console 是否有 `HierarchyRequestError` / 扩展上下文失效；
3. 字幕问题看候选轨明细：页面侧 0 条？接口侧 0 条？缓存拒用？被排除轨？
4. 内嵌问题看右侧栏选择器是否还存在（B 站改版）；
5. 能本地复现就补一条回归断言；浏览器相关问题优先补 `browser-smoke-test.js`。

## 7. 密钥与安全

- 不提交 `sk-...`、Cookie、`.env`、抓包样本；
- 用户要求贴日志时，先提醒删除 Key；
- 安全问题不要公开 Issue，按 [`../SECURITY.md`](../SECURITY.md) 处理。
