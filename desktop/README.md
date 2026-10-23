# B站字幕助手 · 桌面端

Windows 桌面端，内置 B 站浏览器 + 本地字幕/总结库。当前 **0.30.12**。

> 维护、发布、常见坑见根目录 [`docs/MAINTAINERS.md`](../docs/MAINTAINERS.md) 的桌面端章节。

## 运行

```bash
cd repo/desktop
npm install

# 首次需要单独下载 Electron 二进制（国内建议走镜像）
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js

# 本机环境里 ELECTRON_RUN_AS_NODE=1，会让 electron 以 Node 模式启动，必须先清掉
unset ELECTRON_RUN_AS_NODE

npm run dev      # 开发（Vite HMR + Electron）
npm run build    # 构建到 out/
npm run typecheck
npm run dist     # Windows 安装包 + 绿色包输出到 release/
```

> 从终端启动打包后的 exe 时，也要先 `set ELECTRON_RUN_AS_NODE=`（清空）。
> 否则 Electron 会以 Node 模式运行，窗口一闪就退出。双击启动不受影响。

> `npm run dev` 前会自动执行 `sync:bridge`，把扩展里的
> `src/content/page-bridge.js` 复制到 `resources/page-bridge.js`。
> 扩展侧改了桥，重新跑一次 dev/build 即可同步。

## 目录

```
src/
  main/        Electron 主进程：窗口、标签管理、CDP 注入、IPC
  preload/     contextBridge 暴露给渲染进程的 API
  renderer/    React 界面（标签栏 / 地址栏 / 侧栏 / 浏览器区域）
  shared/      主进程与渲染进程共用的类型
scripts/       同步桥、窗口截图
spike/         技术验证脚本（不属于产品）
docs/          V1 方案
```

## 已实现（M0–M5）

