# 贡献指南

这是一个个人维护的 B 站字幕助手扩展。欢迎 Issue 和 PR，但请尽量小步、可验证。

## 环境

- Node.js 18+
- Chrome / Edge 116+
- 不需要安装扩展依赖（扩展本身无构建步骤）

## 跑测试

```bash
cd verify
npm install
npm test                    # 21 个 node 套件
npm run test:browser:smoke  # 真实扩展：内嵌 / 评论区 / 侧边栏 / 设置页
```

完整套件见 [`verify/README.md`](verify/README.md)。改动核心逻辑后至少跑 `panel-test`、`bg-test`、`flow2`、`content-test`；改 FFmpeg / 音频相关再跑对应的真实浏览器套件。

## 发布 / 版本

发布前请按 [`docs/MAINTAINERS.md`](docs/MAINTAINERS.md) 的检查清单同步版本号、打包、Release 和 Edge 商店包。尤其注意：

- `manifest.json`、`src/shared/constants.js`、`src/content/content.js`、`src/content/page-bridge.js`、`verify/package.json` 和测试固定版本必须一起改；
- 内嵌面板、字幕身份、缓存相关的改动不要绕过 `docs/MAINTAINERS.md` 里的约束。

## 提交 PR

- 先开 Issue 说明要解决的问题，避免大改后方向不一致。
- 一个 PR 只做一件事；不要混入格式化、重命名和功能改动。
- 提交信息用 Conventional Commits，例如 `fix(panel): 修复…`、`docs: …`。
- 不要提交 API Key、Cookie、`.env`、抓包样本或本地路径。
- 改动用户可见行为时同步 README / CHANGELOG。

## 代码结构

| 目录 | 内容 |
|---|---|
| `shizi-extension/src/background/` | service worker：RPC、平台适配、检索、MCP |
| `shizi-extension/src/content/` | MAIN world 页面桥 + ISOLATED 内容脚本 |
| `shizi-extension/src/sidepanel/` | 侧边栏 UI 与业务逻辑 |
| `shizi-extension/src/shared/` | 设置、常量、存储、版本等 |
| `verify/` | 自动化测试，不属于扩展运行时 |

改代码前建议先读 [`shizi-extension/AGENTS.md`](shizi-extension/AGENTS.md)：里面记录了 CSP、service worker 生命周期、音轨请求等环境坑。
