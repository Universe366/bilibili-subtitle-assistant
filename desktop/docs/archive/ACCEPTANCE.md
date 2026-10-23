# 桌面端迁移验收记录

## 0.30.9（2026-10-22）

| 功能 | 状态 | 验证方式 |
|---|---|---|
| Anthropic 原生协议 | ✅ | mock `/v1/messages`：流式总结 `streamed:15`、非流式总结、翻译；请求体含 `system` 且不带 `messages[0].role=system` |
| Anthropic 工具循环 | ✅ | mock MCP + mock Anthropic：第 1 轮 `tool_use`，第 2 轮带 `tool_result` 返回文本 |
| 总结核对 AI 检索词 / 额外查询 / 3 路并发 | ✅ | mock AI + mock 检索：生成 2 条 AI 查询（1 条因同句去重）、合并额外查询 1 条；每条 1 条证据，语义判定 `judged=true`，外部补充 1 条 |
| ASR 默认值迁移 | ✅ | 旧 120/1/20/120 自动改为 600/4/50/180 |
| 字幕缓存 30 天 + 复制总结 | ✅ | 构建通过 |
| 内置 Skills 迁移 | ✅ | 旧配置只有 1 个技能 → 4 个（deep_summary / qa_extract / glossary / timeline），`builtinVersion=2` |
| 首次使用向导 | ✅ | 新 profile 启动显示向导；`finishWizard` 后 `settings.json` 的 `wizardDone=true`；设置页可重新显示 |
| 字幕翻译视图 | ✅ | 原文 / 译文 / 双语三视图渲染，复制与导出口径一致；`tsc` + build 通过 |
| 字幕搜索高亮 | ✅ | 命中文字 `<mark>` 高亮；跳转命中行恢复跟随 |
| 字幕诊断补全 | ✅ | 逐来源错误（source/code/message）、外来轨明细、候选轨判定（下载/时长/覆盖） |
| 字幕清空 / 无轨兜底 | ✅ | 清空只清显示；无轨时可重新获取、触发播放器菜单、转写；字幕页可跳转生成章节 |
| 字幕轨自动换轨 | ✅ | 选中轨下载失败或空正文时按候选顺序再试，最多 3 条 |
| 字幕串视频修复 | ✅ | BV1MDhf6wEX8：错误轨 705 行/末句 1351s（视频 1195s）被拒；正确轨 491 行/末句 1194s 被选中 |
| 无字幕视频防串片 | ✅ | BV1KBJy69ET3（819s）：30 行/93s（11%）、12 行/34s（4%）、126 行/1225s（149%）、278 行/746s（无标题关键词）均被拒；官方接口 0 轨时丢弃页面桥结果，最终不显示错误字幕 |
| 官方接口交叉核对 | ✅ | **改为只信 WBI 签名接口**：BV1KBJy69ET3 的 `wbi/v2` 返回 0 轨 → 页面桥 `tracks=0`；BV1MDhf6wEX8 返回 1 轨 → 491 行正确轨 |
| 无字幕不再一直转圈 | ✅ | 同一轨重新获取也会重新校验；覆盖率/内容连续失败 4 次后停止，显示明确错误（日志 `[subtitle-coverage]` retry 0→4 后无后续请求） |
| 字幕获取提速 | ✅ | WBI 签名接口前置，成功即返回；无字幕视频 `sources=player/wbi/v2（空）` 后不再轮询其他来源 |
| 转录结果刷新保留 | ✅ | ASR 结果按视频签名缓存；刷新时无官方轨则恢复转录字幕并保留「语音转录」轨 |
| 翻译结果刷新保留 | ✅ | 翻译按「视频 + 轨」缓存；刷新后恢复译文/双语视图；编辑/优化/清空/重新转录时清除对应缓存 |
| 封面加载 | ✅ | 渲染页 `no-referrer` 后库封面 `naturalWidth` 实测 1672–2560，19 个视频全部加载 |
| 安装目录自动补全 | ✅ | 浏览选择父目录后 `.onVerifyInstDir` 立即追加「B站字幕助手」并刷新输入框；已以程序名结尾不重复追加；0.30.10 安装包编译通过 |
| 卸载清理 | ✅ | 勾选删除数据：`%APPDATA%\bsub-desktop`、自定义数据目录、`%LOCALAPPDATA%\bsub-desktop(-updater)`、`%TEMP%\bsub-asr-*`；不勾选保留数据 |
| 更改数据位置 | ✅ | 设置 → 更改位置：目标必须空目录；复制 settings/library/登录状态/日志，写入 `%APPDATA%\bsub-desktop-location.txt` 后重启；新进程启动后自动删除旧目录，失败保留待清理标记；失败重开原库 |
| 长视频分段总结 | ✅ | mock AI：5000 行字幕 → 5 段分段 + 1 次合并，状态 `长视频总结完成（5 段合并）` |
| 总结形式对齐插件 | ✅ | mock 请求体：`formatRules=true`、`skills=false`、systemLen=995；总结输出继续走 Markdown |
| 核对输出插件风格 | ✅ | 去掉 `[n]` 来源列表，改为外部补充 + 待核实证据；多源/冲突标记接入 |
| 核对判定兜底 | ✅ | 判定输出 maxTokens=3000；失败时只整理 0~3 条外部补充，界面折叠并提示「语义判定未完成」 |
| 快速总结 / 思考过程 | ✅ | `skipProofread` 已贯通 IPC；推理流事件 `ai:reasoning` 接入总结面板 |
| 面板常驻 | ✅ | 字幕 → 设置 → 字幕：字幕面板保持挂载（`markerKept=true`），仅 1 个面板 active；隐藏时暂停跟随轮询 |
| 探测模型完整显示 | ✅ | 模型列表取消 `slice(0,12/8)`，改为可滚动全量 + 关键词筛选；输入框 datalist 同步探测结果 |
| 插件桥自动发现 | ✅ | `GET /v1/hello`：本机/扩展 Origin 返回 port+token；`https://` 网页 Origin 返回 403；扩展侧失败自动重试 |
| 安装浏览器插件 | ✅ | `npm run build` 同步 73 个文件/32.3MB 到 `resources/extension`；检测到 Edge/Chrome 路径，点击后复制路径并打开扩展页 |
| 字幕页总结 / 章节入口 | ✅ | 工具栏按钮跳转总结页并触发 `bsub:summary-request` / `bsub:chapters-request` |

