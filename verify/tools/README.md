# verify/tools

开发辅助脚本，**不属于测试套件**，不参与 CI。

| 脚本 | 用途 |
|---|---|
| `make-icons.mjs` | 用本机 Chrome/Edge 渲染 `icons/icon{16,32,48,128}.png` |
| `make-m4a-sample.mjs` | 在真实 Chrome 里生成 `sample-mediarecorder.m4a`，供 MP4/M4A 结构测试使用 |
| `sw-capture-test.mjs` | 让真实扩展 service worker 向本地抓包服务发请求，核对实际发出的头部/body |

从 `verify/` 目录运行，例如：

```bash
node tools/make-m4a-sample.mjs
node tools/make-icons.mjs
```

`sample-mediarecorder.m4a` 生成在 `verify/` 根目录，已被 `.gitignore` 忽略。
