# 维护者手册

> 读者：下一个接手仓库的人（或 AI）。这里只记录**发布流程、易踩坑和不能随便改的约束**。
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
| `verify/` | 测试与发布脚本（不属于扩展运行时） |
| `docs/screenshots/` | README / 商店用界面截图 |
| `docs/EDGE-STORE.md` | Edge 提交材料、权限理由、认证备注 |

## 2. 发布前检查清单

### 2.1 版本号必须同步

一次版本 bump 至少检查这些位置：

```text
bilibili-subtitle-assistant/manifest.json
bilibili-subtitle-assistant/src/shared/constants.js          VERSION
bilibili-subtitle-assistant/src/content/content.js            CONTENT_VERSION
bilibili-subtitle-assistant/src/content/page-bridge.js        bridge version
verify/package.json
verify/bg-test.js / content-test.js / flow2.js / panel-test.js  测试固定版本
```

`verify/panel-test.js` 里的「构建指纹」断言最容易漏。

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
| 架构 / 环境坑 | `AGENTS.md`、本文件 |

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
