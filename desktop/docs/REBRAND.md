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

0.36.0 已完成：
- 插件源码目录：`shizi-extension/`；
- 桌面桥 `app` 字段：`shizi`（需与插件 2.18.5 同步更新）；
- 插件名称：拾字 · B站字幕助手，短名称「拾字」；
- 插件资产名：`shizi-extension-v*`。

仍保留的只有历史兼容路径（不是品牌）：
- 旧数据目录 `%APPDATA%\bsub-desktop` 的读取与迁移；
- 旧指针 `bsub-desktop-location.txt` / `bsub-desktop-cleanup.txt` 的兼容读取。

> `appId` 变更后，0.34 及更早版本的自动更新链路不再指向新包；
> 当前只有单个用户且未下载旧安装包，因此直接切换。以后再做同类迁移需要
> “旧包继续更新到最后一版 → 提示手动安装新包”的过渡。


