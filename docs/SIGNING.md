# Windows 代码签名

> 当前公开安装包**未签名**，SmartScreen 会提示。本文是签名接入流程，不代表证书已经配置。

## 1. 先选路线

| 路线 | 适合 | 大概成本 | CI 友好度 |
|---|---|---|---|
| **SignPath Foundation** | 开源项目 | 免费 | 高（GitHub App / 上传产物） |
| **Certum Open Source Cloud** | 开源项目 | €49/年左右 | 中（云签名工具） |
| **Azure Trusted Signing** | 符合地区/主体资格 | 约 $10/月 | 高（electron-builder 原生支持） |
| **SSL.com eSigner OV** | 个人/组织 | 约 $129/年起 | 中（eSigner/自定义签名） |
| **传统 OV/EV + USB Token** | 有 Windows runner | 数百美元/年 | 低（需插 Token） |

> 价格与资格会变，以厂商页面为准。自 2023 年起代码签名私钥必须放在硬件/云 HSM，**不要默认还能拿到可导出的 PFX**。

### 对当前项目的建议顺序

1. **先申请 SignPath Foundation**：开源项目可免费签名，最省钱。
2. 如果不满足/不想等：**Certum 开源云签名**（约 €49/年）。
3. 如果你在美国/加拿大/欧盟/英国且有主体：**Azure Trusted Signing**，约 $10/月，electron-builder 直接支持。
4. 预算充足且需要商业支持：SSL.com eSigner / DigiCert / Sectigo 的云签名。

不建议买 USB Token 版本：GitHub Actions 的 Windows runner 插不了 Token，除非自建 runner。

## 1.1 SignPath Foundation

- 免费给符合条件的开源项目做 Authenticode 签名；
- 通过 GitHub App/工作流上传待签产物，签完再发布；
- 需要申请审核，签名主体是 SignPath Foundation；
- 适合本项目这种 MIT 开源、GitHub Release 分发。

申请入口：<https://signpath.org/>

## 1.2 Certum 开源云签名

- Certum 有 Open Source Code Signing Cloud，约 **€49/年**；优秀开源项目可申请免费；
- 私钥在云 HSM，不导出 PFX；
- 通常用 SimplySign/云签名工具，CI 需要该厂商的签名方式，不能直接当 `CSC_LINK` PFX 用。

## 2. GitHub Actions 接入

### 2.1 PFX（仅当厂商允许导出）

工作流已经预留：

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

### 2.2 Azure Trusted Signing（electron-builder 原生）

先确认资格：当前 Microsoft 文档写的是组织限美国/加拿大/欧盟/英国，个人开发者限美国/加拿大；中国大陆主体通常不满足，需用 Certum/SSL.com/SignPath。

符合资格时，在 `desktop/package.json` 的 `build.win` 里加：

```json
"azureSignOptions": {
  "publisherName": "你的证书主体名称",
  "endpoint": "https://<region>.codesigning.azure.net",
  "certificateProfileName": "你的 Certificate Profile",
  "codeSigningAccountName": "你的 Trusted Signing Account"
}
```

并在 GitHub Secrets 配置服务主体：

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`

workflow 已把这些变量传给 electron-builder。electron-builder 会调用
`Invoke-TrustedSigning`，不需要 PFX。

> 没有 `azureSignOptions` 时不会走 Azure；只配 Secrets 不会自动签名。

### 2.3 SignPath / 云签名

SignPath、Certum SimplySign、SSL.com eSigner 这类方案不走 `CSC_LINK` PFX，
需要在 workflow 里增加“上传产物 → 调用签名服务 → 下载已签产物”的步骤，
或者用 `win.signtoolOptions.sign` 指定自定义签名命令。不要把它们误配成 PFX。

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
signtool verify /pa /v release\shizi-setup-0.38.10.exe
signtool verify /pa /v release\win-unpacked\拾字.exe
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

- 当前安装包均未签名；
- 工作流已预留签名环境变量；
- 证书、Secret、签名验证尚未配置。
