# 更新源与国内镜像

> 适用：桌面端 ≥ 0.37.5（设置 → 版本更新 → 国内镜像源）
> 结论先说：**能自动切换，但 Gitee 免费版放不下 136 MB 的安装包**，所以推荐「Gitee 只放 latest.yml + 安装包放对象存储」。

## 1. 客户端行为

| 配置 | 行为 |
|---|---|
| 什么都不填 | 内置 GitHub Releases（`electron-updater` 的 GitHub provider） |
| 只填「自定义更新源」 | 强制使用该 generic 目录，不再测速 |
| 填「国内镜像源」+ 自动测速开 | 每次检查前并发探测两个源的 `latest.yml`，镜像可用且比 GitHub 快 300ms 以上才切镜像 |
| 填镜像 + 自动测速关 | 强制走镜像 |

失败重试：当前源报错时，若配置了镜像且没有强制指定自定义源，会自动换另一个源再试一次，状态里的「源：」会显示最终使用的源。

## 2. Gitee 的限制（重要）

- Gitee 免费/社区版：**单个附件 ≤ 100 MB**，单仓库附件总量 1 GB。
- 本项目安装包约 136–143 MB，绿色包约 195 MB —— 都超过 100 MB，**无法直接作为 Gitee 发行版附件**。
- 付费套餐单文件上限更高（需以 Gitee 当前配额为准），企业版才可能放下安装包。

因此有两种可行方案：

### 方案 A（推荐）：Gitee 放指针，安装包放对象存储

1. 把安装包上传到任意直链存储（阿里云 OSS / 腾讯云 COS / 七牛 / 自建 nginx），拿到永久 URL；
2. 从 GitHub Release 下载 `latest.yml`，把 `files[].url` 改成**绝对地址**，例如：

   ```yaml
   version: 0.37.5
   files:
     - url: https://cdn.example.com/shizi/shizi-setup-0.37.5.exe
       sha512: <保持原值>
       size: <保持原值>
   path: https://cdn.example.com/shizi/shizi-setup-0.37.5.exe
   sha512: <保持原值>
   releaseDate: '2026-10-24T07:00:00.000Z'
   ```

3. 在 Gitee 建一个空的公开仓库，把这份 `latest.yml` 放到 `releases/download/v0.37.5/` 对应的发行版附件里（小于 100MB，没问题）；
4. 客户端「国内镜像源」填：

   ```
   https://gitee.com/<owner>/<repo>/releases/download/v0.37.5
   ```

   注意：**每个版本要改一次这个地址**（或者用 Gitee Pages / 自己的域名做一个固定的 latest 目录，把 latest.yml 放那里，里面再用绝对 URL 指安装包）。

### 方案 B：仅 Gitee（适合以后包体 < 100 MB）

如果将来安装包压到 100 MB 以内，直接把 `latest.yml` + `shizi-setup-x.y.z.exe` 一起作为 Gitee 发行版附件，镜像地址填该版本的 `releases/download/<tag>` 即可。

## 3. 其他可选镜像

- **ghproxy 类加速**：`https://ghproxy.com/https://github.com/Universe366/shizi/releases/download/v0.37.5`（第三方，稳定性不保证）；
- **自建静态目录**：任何能放 `latest.yml` 的 HTTPS 目录都能作为 generic 源，包括对象存储、Nginx、Cloudflare R2。

## 4. 校验与排错

- 设置 → 版本更新 → 「检查」，状态里会显示「源：GitHub / 镜像 / 自定义」；
- 日志关键词：`[update] source github=123ms mirror=87ms`、`[update] 使用镜像更新源 ...`；
- 镜像源 404 时表现为 `检查失败`，客户端会自动回退 GitHub（若自动测速开启）；
- 改了源之后不需要重启，下一次检查就会重新选择（自动检查每 6 小时一次，也可以手动点「检查」）。

## 5. 发布侧需要同步的事

- 每个版本在 GitHub Release 之后，更新 Gitee 的 `latest.yml`（绝对 URL 指向新包）；
- 保持 `sha512`/`size` 与安装包一致，否则 `electron-updater` 会拒绝安装；
- 绿色包不参与自动更新，只需在 Release 说明里给手动下载链接。
