# 插件 ↔ 桌面桥协议（v1）

桌面端在本机 `127.0.0.1` 上启动 HTTP 服务，浏览器插件把抓到的字幕 / 总结推过来。
只监听回环地址，所有请求需要 Bearer Token。

## 配对

1. 桌面端打开 **设置 → 插件桥**，确认「启用本机接收」。
2. 记下端口（默认 `47821`，被占用时自动顺延）和 Token。
3. 在插件设置里填入同样的端口和 Token。

Token 首次启动时自动生成，保存在 `%APPDATA%\bsub-desktop\settings.json`。
泄漏后可在设置里改端口 / 清空 Token 重启，会重新生成。

## 接口

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
  "extensionVersion": "2.17.4",
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

> 扩展侧已经实现：`src/sidepanel/modules/desktop-bridge.js` +
> 设置 → 桌面端 + 字幕面板「⋯ → 发送到桌面」。
> 下面保留协议说明，方便后续维护或其它客户端接入。

1. `manifest.json` 增加：

```json
"host_permissions": ["http://127.0.0.1/*"]
```

2. 在插件设置里保存 `{ port, token }`（`chrome.storage.local`）。
3. 在字幕面板加「发送到桌面」按钮：

```js
const res = await fetch(`http://127.0.0.1:${port}/v1/ingest`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`
  },
  body: JSON.stringify(payload)
});
const result = await res.json();
if (!result.ok) throw new Error(result.error || '推送失败');
```

4. 失败时不要清空本地数据：插件仍保留自己的 IndexedDB，等桌面端启动后重试。
5. Token 只保存在本机，不要写进日志或上传。

## 本机测试

```bash
node spike/bridge-test.mjs
```

脚本会读取 `%APPDATA%\Electron\settings.json`（或 `BSUB_BRIDGE_SETTINGS` 指定的路径），
用其中的端口和 Token 调 `/v1/health` 与 `/v1/ingest`，并验证无 Token 时返回 401。
