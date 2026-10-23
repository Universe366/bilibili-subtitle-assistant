# 安全政策

## 支持范围

这是个人维护的浏览器扩展。安全修复会优先进入最新 Release，旧版本不单独维护。

## 报告安全问题

请**不要**在公开 Issue 里贴以下内容：

- API Key / Token / Cookie / 密码；
- 带完整请求头的抓包；
- 可复现的隐私数据或未脱敏截图。

推荐在 GitHub 通过 **Security → Report a vulnerability** 私下报告（如果仓库已开启）；
否则先发一个不含敏感信息的 Issue，说明“有安全问题，希望私下联系”，再交换细节。

## 密钥存放

- API Key 只保存在本机 `chrome.storage.local`；
- 不会同步到其他设备，不会上传到项目服务器；
- 设置备份 / 导出 ZIP 会包含明文 Key，分享前必须删除；
- 诊断信息默认不含明文 Key，但仍建议贴之前扫一眼。

## 扩展权限

扩展需要的权限及用途见 [`shizi-extension/docs/EDGE-STORE.md`](shizi-extension/docs/EDGE-STORE.md)。
如果你发现某个权限被用于非文档描述的目的，请按上面的方式报告。

## 依赖

- 项目代码：MIT；
- 内置 FFmpeg.wasm core：GPL-2.0-or-later，见
  [`shizi-extension/THIRD-PARTY-NOTICES.md`](shizi-extension/THIRD-PARTY-NOTICES.md)。
