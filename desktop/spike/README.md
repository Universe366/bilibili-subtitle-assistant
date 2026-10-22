# 桌面端技术验证（Spike）

这不是产品代码，只回答三个问题：

1. Electron 里能不能正常打开 B 站（登录、播放、弹幕）；
2. 把现有 `page-bridge.js` 注入进去，能不能读到字幕和播放器状态；
3. 真实内存是多少，和 Edge 比是否“烂”。

## 怎么跑

```bash
cd repo/desktop
npm install

# Electron 二进制需单独下载（国内建议走镜像）
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js

# 注意：本机环境里 ELECTRON_RUN_AS_NODE=1 会让 electron 以 Node 模式启动
unset ELECTRON_RUN_AS_NODE
./node_modules/electron/dist/electron.exe spike/main.mjs
```

| 脚本 | 用途 |
|---|---|
| `spike/main.mjs` | 首轮：注入桥、身份、播放、弹幕、登录态、字幕、内存、扩展加载 |
| `spike/round2.mjs` | 第二轮：内存时间线、登录页二维码、扩展 content script 注入 |
| `spike/subtitle-check.mjs` | 单独核对字幕接口原始返回（RPC 信封里的 `data`） |
| `spike/cdp-test.mjs` | CDP 最小诊断（Page.enable 等） |
| `spike/edge-mem.ps1` | 同页 Edge 内存对照 |

本地 mock 服务（验证用，不属于产品）：

```bash
node spike/mock-ai.mjs          # OpenAI 兼容流式总结
node spike/mock-anthropic.mjs   # Anthropic /v1/messages（流式 / 工具 / 模型列表）
node spike/mock-verify.mjs      # 总结核对：检索词生成 + 自定义检索 + 语义判定
node spike/mock-mcp.mjs         # MCP HTTP
node spike/mock-mcp-sse.mjs     # MCP SSE
node spike/mock-asr.mjs         # ASR
```

## 结果（Windows 11 / Electron 45 / Chromium 156）

| 项目 | 结果 |
|---|---|
| 页面加载 | 约 6.2s，标题正确（`BV1xrnz6gEVD`） |
| 视频播放 | 自动播放，5 秒内 `currentTime` 前进 5.04s，`readyState=4`，640×360（未登录） |
| 弹幕/评论/播放器 | 播放器容器存在，弹幕 canvas 正常，评论元素存在 |
| 桥注入 | `__BSUB_PAGE_BRIDGE__` 存在，版本 2.16.2，16 个方法可用 |
| 页面身份 | `BV1xrnz6gEVD@p1@c42926145926`，`consistent: true` |
| 字幕接口 | `needLogin: true`，`tracks: 0`，符合“未登录不可见”的预期 |
| 登录页 | 二维码正常渲染（canvas + qrcode 容器） |
| 扩展加载 | Electron 能加载该 MV3 扩展；`sidePanel`/`webNavigation` 权限未知，但 content script 注入成功（桥 version 2.16.2） |
| 内存（空窗口） | 209MB（private 71MB） |
| 内存（B 站页暂停） | 1128MB（private 971MB） |
| 内存（播放中） | 1098–1146MB |
| 内存（离开页面 12s 后） | 994MB（未完全回收） |
| Edge 同页对照 | 1144MB / 13 进程 |

### 登录后复测（2026-10-21）

| 项目 | 结果 |
|---|---|
| 扫码登录 | 9.6s 完成，账号识别正常 |
| 清晰度 | **1920×1080**（未登录时 640×360） |
| 字幕轨 | 2 条 `ai-zh`，来源 `player/v2` + `player/wbi/v2`，`needLogin: false` |
| 字幕正文 | 主进程 fetch 返回 200，216KB，**1476 行**；首句「那这4年来」，末句「我们下回见」 |
| 内存（1080p 播放中） | 1503–1562MB |

> 登录态保存在 Electron 默认 userData（当前是 `%APPDATA%\Electron`）。正式应用会改成自己的目录，避免和其他 Electron 程序共用。
> 1080p 比 360p 多约 400MB，属于视频解码/缓冲的正常增量；Edge 在 1080p 下也会接近这个量级。

## 结论

- **可行**：页面、播放、弹幕、登录页、桥注入、身份识别全部正常。
- **内存不是 Electron 的锅**：同一个 B 站视频页，Edge 也是 1144MB，Electron 1100–1150MB，基本持平；空窗口 Electron 只有约 209MB。
- **字幕需要登录**：`need_login_subtitle=true`，符合预期。登录后需要复测一次。
- **扩展能在 Electron 里注入 content script**，但 `sidePanel` 不存在，不要依赖它；页面侧逻辑仍按“自己注入 page-bridge”的方式做。

## 已知注意点

- 必须先加载一次页面（如 `about:blank`）再 `debugger.attach` + `Page.enable`，否则会一直挂起。
- 注入的 `page-bridge` 与扩展里的版本同源，升级时两边要同步。
- 未登录只能 360p；1080p 与字幕都需要 app 内扫码登录后复测。
- 内存统计是各进程 working set 之和，会重复计算共享内存；与 Edge 的对比采用同一口径，仅作相对参考。
