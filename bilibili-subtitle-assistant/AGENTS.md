# AGENTS.md —— 给后续 AI 协作者的说明

> 这份文件的读者是**下一个来改这个仓库的 AI**（或人）。
> 它不解释功能，只说明「**在这个环境里什么可行、什么不可行、哪些坑已经踩过了**」。

---

## 1. 这个仓库是什么

B 站视频侧边栏助手，**Chrome / Edge MV3 扩展**（无 Obsidian 集成，全部配置在侧边栏内）。

| 目录 | 内容 |
|---|---|
| `src/background/` | service worker：RPC 路由、平台调用、MCP 客户端、工具循环 |
| `src/content/` | 双内容脚本：`page-bridge.js`（`world: "MAIN"`）+ `content.js`（ISOLATED） |
| `src/sidepanel/` | 面板 UI 与业务逻辑 |
| `src/shared/` | 设置、常量、跨环境工具（md5、skills 解析） |
| `vendor/ffmpeg/` | FFmpeg.wasm 内核（**31MB，必需**，已提交入库） |
| `../verify/` | 自动化测试套件（**不属于扩展运行时**，加载扩展时不需要） |
| `docs/history/` | `DEVELOPMENT-LOG.md` —— 逐轮缺陷与修复记录 |

---

## 2. 环境硬约束（**先读这一节，能省掉几天**）

### 2.1 浏览器沙箱边界（做不到的事，不要尝试）

| 做不到 | 原因 |
|---|---|
| MCP 的 `stdio` 传输 | 扩展无法启动本地进程 |
| MCP 的 `inMemory` 传输 | 同上（那是 Cherry Studio 一类 Electron 应用的能力） |
| Skills 里的 shell / python 脚本 | 无本地执行环境。本扩展只支持「**指令型** Skills」 |
| 本地文件系统 / 向量知识库 | 无 FS 权限 |
| 用 `Referer` / `Origin` / `User-Agent` 头 | Fetch **forbidden header**，在 service worker 里设置会被**静默丢弃** |

**最后一条的推论**：B 站音轨 CDN 校验 Referer，所以音轨请求**必须**从页面主环境发出
（`page-bridge.js` 的 `fetchAudioRange`），由浏览器自动带 Referer。在后台直接 fetch 必然 403。

### 2.2 MV3 的 CSP（曾经两次导致扩展装不上）

`manifest.json` 的 `extension_pages`：

```
script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self';
img-src 'self' data: blob: https:; connect-src 'self' https: http:
```

- ❌ **`script-src` 与 `worker-src` 都不能出现 `blob:`** —— Chrome 会**拒绝加载整个扩展**
- ❌ 不能内联 `<script>`
- ✅ `'wasm-unsafe-eval'` **必需** —— 否则 `WebAssembly.instantiate` 报 CSP 违规，FFmpeg 用不了
- ✅ worker 必须从 `chrome-extension://` 地址加载，且**显式传 `classWorkerURL`**

> `vendor/ffmpeg/` 里的 `ffmpeg-api.js` 与 `ffmpeg-worker.js` 是**打过补丁**的：
> 去掉了 `import.meta.url` 与 `{ type: 'module' }`。
> **不要用 npm 原版直接覆盖**，否则会退回装不上的状态。
> 校验：`node ../verify/patch-ffmpeg-vendor.mjs`

### 2.3 service worker 的独立生命周期（最容易搞错的一点）

**service worker 与面板是两份独立更新的代码。**

只点扩展的「刷新」时，面板立刻用上新代码，而**旧的 SW 可能仍在运行** ——
表现为「日志是新版、发出去的请求却还是旧版行为」，极难排查。

- 改完后台代码，**必须**在 `chrome://extensions` 点刷新（必要时移除后重新加载）
- 代码里已有防护：转录开始时会把**面板与后台的版本**都写进日志（`版本自检`）
- 内容脚本同理：**扩展更新后必须刷新 B 站页面**（MAIN-world 脚本无法热替换）

---

## 3. 已经踩过的坑（**改代码前请先看**）

按「曾经造成的破坏程度」排序。

### 3.1 multipart 请求带了 `content-type: application/json`

`authHeaders()` 无条件返回 JSON 头，multipart 分支直接复用 →
发出「JSON 头 + multipart body（无 boundary）」的畸形请求 →
服务端解析失败，返回**空响应体的 400**。

- 症状极具误导性：同一份字节用 curl / Node / 页面 / service worker 发都是 200，
  只有经过本扩展是 400
- 修法：`authOnlyHeaders()` —— multipart **只带鉴权头**，Content-Type 交给浏览器生成
- **已有运行时硬防线**：检测到 content-type 直接抛错，不会静默发出
- 测试：`asr-test.mjs` 里断言「发出去的请求头」