- 多标签（`WebContentsView`，每个标签独立视图）
- **浏览器基本盘**：缩放（`Ctrl +` / `Ctrl -` / `Ctrl 0`）、页内查找（`Ctrl+F`）、全局搜索（`Ctrl+K`）、右键菜单、下载保存、快捷键（`Ctrl+T/W/L/R`、`Alt+←/→`、`F5`）
- **标签休眠**：后台标签闲置 5 分钟且未出声时释放渲染进程；切回时自动重载（开发期可用 `BSUB_SUSPEND_MS` 调整阈值）
- 地址栏：BV 号 / 链接 / 搜索词自动识别
- 前进、后退、刷新/停止、新建/关闭标签
- 打开 B 站首页，页面内新窗口请求自动转为新标签
- 启动时通过 CDP 注入 `page-bridge.js`，页面加载后日志可见 `bridge=2.18.0`
- Patina 风格界面：浅/深色自动跟随系统，侧栏「字幕 / 总结 / 库 / 设置」
- **M2 字幕面板**：视频信息卡（封面 / 标题 / UP / 时长 / BV / 播放量）、字幕轨列表（多轨 + AI 标识）、字幕正文下载、跟随播放高亮、点击字幕跳转、未登录提示与登录入口
- **M3 本地库**：SQLite（`node:sqlite`，无需重编译原生模块）、一键入库、视频列表、标题/UP/标签/合集/字幕搜索（多词按 AND 匹配，FTS5 trigram，短词退化 LIKE）、已总结标记与排序、**标签与合集**（详情里增删、列表按标签/合集筛选；标签可重命名/合并/删除，合集可重命名/删除）、**条目详情**（离线字幕阅读 + 保存的总结 + 直接导出）、点击搜索结果回到对应时间、删除入库视频（二次确认并说明连带删除范围）
- **库多选**：一键进入多选，批量加标签/合集或批量删除；选中数量与操作结果即时提示
- **笔记**：库条目详情第三个页签，可写 Markdown 笔记、Ctrl+S 保存；有笔记时页签带标记，空内容保存会自动清除
- **打开复用**：从库/历史打开视频时，同一视频已开着就切回原标签，不再堆重复标签；带时间戳的结果会定位到对应播放位置
- **全局搜索**：`Ctrl+K` 同时搜索库内视频（含标签/合集）、字幕正文和已保存总结；↑↓ 选择、Enter 跳到条目或时间点、Esc 关闭，网页焦点下也能唤起
- **M4 总结与导出**：AI 流式总结（OpenAI 兼容）、零依赖 Markdown 渲染、总结存库并保留最近 20 个版本（可预览、与当前版本对比 diff、恢复）、导出 Markdown / SRT / TXT / JSON；设置页可配置 AI 平台、Key、模型、总结提示词、数据目录与连接测试
- **M5 插件桥 / 托盘 / 打包**：本地 HTTP 桥（`127.0.0.1` + Bearer token，`GET /v1/hello`、`GET /v1/health`、`POST /v1/ingest`）、扩展自动发现（零配置）、设置页「安装浏览器插件」、关闭到托盘、NSIS 安装包 + 绿色 zip
- **字幕校对**：规则组（正则/大小写）+ 术语表，读取/推送时应用，支持预览
- **MCP**：HTTP JSON-RPC 工具调用，对话自动工具循环
- **Skills**：SKILL.md 导入与提示词注入
- **字幕质检**：时间轴/重叠/覆盖率/语速/重复等问题，可点击跳转
- **AI 章节**：生成可跳转章节
- **URL 批量**：粘贴 BV/链接，后台标签逐个抓字幕入库（需登录）
- **批量总结**：库内视频可按标题/UP/合集筛选、全选筛选结果，逐项显示等待/进行/完成/失败；并发 1–4（默认 2）、按选中字幕字符量预估请求数；停止会保留已完成结果，失败项可一键重试
- **任务中心**：总结、转录、翻译、校对、批量、链接批量都写入本地任务表；侧栏底部的任务按钮显示进行中数量，可查看逐项状态、取消任务、重试失败项，重启后记录仍在
- **任务通知**：窗口不在前台时，运行超过 5 秒的任务完成/失败/停止会发系统通知，点击通知回到任务中心
- **记录**：总结按日期分组，可按标题/UP/总结内容搜索，一键跳到库中对应条目；任务页签保留总结/转录/翻译/批量记录，可取消与重试失败项
- **总结导出**：记录里可导出单条或全部总结为 Markdown；全部导出会跟随当前搜索筛选，并带导出时间与来源信息
- **数据备份**：一键备份设置 + 字幕库；恢复前自动保留当前数据并重启
- **数据位置迁移**：设置 → 数据与备份 → 更改位置，复制设置/字幕库/登录状态/日志到新目录，重启后自动删除旧目录（失败会保留待清理标记）
- **导出**：6 种格式（MD/SRT/VTT/ASS/TXT/JSON）+ 4 种 Markdown 模板
- **AI 优化**：批量校对，逐条 diff 勾选应用
- **字幕翻译**：保留时间轴，原文/译文/双语视图，可随字幕导出
- **语音转录**：无官方字幕时用音轨转写，支持 M4A/WAV 与多传输回退
- **AI 对话**：基于当前字幕流式提问，支持停止/清空/建议问题、图片、思维链折叠、本轮 Skills 选择
- **侧栏交互**：拖拽调宽、拖到窄处折叠、标题栏换边、折叠图标随侧别变化
- **多平台**：AI 28 家（含 Anthropic 原生协议）、检索 12 家、ASR 3 家，每平台独立 Key/模型/地址；详见 `docs/PLATFORMS.md`
- **卸载**：NSIS 自定义卸载页，可选保留或删除本地数据；勾选时会同时清理自定义数据位置、更新缓存与临时转写文件
- **联网检索**：Exa / AnySearch 免 Key，Tavily / Brave 需 Key；结果作为总结参考资料
- **设置页**：主题、关闭到托盘、休眠时长、AI 平台/温度/token/流式、提示词模板、导出默认值、设置导入导出
- **自动更新**：默认启动检查、可选自动下载、状态卡片、更新说明、失败重试；安装版读取 GitHub Release 的 `latest.yml`，绿色版需手动替换

## 打包

```bash
npm run dist
```

产物：

| 文件 | 说明 |
|---|---|
| `release/bsub-desktop-setup-0.30.12.exe` | NSIS 安装包，可选安装目录 |
| `release/bsub-desktop-0.30.12-win-x64-green.zip` | 绿色版，解压后进入目录双击 `B站字幕助手.exe` |
| `release/latest.yml` | 自动更新元数据 |
| `release/bilibili-subtitle-assistant-v2.18.0.zip` | 浏览器插件（由 CI 打包） |

当前发布未签名，首次运行可能触发 SmartScreen；选择「更多信息 → 仍要运行」。签名接入见 [`../docs/SIGNING.md`](../docs/SIGNING.md)。

### 发布

发布使用**合并 Release**：一个 tag（插件版本号，例如 `v2.18.0`）同时提供插件 zip 和桌面端安装包/绿色包。
这样插件更新检查（读 `/releases/latest`）和桌面自动更新（读最新 Release 里的 `latest.yml`）都正常。

1. 更新 `bilibili-subtitle-assistant/CHANGELOG.md` 与 `manifest.json` 版本（2.18.0）。
2. 更新桌面端 `CHANGELOG.md` 与版本号（`npm version 0.30.12 --no-git-tag-version`）。
3. `npm run dist` 本地确认能构建。
4. `npm run release:notes` 生成发布说明。
5. 打 tag 并推送：

