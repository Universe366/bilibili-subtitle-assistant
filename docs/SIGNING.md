# Windows 代码签名

> 当前公开安装包**未签名**，SmartScreen 会提示。本文是签名接入流程，不代表证书已经配置。

## 1. 证书选择

- **OV 代码签名证书**：普通软件签名，适合本项目；CI 可用 PFX。
- **EV 代码签名证书**：SmartScreen 信誉更好，但很多是 USB Token，不能直接放进 GitHub Actions。
  - 若使用 Token，需要自建 Windows runner 或云签名服务。
- **Azure Trusted Signing**：微软云签名，适合 CI；需要在 workflow 里接自定义签名步骤，本文不展开。
- 不建议购买“个人开发者”无法核验的便宜证书；签名主体要与产品一致。

## 2. GitHub Actions 接入

工作流 `.github/workflows/desktop-release.yml` 已经预留：

```yaml
env:
  CSC_IDENTITY_AUTO_DISCOVERY: 'false'
  CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
  CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

在仓库 **Settings → Secrets and variables → Actions** 添加：

| Secret | 内容 |
|---|---|
| `WIN_CSC_LINK` | PFX 的 base64 字符串，或 electron-builder 支持的 HTTPS 地址 |
| `WIN_CSC_KEY_PASSWORD` | PFX 密码 |

PFX 转 base64（PowerShell）：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) | Set-Clipboard
```

不要把 PFX、密码、base64 提交进仓库或贴到 Issue。

## 3. 本地签名

```powershell
$env:CSC_LINK = "C:\path\cert.pfx"
$env:CSC_KEY_PASSWORD = "password"
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
cd desktop
npm run dist
```

electron-builder 会给应用 exe、安装包、卸载器签名。

## 4. 验证

```powershell
signtool verify /pa /v release\bsub-desktop-setup-0.30.1.exe
signtool verify /pa /v release\win-unpacked\B站字幕助手.exe
```

- 两个都必须有有效签名；
- 时间戳应存在；
- 证书主体与发布者一致。

## 5. 发布与更新影响

- 签名不改变 `latest.yml` 的版本/哈希，但安装包哈希会变；
- 自动更新会校验下载的安装包签名（electron-updater 默认行为）；
- 从未签名版本升级到签名版本时，Windows 可能仍提示一次，之后信誉会逐步建立；
- 更换证书后，老版本自动更新可能因 publisher 不一致失败，需要提前测试或保留手动下载入口。

## 6. CI 注意

- Fork PR 无法读取 Secrets，签名步骤只在主仓库 tag/手动触发时有效；
- `CSC_IDENTITY_AUTO_DISCOVERY=false` 防止 CI 误用机器上其他证书；
- 证书过期前更新 Secret；过期后新版本无法签名，但旧版本仍可运行；
- 如果 Secret 为空，electron-builder 会走未签名构建，不会自动报错——发版前看 CI 日志确认 `signing with signtool.exe`。

## 7. 当前状态

- 0.30.1 及更早安装包均未签名；
- 工作流已预留签名环境变量；
- 证书、Secret、签名验证尚未配置。