### 3.2 `METHOD_TIMEOUT` 漏登记 → RPC 先于 HTTP 超时

`asr.transcribe` 没登记，回落到默认 30 秒；而 13MB WAV 的 base64 上传恰需约 30 秒 →
**每次都在上传阶段被掐断**。

- 规则：**RPC 超时必须 > HTTP 超时**（`callAsr` 里已强制 `max(http+60s, 600s)`）
- 新增任何耗时 RPC 方法，**必须**登记到 `METHOD_TIMEOUT`
- 测试：`asr-test.mjs` 断言「所有重方法都已显式登记超时」

### 3.3 上传格式按「平台」一刀切

实测结论（真实 API）：

| 模型 | WAV | M4A |
|---|---|---|
| `FunAudioLLM/SenseVoiceSmall` | **500** | **200** |
| `XingChenAGI/XingChenGSR-V1.0` | **200** | **400** |

**同一平台不同模型要求相反。** 必须按**模型**判定（`transcribe.js` 的 `audioFormatFor`）。

### 3.4 三层白名单必须同步

主环境桥支持的方法 ↔ 内容脚本转发的方法 ↔ 后台会请求的方法。
`content.js` 的 `handle()` 是**显式白名单**，漏登记就报「内容脚本不支持该方法」。

- 测试：`method-contract-test.mjs` 会自动比对三层

### 3.5 兜底域名的错误会掩盖配置地址的真实错误

`.cn` 返回 400、兜底 `.com` 返回 401 → 若只报最后一次，用户被告知「Key 无效」，
而真正的问题（400）被完全掩盖。

- 规则：**以配置地址的错误为准**，并展示**完整尝试链路**
- 测试：`asr-test.mjs` 有专门的回归用例

### 3.6 原始错误必须翻译，不要丢给用户

曾经直接把浏览器原生错误抛给用户：

- `Insecure CSP value "blob:"`（应该提前校验 CSP）
- `Failed to construct 'URL': Invalid URL`
- `String contains non ISO-8859-1 code point` ← **Key 里混入中文时的报错**

**规则**：任何来自浏览器/服务端的底层错误，都应该在抛出前拦截并转成可照做的提示。
现已处理：请求头字符集校验（`assertHeaderSafe`）、multipart 头校验、MCP 错误分类。

### 3.7 内嵌面板：Shadow DOM + 延迟挂载（2.13–2.16 的坑）

- B 站右侧栏脚本会遍历 light DOM 子节点并调用 `setAttribute`。面板按钮/iframe 如果直接作为普通子节点，会抛 `HierarchyRequestError`，**顺手把评论区卸载**，页面部分点击失效。
- 所以面板内部必须在 `attachShadow({mode:'open'})` 里；宿主只留一个空 `div`。
- 插入必须等 B 站首屏稳定（当前约 2.2s），切页后延迟约 1.8s；过早插入会打断 B 站自己的 DOM 初始化。
- 右侧栏重建时复用已有 host/iframe，不要 remove 重建，否则 iframe 重载会闪。
- 改完必须跑 `npm run test:browser:smoke`，确认评论区 `bili-comments` 还在、无 `HierarchyRequestError`。

### 3.8 侧边栏开关：端口状态 + 不要抢答

- `chrome.sidePanel` 没有可靠的 `isOpen()`；当前靠侧边栏页面建立的 `bsub:sidepanel` 端口判断。端口断开要自动重连，否则 SW 休眠后第一次点击会误判。
- 关闭优先 `chrome.sidePanel.close()`；旧内核用禁用/启用兜底。
- 侧边栏的 `chrome.runtime.onMessage` **只处理广播，不要对所有消息 `sendResponse`**。曾经它抢在后台前回 `{ok:true}`，导致「▣」按钮拿到空响应、提示与实际相反。
- 后台做 embed 动作后要回查内容脚本 `state`，按真实 `open/collapsed` 返回。

### 3.9 字幕身份：四层防线，不要拆

1. `pageIdentity()` 统一 bvid/cid/signature；
2. `getSubtitleBundle` 接收 `expectSignature`，采集前后校验；
3. `player.getSubtitle()` / `__INITIAL_STATE__` 的无标识字幕轨，只有来源自身 cid 与当前一致才采用，否则丢弃；
4. 网络嗅探正文只保留路径能匹配当前轨的条目；缓存写入/读取带 `signature`，旧缓存自动删除。

诊断看 `foreignTracks`、`identityMismatch`、候选轨 `cacheRejected`。
**不要恢复“抽不到标识就放行”**；那会直接复现「标题对、字幕是别的视频」。

### 3.10 设置页与字幕行