- 版本：0.30.9
- 日期：2026-10-22
- 范围：插件中桌面端适用的功能；页面注入类功能（内嵌侧边栏、播放器按钮、画面字幕）由桌面端原生 UI 替代，不迁移。

## 验收结果

| 功能 | 状态 | 验证方式 | 已知限制 |
|---|---|---|---|
| AI 对话 | ✅ | mock + 真实 DeepSeek（891 字） | 已真实跑通 |
| 总结联网核对 | ✅ | 抽词过滤后 4 项/7 条证据；语义判定；总结带引用 | 极短错字仍可能漏网 |
| 热门评论 | ✅ | B 站接口 12 条，注入总结（默认关闭） | 评论仅作参考 |
| 字幕翻译 | ✅ | mock + 真实 DeepSeek（20 行 English，时间轴保持） | 已真实跑通 |
| AI 优化字幕 | ✅ | mock + 真实 DeepSeek（30 行输入，10 处改动） | 已真实跑通 |
| ASR 转录 | ✅ | mock + 真实 SiliconFlow（213 秒，2 段，10 行；显式 en 生效） | 长视频成本仍是风险 |
| 批量 / 历史 | ✅ | 库内批量；URL 2/2 成功；非法/重复/失效 BV 分支验证 | 无字幕视频分支待补 |
| 导出扩展 | ✅ | VTT/ASS/笔记模板输出 | — |
| 质量检查 / 章节 | ✅ | 质检 5 类问题；mock 2 段 + 真实 DeepSeek 12 段 | 质检为启发式，非 AI |
| MCP / Skills | ✅ | HTTP 真实 Exa（tools/call 返回网页）+ SSE mock；对话工具循环；Skills 注入 | 真实 SSE 服务待联调 |
| 字幕诊断 | ✅ | 多源/嗅探/外来轨/原因字段展示与复制 | — |
| 字幕身份 | ✅ | `expectSignature` + bundle identity 校验；覆盖率选轨 | 需真实无字幕样本复测 |
| Markdown 表格 | ✅ | GFM 表格静态渲染验证 | — |
| 总结跨页 | ✅ | 浏览器标签切换不取消；侧栏卸载仍受限 | — |
| 多轨默认选择 | ✅ | 2 轨含广告轨时，默认选 751 行正片轨 | — |
| 设置 | ✅ | 通用/AI/ASR/提示词/检索/校对/导出/更新/MCP/Skills/桥/数据/诊断 | 高级项仍在补 |
| 更新 / 托盘 / 打包 | ✅ | 0.14.0 构建并启动，健康检查 200 | 未签名；自动更新需发布 Release |

