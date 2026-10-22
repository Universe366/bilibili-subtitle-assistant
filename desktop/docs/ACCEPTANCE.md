# 桌面端迁移验收记录

- 版本：0.30.1
- 日期：2026-10-22
- 范围：插件中桌面端适用的功能；页面注入类功能（内嵌侧边栏、播放器按钮、画面字幕）由桌面端原生 UI 替代，不迁移。

## 验收结果

| 功能 | 状态 | 验证方式 | 已知限制 |
|---|---|---|---|
| AI 对话 | ✅ | mock + 真实 DeepSeek（891 字） | 已真实跑通 |
| 总结联网核对 | ✅ | 4 项/6 条证据；Exa + AI 语义判定；总结下方核对面板 | 错字词仍可能被抽中 |
| 热门评论 | ✅ | B 站接口 12 条，注入总结（默认关闭） | 评论仅作参考 |
| 字幕翻译 | ✅ | mock + 真实 DeepSeek（20 行 English，时间轴保持） | 已真实跑通 |
| AI 优化字幕 | ✅ | mock + 真实 DeepSeek（30 行输入，10 处改动） | 已真实跑通 |
| ASR 转录 | ✅ | mock + 真实 SiliconFlow（213 秒，2 段，10 行；显式 en 生效） | 长视频成本仍是风险 |
| 批量 / 历史 | ✅ | 库内批量；URL 2/2 成功；非法/重复/失效 BV 分支验证 | 无字幕视频分支待补 |
| 导出扩展 | ✅ | VTT/ASS/笔记模板输出 | — |
| 质量检查 / 章节 | ✅ | 质检 5 类问题；mock 2 段 + 真实 DeepSeek 12 段 | 质检为启发式，非 AI |
| MCP / Skills | ✅ | HTTP 真实 Exa（tools/call 返回网页）+ SSE mock；对话工具循环；Skills 注入 | 真实 SSE 服务待联调 |
| 字幕诊断 | ✅ | 多源/嗅探/外来轨/原因字段展示与复制 | — |
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

- 本地 0.30.1 已构建并运行。
- GitHub Release 最新为 **v2.17.2**（插件 2.17.2 + 桌面 0.30.1）；已发布。
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