- 设置页必须**离屏构建成功后再替换** `#settings-body`；中途异常保留旧内容，不能先清空。
- 字幕行是**单行横向滚动**：长句不换行、不撑高行；行尾统计压缩为「N字」，操作按钮绝对定位悬浮。虚拟列表的 `estimate()` 必须与行高/内边距同步，否则滚动会跳。
- 改这些 UI 后至少要跑 `npm run test:browser:smoke`。

完整发布清单见 [`../../docs/MAINTAINERS.md`](../../docs/MAINTAINERS.md)。

---

## 4. 改代码的正确姿势

### 4.1 必须跑测试

```bash
cd ../verify
npm install          # 首次
node bundle.js       # 面板打包成 IIFE（jsdom 不执行 type=module）
# 逐个跑，或一次性跑全部（见 verify/README.md）
```

**关键约束：测试是从「空配置」开始的**，所以**永远覆盖不到「存量用户 + 新增默认值」这条路径**。
历史上正是这样漏掉了「新增平台对老用户不可见」（`mergeBuiltinPlatforms`）。

> 改动 `defaultAiPlatforms` / `defaultSearchPlatforms` / `defaultAsrPlatforms` 时，
> 请同步确认 `migrateSettings` 会把新条目补进已有配置。

### 4.2 版本号要一起改

`manifest.json`、`src/shared/constants.js`、`src/content/content.js`、
`src/content/page-bridge.js`（含 bridge 的 `version:` 字面量），
以及测试里的 `构建指纹` 断言。

### 4.3 测试里不能 monkey-patch ES module

ES module 的导出是只读的。需要注入时用**参数注入**（例如
`chatWithTools(..., { chatFn })`），不要写 `providers.chatOnce = fake`。

### 4.4 无法做端到端验证时，用等价环境

Chrome 153 起 `--load-extension` 被禁用，**无法自动加载扩展**。替代手段：

- **CSP 等价测试**：`csp-ffmpeg-test.mjs` 用 HTTP 提供同样的目录结构，
  并加上**与 manifest 完全一致的 CSP 头**，可复现 CSP 失败模式
- **CDP 驱动真实 Chrome**：`ffmpeg-remux-test.mjs` 等在真实浏览器里跑扩展代码本体
- **真实扩展抓包**：起本地 HTTP 服务，让真实 SW 打过去，看服务端收到了什么

> 「无法做端到端验证」**不等于**「无法验证」。先想能不能搭等价环境。

---

## 5. 排查方法论（这个项目最大的教训）

这个仓库的历史里有**连续三十多轮误判**，根因是方法论问题，不是技术难度。

### 有可测试凭证时，隔离变量 > 换假设

最终定位 Content-Type 问题靠的是这张表（每一层用**同一份字节**）：

| 环境 | 结果 |
|---|---|
| curl | 200 |
| Node（直接调 `transcribeSlice`） | 200 |
| 真实 Chrome 普通页面 | 200 |
| 真实 Chrome 扩展 service worker | 200 |
| **本扩展的 `transcribeAttempt`** | **400** ← 唯一异常 |

环境全部排除后，只剩「我们额外送出的东西」。

### 具体建议

1. **先拿真实凭证跑通一次最小实验**，再开始改代码
2. **一次只改一个变量**，记录状态码变化（状态码的变化本身是信息：
   从 400 变成超时，说明请求已经被服务端接受了）
3. **失败时也要保存日志** —— 早期版本只在成功时写 `transcriptLog`，
   导致用户报错时拿不到任何信息，排查变成猜谜
4. **不要只报最后一次尝试** —— 会掩盖真实错误
5. **错误上报本身就是可观测性**，不是附加功能

---

## 6. 提交约定

使用 Conventional Commits：

```
<type>[optional scope]: <short description>
```

`type`：`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf` / `build` / `ci`

示例：

```
fix(asr): multipart 请求不再预设 content-type
feat(mcp): 支持远程 MCP 的 http / sse 两种传输
docs: 拆分开发日志，补 AGENTS.md
```

---

## 7. 文档分工

| 文件 | 读者 | 内容 |
|---|---|---|
| `README.md` | **用户** | 安装、配置、功能、故障排查 |
| `AGENTS.md`（本文件） | **AI / 贡献者** | 环境约束、已踩的坑、方法论 |
| `docs/history/DEVELOPMENT-LOG.md` | **维护者** | 逐轮缺陷与修复（含「为什么当时想错了」） |
| `../verify/README.md` | **维护者** | 测试套件说明与运行方式 |
| `../../docs/MAINTAINERS.md` | **维护者** | 发布清单、版本同步、内嵌/字幕身份/缓存的硬约束 |

新增功能时请同步更新对应文档；**变动用户可见行为 → 改 README**。
