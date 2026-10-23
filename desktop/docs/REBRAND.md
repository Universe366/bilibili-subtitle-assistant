# 显示名与品牌调整

## 当前状态

桌面端对外显示名改为 **拾字 / Shizi**，副标题「视频与网页的 AI 笔记工作台」。

集中定义在 [`src/shared/brand.ts`](../src/shared/brand.ts)：

```ts
export const APP_NAME = '拾字';
export const APP_NAME_EN = 'Shizi';
export const APP_TAGLINE = '视频与网页的 AI 笔记工作台';
```

窗口标题、托盘 tooltip、首用向导、渲染页 `<title>` 已改用这个常量；
安装包 `productName` / 快捷方式 / 可执行文件名也已改为「拾字」。

## 已完成 / 仍保留的技术标识

0.33.0 已完成：
- 显示名、窗口标题、托盘、向导、HTML title：拾字；
- 安装包 `productName`、快捷方式、可执行文件：拾字；
- `package.json` `name` 与 userData：`shizi` / `%APPDATA%\shizi`，旧 `bsub-desktop` 首次启动自动迁移。

仍保留：
- `appId`: `com.bsub.desktop`（保证旧版本 NSIS 升级与自动更新 GUID 不变）
- GitHub Release tag / 仓库名：`bilibili-subtitle-assistant` / `v2.x`
- 安装包资产名：`artifactName` 固定为 `bsub-desktop-*`
- 扩展桥的 `name` 字段：`bsub-desktop`

## 如果要继续改 appId / 仓库名

1. 定名（商标 / 域名 / GitHub 仓库名一起确认）；
2. 改 `appId` 前先做自动更新过渡：旧包继续更新到最后一版，提示用户手动装新包；
3. 同步 Release 资产名、`latest.yml`、`docs/SIGNING.md`、商店材料；
4. 改 `brand.ts` 一处即可让 UI 全量切换。

