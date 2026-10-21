# 桌面端迁移验收记录

- 版本：0.24.0
- 日期：2026-10-22
- 范围：插件中桌面端适用的功能；页面注入类功能（内嵌侧边栏、播放器按钮、画面字幕）由桌面端原生 UI 替代，不迁移。

## 验收结果

| 功能 | 状态 | 验证方式 | 已知限制 |
|---|---|---|---|
| AI 对话 | ✅ | mock AI 流式回答，296 字 | 真实模型需 Key |
| 字幕翻译 | ✅ | mock AI 两行翻译，时间轴保持 | 真实模型需 Key |
| AI 优化字幕 | ✅ | mock 返回 2 处改动；勾选/应用链路 | 真实模型需 Key |
| ASR 转录 | ✅ | mock 音频 WAV/M4A 各 3 段 6 行；打包 ffmpeg 路径；真实音轨候选/Range | 真实 ASR 平台需 Key；完整长视频未跑 |
| 批量 / 历史 | ✅ | 库内 1 视频批量总结成功；历史 1 条可查 | URL 批量需登录 B 站 |
| 导出扩展 | ✅ | VTT/ASS/笔记模板输出 | — |
| 质量检查 / 章节 | ✅ | 质检命中 5 类问题；章节 mock 返回 2 段 | 质检为启发式，非 AI |
| MCP / Skills | ✅ | HTTP 与 SSE 各完成 initialize/tools/list/tools/call；对话自动工具循环；Skills 注入 | 真实 MCP 服务需用户配置 |
| 字幕诊断 | ✅ | 多源/嗅探/外来轨/原因字段展示与复制 | — |
| 设置 | ✅ | 通用/AI/ASR/提示词/检索/校对/导出/更新/MCP/Skills/桥/数据 | 部分高级项随后续功能补 |
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

- 本地 0.14.0 已构建并运行。
- GitHub Release 最新为插件 2.17.0（含桌面 0.2.0 资产）；0.14.0 尚未发布。
- 未做代码签名；正式分发前需签名与 Release 流程。

## 后续增强（不属于本次目标阻塞项）

1. URL 批量在登录态下的完整入库回归。
2. ASR / 翻译 / 优化 / 章节的真实平台回归。
3. 检索多来源一致/冲突统计。
4. 设置分组继续随功能细化。
5. 代码签名与 0.14.0 发布。

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
- 平台：AI 27 家、检索 12 家、ASR 3 家；每平台可配模型/地址/Key/官网。

真实平台回归仍需 AI/ASR Key 与 B 站登录态，见 `REAL-REGRESSION.md`。
