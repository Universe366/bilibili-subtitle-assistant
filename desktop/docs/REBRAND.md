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

0.35.0 已完成：
- `appId`: `com.shizi.desktop`；
- GitHub 仓库：`Universe366/shizi`；
- 安装包资产名：`shizi-setup-*` / `shizi-*-win-x64-green.zip`；
- 自动更新 feed 指向新仓库。

仍保留：
- 扩展桥的 `app` 字段：`bsub-desktop`（协议常量，改它需要同步扩展并中断旧插件连接）；
- 扩展源码目录名：`bilibili-subtitle-assistant/`（插件本身仍以 B 站为主）。

> `appId` 变更后，0.34 及更早版本的自动更新链路不再指向新包；
> 当前只有单个用户且未下载旧安装包，因此直接切换。以后再做同类迁移需要
> “旧包继续更新到最后一版 → 提示手动安装新包”的过渡。


