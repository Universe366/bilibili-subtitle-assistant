# 验证套件（不属于扩展运行时）

针对 `../bilibili-subtitle-assistant` 的自动化验证。**22 个套件共 1154 项断言，全部通过。**

```bash
npm install                 # jsdom / esbuild / fake-indexeddb
node bundle.js              # 把面板打包成 IIFE（jsdom 不执行 type=module 脚本）
node panel-test.js          # 侧边栏渲染与纯逻辑          328 项
node bg-test.js             # 后台 service worker 端到端    64 项
node content-test.js        # 内容脚本 + 主环境桥           38 项
node flow2.js               # 完整业务流程（最关键）         34 项
node harvest-test.mjs       # 字幕抓取层（5 种来源组合）     22 项
node bili-test.js           # B 站接口与 wbi 签名           29 项
node sniff-test.mjs         # 网络嗅探 + 音轨抓取           27 项
node asr-test.mjs           # 语音识别传输/参数/切片/诊断   240 项
node asr-e2e-test.mjs       # ASR 400 端到端复现（含文案）   16 项
node bridge-transparency-test.mjs  # 主环境桥透明性        18 项
node method-contract-test.mjs      # 三层方法白名单一致性   12 项
node m4a-encode-test.mjs           # 真实浏览器里的 M4A 编码     6 项
node ffmpeg-remux-test.mjs         # FFmpeg.wasm 封装重传         6 项
node mp4-structure-test.mjs        # MP4 结构正确性               5 项
node patch-ffmpeg-vendor.mjs       # FFmpeg 补丁与 CSP 校验      17 项
node mcp-test.mjs                  # MCP 客户端 + 工具调用循环    23 项
node skills-test.mjs               # SKILL.md 解析与导入         18 项
node keyless-search-test.mjs       # 免费引擎回退链/缓存/注入防护 109 项
node reasoning-test.mjs            # 思维链与正文分离              28 项
node checklist.js                  # 需求文档功能清单逐项核对    87 项
```

| 文件 | 覆盖内容 |
|---|---|
| `flow2.js` | **端到端主链路**：读取视频 → 抓字幕（240 行，走页面嗅探）→ 列表渲染 / 搜索高亮 / 跟随播放 / 点击跳转 → AI 总结（流式 + Markdown 渲染）→ 对话 → 导出 SRT/学习笔记 → 页面无字幕时点播放器字幕菜单重试 → 真没字幕时给出「需要登录 B 站 + 各来源明细 + 查看明细按钮」 |
| `harvest-test.mjs` | 字幕抓取层五种组合：① 页面嗅探已带正文（直接用、不再下载）② 只有地址 → 下载 ③ 页面空 → 接口兜底 ④ 全空 → 可操作错误 ⑤ **接口给的是整段视频的字幕**（多分 P，时长远超当前分 P）→ 自动点播放器菜单重新拉取当前分 P |
| `bridge-transparency-test.mjs` | 主环境桥对页面自身网络请求的**透明性**（「开启插件后视频加载不出来」的回归）：fetch 支持 string / Request / (Request, init) 三种入参、body 不被抢消费、畸形响应不影响调用方、XHR 的 `addEventListener` 与 `onload` 两种写法、URL 对象入参、非 playurl 请求照常、重复注入不叠加包装、无未捕获错误 |
| `method-contract-test.mjs` | **三层方法白名单一致性**：主环境桥支持的方法 ↔ 内容脚本转发的方法 ↔ 后台会请求的方法。任何一处漏同步都会失败（`getAudioCandidates` 就曾因为内容脚本漏登记而报「内容脚本不支持该方法」） |
| `bili-test.js` | MD5（对齐 RFC 1321）、wbi 签名请求、player/v2 回退、`need_login_subtitle` 识别、6 种正文 JSON 形状、字幕轨列表不被误当正文、番剧 ep_id → bvid/cid、网络异常分类 |
| `sniff-test.mjs` | 主环境桥的 fetch / XHR 钩子：真实请求不被破坏、字幕正文被截获、`.m4s`/接口列表不被误判；**音轨**：候选排序（mirrorcos 降权）、backupUrl、playurl 刷新带 cid、`fetchAudioRange` 只带 Range 且不手动设 Referer/Origin、`credentials: omit`、403 与 `200+text/html` 都判失败 |
| `asr-test.mjs` | 语音识别传输/参数阶梯：**硅基流动只发 file+model**、`multipart` / `base64-json` / `chat-audio` 三种形态的请求体与鉴权、Groq 走 `verbose_json`+`timestamp_granularities`、**`/audio/transcriptions` 400 后自动改用 `/chat/completions`（XingChen 场景）**、`chat/completions` 响应解析、400 阶梯降级、空响应体时查 `/models` 定位模型名 |
| `asr-e2e-test.mjs` | **端到端复现用户报的 ASR 400**：加载真实 `providers.js`，模拟硅基流动 `/audio/transcriptions` 返回 `400 + 空体`、`/models` 返回真实模型列表，断言错误文案里出现「模型列表里没有 "XingChenAGI/XingChenASR-V3.2"」与「可用的语音识别模型：…」；并覆盖模型名一致时不误报、`/models` 不可用时不崩、「未检测到语音」视为接口可达 |
| `bg-test.js` | chrome/fetch 桩直接加载 `service-worker.js`：RPC 路由、密钥掩码与「留空不改动」、字幕下载、音轨 Range 分块、SSE 流式、401/429/404 分类、检索平台、候选标签页降级、诊断不回传明文密钥 |
| `content-test.js` | jsdom 模拟 B 站页面：主环境桥读 `__INITIAL_STATE__`/`player` → DOM 通道 → 隔离环境；分 P/cid 签名、字幕轨协议补全、音轨选择、版本握手、播放器按钮、画面字幕、跟随播放、pushState 检测 |
| `panel-test.js` | 面板渲染、布局、Markdown 安全渲染、导出 6×4、时长校验分档、重叠去重、自适应切片、规则导入导出、密钥处理、状态持久化、设置页 12 组、向导、浮层、快捷键 |
| `checklist.js` | 按 `功能需求.md` 第十三章逐项在代码里找实现，输出 `[x]/[ ]` 清单 |

> `bundle.js` 依赖 `test-entry.js`（测试专用入口，把面板与自检挂钩打进同一个 IIFE）。
> 扩展内的 `src/sidepanel/selfcheck.js` 会把内部模块与面板 API 挂到 `window.__BSUB_SELFCHECK__`，供测试断言调用。



## 开发日志

逐轮缺陷与修复复盘已拆分到独立文件：

**`bilibili-subtitle-assistant/docs/DEVELOPMENT-LOG.md`**

它记录了每一轮改了什么、为什么改，以及**当时为什么会想错**。
建议按主题搜索（例如「Content-Type」「超时」「CSP」「service worker」），而不是从头读。

环境约束与排查方法论见 **`bilibili-subtitle-assistant/AGENTS.md`**。
