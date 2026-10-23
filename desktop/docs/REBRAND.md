# 显示名与品牌调整

## 当前状态

桌面端对外显示名改为 **拾字 / Shizi**，副标题「视频与网页的 AI 笔记工作台」。

集中定义在 [`src/shared/brand.ts`](../src/shared/brand.ts)：

```ts
export const APP_NAME = '拾字';
export const APP_NAME_EN = 'Shizi';
export const APP_TAGLINE = '视频与网页的 AI 笔记工作台';
```

窗口标题、托盘 tooltip、首用向导、渲染页 `<title>` 已改用这个常量。

## 为什么没有改技术标识

以下标识暂时保持 **bsub-desktop / B站字幕助手**，否则会打断自动更新和已有用户的数据目录：

- `appId`: `com.bsub.desktop`
- `userData`: `%APPDATA%\bsub-desktop`
- electron-builder `productName`: `B站字幕助手`（安装包 / exe / latest.yml 的资产名）
- GitHub Release tag / 仓库名
- 扩展桥的 `name` 字段

## 正式改名时的清单

1. 定名（商标 / 域名 / GitHub 仓库名一起确认）；
2. 改 `package.json` 的 `build.productName` 与 `description`，同步 `desktop/README.md`、安装器文案；
3. 如需改 `appId`，先做旧版本自动更新过渡（旧包继续更新到最后一版，提示用户手动装新包）；
4. 数据目录迁移：新目录为空时自动复制旧 `%APPDATA%\bsub-desktop`，保留回退；
5. 同步 Release 资产名、`latest.yml`、`docs/SIGNING.md`、商店材料；
6. 改 `brand.ts` 一处即可让 UI 全量切换。
