# 插件 ↔ 桌面桥协议（v1）

桌面端在本机 `127.0.0.1` 上启动 HTTP 服务，浏览器插件把抓到的字幕 / 总结推过来。
只监听回环地址；`/v1/ingest`、`/v1/health` 需要 Bearer Token。

## 配对（默认零配置）

1. 桌面端打开 **设置 → 插件桥**，确认「启用本机接收」。
2. 扩展会自动探测 `127.0.0.1:47821~47830` 的 `GET /v1/hello`，拿到端口与 Token 后直接连接，**不需要用户填写**。
3. 桌面端设置页也提供「安装浏览器插件」：准备扩展目录、复制路径并打开浏览器扩展页。

手动配对仍然支持：桌面端设置里能看到端口和 Token；只有自动发现失败（例如改过端口/安全软件拦截）时才需要手动填。

Token 首次启动时自动生成，保存在 `%APPDATA%\shizi\settings.json`（旧版为 `bsub-desktop`）。
泄漏后可在设置里改端口 / 清空 Token 重启，会重新生成。

## 接口

### GET /v1/hello（无需鉴权，供扩展自动发现）

```http
GET /v1/hello
Origin: chrome-extension://<扩展 ID>
```

```json
{
  "ok": true,
  "app": "shizi",
  "name": "拾字",
  "version": "0.37.1",
  "port": 47821,
  "token": "…"
}
```

- 只接受扩展来源（`chrome-extension://` / `moz-extension://`）或没有 Origin 的本机进程；
  网页 `https://…` 来源返回 403，且不会返回 Token。
- 扩展拿到后会自动保存端口/Token，后续请求直接复用。

### GET /v1/health

```http
GET /v1/health
Authorization: Bearer <token>
```

```json
{ "ok": true, "version": "0.1.0", "library": { "videos": 3, "segments": 2401 } }
```

### POST /v1/ingest

```http
POST /v1/ingest
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "protocolVersion": 1,
  "clientId": "browser-profile-uuid",
  "browserKind": "chrome",
  "extensionVersion": "2.17.8",
  "video": {
    "bvid": "BV1xrnz6gEVD",
    "cid": 42926145926,
    "title": "折1万次，会坏吗？iPhone Duo深度评测",
    "owner": "影视飓风",
    "duration": 1492,
    "url": "https://www.bilibili.com/video/BV1xrnz6gEVD",
    "cover": "https://i0.hdslb.com/..."
  },
  "track": {
    "lan": "ai-zh",
    "lanDoc": "中文",
    "source": "extension",
    "isAi": true,
    "url": "https://aisubtitle.hdslb.com/..."
  },
  "lines": [
    { "start": 0.14, "end": 1.1, "text": "既然是折叠屏" },
    { "start": 1.1, "end": 1.42, "text": "有问题" }
  ],
  "summary": "可选的 Markdown 总结",
  "model": "deepseek-chat"
}
```

成功响应：

```json
{
  "ok": true,
  "videoId": 1,
  "trackId": 1,
  "lineCount": 751,
  "created": false,
  "summarySaved": true
}
```

错误响应：

| 状态 | 场景 |
|---|---|
| 401 | Token 缺失或不匹配 |
| 400 | 不是合法 JSON、缺少 `video`、`lines` 为空 |
| 403 | 非本机连接 |
| 500 | 入库异常（错误信息在 `error` 字段） |

## 去重规则

- 视频按 `bvid + cid`（番剧按 `epId + cid`）唯一；重复推送会更新元数据。
- 字幕轨按 `video_id + lan + source` 唯一；重复推送会替换该轨的旧分段。
- 可选 `summary` 按视频唯一，后一次覆盖前一次。
- 分段写入 `segments` 与 FTS5 索引，搜索立即可见。

## 浏览器插件接入建议

> 扩展侧已经实现：`src/sidepanel/modules/desktop-bridge.js`（自动发现 + 推送）+
> 设置 → 桌面端 + 字幕面板「⋯ → 发送到桌面」。
> 桌面端设置 → 插件桥提供「安装浏览器插件」，会准备目录并打开扩展管理页。

1. `manifest.json` 增加：

```json
"host_permissions": ["http://127.0.0.1/*"]
```

2. 连接时先 `GET /v1/hello` 自动获取 `{ port, token }`；失败再回退到用户手填配置。
3. 在字幕面板加「发送到桌面」按钮：

```js
const info = await fetch('http://127.0.0.1:47821/v1/hello').then((r) => r.json());
const res = await fetch(`http://127.0.0.1:${info.port}/v1/ingest`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${info.token}`
  },
  body: JSON.stringify(payload)
});
const result = await res.json();
if (!result.ok) throw new Error(result.error || '推送失败');
```

4. 失败时不要清空本地数据：插件仍保留自己的 IndexedDB，等桌面端启动后重试。
5. Token 只保存在本机，不要写进日志或上传。

## 安装浏览器插件

桌面端 → 设置 → 插件桥 → **安装浏览器插件**：

- 自动定位扩展目录（打包版：`resources/extension`；开发版：仓库里的扩展源码）；
- 把目录路径写入剪贴板，并尝试打开已安装的 Edge / Chrome 扩展管理页；
- 按弹窗提示：开启「开发者模式」→「加载解压缩的扩展」→ 选择该目录。

扩展加载后会自动发现桌面端，无需再配对。

## 本机测试

```bash
node scripts/mocks/bridge-test.mjs
```

脚本会读取 `%APPDATA%\Electron\settings.json`（或 `BSUB_BRIDGE_SETTINGS` 指定的路径），
用其中的端口和 Token 调 `/v1/health` 与 `/v1/ingest`，并验证无 Token 时返回 401。