## 自动化证据

- `npx tsc --noEmit`：通过。
- `npm run build`：通过。
- `[chat-test]`：`ok:true len:296`
- `[translate-test]`：`done` 两行译文，start/end 保持。
- `[optimize-test]`：`发现 2 处改动`。
- `[asr-test]`：WAV/M4A 均 `done lines=6`；打包版 `asr-test.log done lines=6`。
- `[quality-test]`：`bad-time / overlap / duplicate / low-coverage / early-end`。
- `[chapters-test]`：两段章节。
- `[batch-test]`：`succeeded:1, history:1`。
- `[mcp-test]`：`tools:["echo"], result:"echo: hello"`。
- `[mcp-chat]`：round 0 调用 `mock__echo`，round 1 输出最终回答。
- `[mcp-sse-test]`：`tools:["echo"], result:"sse: hello-sse"`。
- `[rank-test]`：无关结果被过滤，相关结果前置。
- `[urlbatch-test]`：后台打开/等待/登录门禁/关闭链路通过，未登录时明确报错、不误入库。

## 交付物

- 安装包：`release/bsub-desktop-setup-0.14.0.exe`
- 绿色版：`release/bsub-desktop-0.14.0-win-x64-green.zip`
- 自动更新元数据：`release/latest.yml`

## 发布状态

- 本地 0.30.7 已构建并运行。
- GitHub Release 最新为 **v2.17.8**（插件 2.17.8 + 桌面 0.30.7）；已发布。
- 未做代码签名；按当前决定暂不签名。

## 后续增强（不属于本次目标阻塞项）

1. URL 批量完整入库回归（登录态已具备，未跑完整多链接）。
2. 真实 MCP 服务联调。
3. ASR 语种固定/长视频成本统计。
4. 检索多来源一致/冲突统计。
5. 代码签名（当前决定暂不签名）。

## 0.15–0.23 差距补齐

- 字幕：查找/高亮/命中数、复制全部/单行、行数/字数/覆盖率。
- 翻译：自定义目标语言。
- 摘要：默认带视频简介；可选总结前 AI 校对。
- ASR：结果自动套规则；重叠切片/去重、自适应大小、单请求超时。
- 批量：暂停/继续、单项移除；URL 队列。
- 历史：总结/字幕两页；字幕缓存开关。
- 导出：时间戳缺失自动估算。
- 设置：字号缩放、侧栏宽度、分组搜索、Key 掩码/留空保留/明确清除。
- 对话：图片选择/粘贴/拖拽（最多 2 张）。
- 检索：相关性排序、Bocha/Serper、多源/单源/冲突统计。
- 平台：AI 27 家、检索 12 家、ASR 3 家；平台卡片支持测试/探测/高级字段。

真实回归已于 2026-10-22 用 DeepSeek + SiliconFlow + 已登录 B 站完成，证据见 `REAL-REGRESSION.md`。


## 0.30.1 真实回归

- 官方字幕：751 行，身份/多轨校验通过。
- AI 总结：DeepSeek 4242 字。
- AI 对话：891 字，带时间点。
- 翻译：20 行 English，时间轴保持。
- 优化：30 行输入，10 处改动。
- 章节：12 段。
- ASR：SiliconFlow SenseVoice，213 秒视频，2 段切片，10 行；自动模式 29 秒，显式 en 59 秒且英文更稳定。
- 搜索：Exa 5 条；音轨 3 条候选 + Range 1KB。
- URL 批量：2 个链接成功；非法/重复 URL、失效 BV（1 秒失败）分支通过。
- MCP：Exa 真实端点返回 `web_search_exa` / `web_fetch_exa`，实际搜索成功。

详细命令与原始证据见 [`REAL-REGRESSION.md`](REAL-REGRESSION.md)。
