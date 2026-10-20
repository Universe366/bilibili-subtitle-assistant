# verify/tools

开发辅助脚本，**不属于测试套件**，不参与 CI。

| 脚本 | 用途 |
|---|---|
| `make-icons.mjs` | 用本机 Chrome/Edge 渲染 `icons/icon{16,32,48,128}.png` |
| `make-m4a-sample.mjs` | 在真实 Chrome 里生成 `sample-mediarecorder.m4a`，供 MP4/M4A 结构测试使用 |
| `sw-capture-test.mjs` | 让真实扩展 service worker 向本地抓包服务发请求，核对实际发出的头部/body |
| `make-banner.py` | 生成 `docs/banner.png` 与 `docs/social-preview.png`（Pillow） |
| `release.mjs` | 从 CHANGELOG 提取当前版本说明；加 `--create` 可直接建 Release 并上传 zip（需 `GITHUB_TOKEN`） |

从 `verify/` 目录运行，例如：

```bash
node tools/make-m4a-sample.mjs
node tools/make-icons.mjs
```

`sample-mediarecorder.m4a` 生成在 `verify/` 根目录，已被 `.gitignore` 忽略。

## 发布

```bash
node tools/release.mjs                 # 生成 release-notes-v<版本>.md 并打印
GITHUB_TOKEN=... node tools/release.mjs --create  # 建 Release + 上传 zip
```

`--create` 要求工作区干净，token 只从环境变量读取，不写进仓库。
