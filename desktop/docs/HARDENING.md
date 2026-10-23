# 加固与扩展验收记录（0.32.0）

> 范围：单实例、密钥加密、站点权限、CSP、日志/诊断、schema 迁移、回收站、备份校验、库压缩、浏览器与 AI 扩展。
> 版本 0.32.0，已本地打包（setup + 绿色 zip），**未发布**。

## 1. 自动化检查

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过（0 error） |
| `npm run lint` | 通过（0 error；存量 `any`/未使用变量为 warning） |
| `npm test` | 通过：14 个测试文件 / 59 个用例 |
| `npm run build` | 通过：main / preload / renderer 均产出 |
| `npm ci --dry-run` | 通过（lockfile 与 package.json 一致） |
| GitHub Actions `desktop-ci.yml` | PR / push main 跑 typecheck + lint + test + build |

测试覆盖：

- `url.test.ts`：URL 归一化
- `exporters.test.ts`：SRT / VTT / ASS / Markdown / TXT / JSON、译文优先
- `video.test.ts`：选轨优先级、`videoKeyOf`
- `secrets.test.ts` / `settings.secrets.test.ts`：DPAPI 封装、明文迁移、导出剔除、备份恢复保留本机 Key
- `migrations.test.ts`：0 → 2、幂等
- `trash.test.ts`：删除 → 快照 → 恢复（字幕/总结/笔记/标签/合集）→ 彻底删除、VACUUM
- `backup.test.ts`：备份不含 Key、SHA-256 校验、篡改拒绝、恢复后数据与 Key 正确
- `diagnostics.test.ts`：诊断包内容与脱敏
- `browser.test.ts`：历史去重/搜索、书签增删、下载进度、AI 本地工具
- `platformKey.test.ts`：本机端点免 Key

## 2.1 阶段 3 手工验收

| 场景 | 方法 | 结果 |
|---|---|---|
| 任意页面对话 | 打开 example.com，读取 `page:context` | 905 字正文，聊天面板显示「当前页面 · 905 字」 |
| 页面内容进 prompt | 本地 mock AI 记录请求体 | system 里包含页面标题、正文与「不可信资料」标记 |
| 本地模型免 Key | mock 平台 `127.0.0.1:8899`，apiKey 为空 | 对话返回 `MOCK_OK`，未发 Authorization |
| 历史记录 | 访问两个页面后读 `listBrowseHistory` | 2 条，同 URL 60 秒内合并 |
| 书签 | 地址栏星标点击 | 图标变为 `is-active`，书签列表 +1 |
| 历史/标签面板 | 地址栏菜单、`Ctrl+Shift+A` | 面板打开，行数正确 |
| 会话恢复 | 关闭后重启同一 profile | 恢复 example.com 标签并激活 |
| 显示名 | 窗口标题 | `拾字` |
| 网页总结入库 | 对话面板点「总结本页」 | 提示已存入，库中出现「Example Domain」，含总结、无字幕轨 |
| 下载落盘 | 本地 HTTP 返回 attachment，`BSUB_DOWNLOAD_DIR` 自动保存 | 记录 `completed` 5/5 字节，文件存在 |
| 本地音频导入 | 2 秒 wav + mock ASR + `BSUB_LOCAL_MEDIA` | 任务 done「已入库 1 行字幕」，库中出现 `file://` 条目 |
| 划词工具条 | example.com 选中段落后点「解释」 | 工具条显示 3 个按钮，对话自动发送选中文本并返回 mock 回答 |
| 阅读模式 | example.com 点地址栏书本图标 | 标题/站点/字数正确，正文 905 字，可关闭 |
| 下载控制 | 4MB 慢速下载 → 暂停/继续/取消 | 状态依次 `paused` / `progressing` / `cancelled` |
| 清除浏览数据 | 设置里执行 | 返回 `cleared:true`，Cookie/缓存被清空 |
| 播客导入 | 本地 RSS + wav + mock ASR | 预览 1 集，导入任务 done「已入库 1 行字幕」，库条目链接指向单集页 |
| YouTube 解析 | json3 / timedtext XML 固定样本 | 53 个用例通过；本机网络无法访问 YouTube，未做真实页面联调 |

## 2. 手工验收

| 场景 | 方法 | 结果 |
|---|---|---|
| 单实例 | 第一个实例运行中再启动一次 | 第二个进程立即退出，第一个窗口保留 |
| 明文 Key 迁移 | 临时 profile 写入明文 `sk-plain-test-…` 后启动 | 日志 `[settings] 已加密 1 个 API Key`，磁盘只剩 `enc:v1:` |
| 生产 CSP | `electron-builder --dir` 后启动，CDP 读取 DOM | `#root` 有内容、1 个样式表、`window.bsub` 为 object，无 CSP 报错 |
| 权限默认拒绝 | 在内嵌 B 站页执行 `navigator.permissions.query` | geolocation / notifications / microphone 均为 `denied` |
| 回收站 UI | 演示库：库 → 删除条目 → 回收站 → 恢复 | 回收站显示「含总结 · 含笔记」，恢复后条目回到库列表 |
| 日志 | 启动后检查 `userData/logs/main-*.log` | 有启动、迁移、桥、标签页日志，已脱敏 |

## 3. 本地构建

| 产物 | 结果 |
|---|---|
| `release/win-unpacked/` | 已重建，可启动；`拾字.exe`、窗口标题「拾字」，CSP 下 UI 正常 |
| `release/bsub-desktop-setup-0.32.0.exe` | 已生成（NSIS，未签名） |
| `release/bsub-desktop-0.32.0-win-x64-green.zip` | 已生成，含 `拾字.exe` 与 README.txt |
| `release/latest.yml` | version 0.32.0，指向 setup 0.32.0 |

## 4. 已知取舍

- `safeStorage` 同步 API 在 Electron 45 标记 deprecated；改成 async 会牵动所有 `loadSettings()` 调用点，留到升级 Electron 大版本时处理。
- ESLint 仍有约 100 条存量 warning（`any`、未使用变量），本轮不阻塞构建；新代码不要新增。
- 权限弹窗在窗口关闭后仍可能回调，已做 `isDestroyed` 判断。
- 回收站快照按 JSON 存库，超大字幕会增大 `library.db`；用 30 天 / 200 条上限兜底。
- 打包验证使用临时输出目录，没有改 `release/` 里的正式产物，也没有改版本号。