```bash
git tag v2.18.0
git push origin master
git push origin v2.18.0
```

GitHub Actions（`.github/workflows/desktop-release.yml`）会在 Windows runner 上重新构建，
并创建 Release，资产包含：
插件 zip / setup / `latest.yml` / blockmap / 绿色 zip。

自动更新读取的是**带 `latest.yml` 的最新 Release**；插件更新读取**最新 Release 的 tag**。
两者都要求最新 Release 来自这个合并工作流。

## 数据

- 默认数据目录：`%APPDATA%\bsub-desktop`（开发期可用 `BSUB_USER_DATA` 指定）
- 数据库：同目录 `library.db`；设置：`settings.json`（AI 平台、Key、提示词、插件桥端口与 Token）
- 设置 → 数据与备份 → **更改位置** 可迁移到空目录：
  - 复制设置、字幕库、总结、登录状态、日志；
  - 写入 `%APPDATA%\bsub-desktop-location.txt` 后自动重启；
  - 新进程启动后删除旧目录，失败则记录到 `%APPDATA%\bsub-desktop-cleanup.txt` 下次重试。
- 卸载时勾选「同时删除本地数据」会读取上述指向文件，把自定义位置也删掉。
- 只存字幕、总结、元数据与封面地址，不落音视频
- 去重：同一视频（bvid + cid）更新而不是重复插入；同一字幕轨重复入库会替换旧分段
- 总结会随视频一起入库，重复生成会覆盖旧总结
- ASR 与翻译结果按视频/轨缓存在渲染进程内存中：刷新可恢复，退出应用后清空

模块、数据流和安装器维护细节见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 本地测试

```bash
# 本地 mock OpenAI 服务（流式），用于验证总结链路
node spike/mock-ai.mjs

# 自动跑：抓字幕 → 总结 → 存库 → 导出
BSUB_M4_TEST=1 npm run dev
```

导出样本在 `out/test-export.md` 与 `out/test-export.srt`。

## 插件桥

桌面端在 `127.0.0.1:47821` 起一个本地 HTTP 服务，用 Bearer Token 鉴权；
设置页「插件桥」可以看到端口、Token 和运行状态，并提供 **「安装浏览器插件」**（准备扩展目录、复制路径、打开 Edge/Chrome 扩展页）。

扩展会自动请求 `GET /v1/hello` 发现端口与 Token，**正常情况不用手填**；只有自动发现失败时才需要手动配置。

```bash
# 模拟插件推送（需要桌面端已启动）
node spike/bridge-test.mjs
```

协议详见 [`docs/BRIDGE.md`](docs/BRIDGE.md)。浏览器插件侧已接入：
扩展「设置 → 桌面端」填端口/Token，字幕面板「⋯ → 发送到桌面」。

## 已知问题

- B 站单页应用切 query 时可能重复请求一次视频信息（结果正确，后续合并去重）
- 多字幕轨时默认选择是启发式（优先带当前 cid 的轨），极端情况仍需手动切换
- API Key 与桥 Token 以明文保存在本机 `settings.json`，后续接系统钥匙串
- 总结字幕上下文上限约 20 万字符，极端超长视频仍会头尾保留、中间省略
- 未签名，SmartScreen 会提示
- 桌面端 0.30.12 已随下一版合并发布；安装版自动更新要求 Release 带 `latest.yml` 和 setup exe，绿色版手动替换
- 更新检查默认开启；若最新 Release 仍是旧桌面资产，会显示已是最新。安装版才支持自动更新
- 插件桥需要桌面端先运行，并在插件「设置 → 桌面端」填入端口 / Token
- 休眠标签切回会重新加载页面（滚动位置与播放进度不保留）

## 下一步

- 代码签名
- 多账号、本地 ASR

## 注意

- 当前使用 Electron 默认会话，登录态与扩展浏览器互不影响；app 内需要单独扫码一次。
- `out/`、`resources/page-bridge.js`、`node_modules/` 均已忽略，不入库。
- 截图：`out/m0.png`（`scripts/capture-window.ps1` 生成）。


## 卸载

- 安装版：Windows「设置 → 应用 → 已安装的应用」卸载「B站字幕助手」，或运行安装目录下的 `Uninstall B站字幕助手.exe`。
- 卸载页可选择是否同时删除本地数据：
  - 默认只删除程序、快捷方式和卸载项；
  - 勾选后额外删除 `%APPDATA%\bsub-desktop`（设置、字幕库、登录状态、缓存、日志）和更新缓存。
- 绿色版没有卸载器：退出程序后删除程序目录；如需彻底清理，再手动删除 `%APPDATA%\bsub-desktop`。
