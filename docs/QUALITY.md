# 质量现状与后续重构建议

> 更新：2026-10-24，桌面端 0.37.2 / 插件 2.18.6。
> 这不是路线图承诺，是对当前代码的真实评估。

## 当前基线

| 指标 | 数值 |
|---|---|
| Git 跟踪文件 | 278 |
| 当前树体积 | 约 36 MB（FFmpeg.wasm 占 31 MB） |
| 桌面单测 | 26 个文件 / 102 个用例 |
| 插件测试 | 520 项 |
| ESLint | **0 error / 0 warning** |
| 桌面冒烟 | `npm run smoke`（真实 Electron + CDP，9 条 E2E） |
| CI | 桌面（master/PR）+ 插件（master/PR）+ tag 发布 |

本次已经做掉的：

- 移除 31 个历史发布 zip（约 320MB）和逐版本 release-notes；
- 删除 `desktop/spike/`，mock 服务归位到 `desktop/scripts/mocks/`；
- 历史验收/方案归档到 `desktop/docs/archive/`；
- 提取 `renderer/lib/format.ts`，去掉 7 处重复的时长/日期/字节格式化；
- 修复桌面 CI 监听错分支（`main` → `master`）；
- 新增插件 CI；
- 新增 `npm run pack`，保证打包前一定执行 `prebuild` 同步插件资源；
- 本地工作区从 6.4GB 清到约 1.7GB，临时测试目录清零；
- 桌面冒烟扩展为 6 条 E2E（设置读写、字幕入库/检索、笔记、回收站删除恢复）；
- 新增 IPC channel 清单与漂移测试（`scripts/ipc-channels.json` + `src/main/ipcChannels.test.ts`）；
- `ipc.ts` 按域拆到 `src/main/ipc/`：library / browser / page / settings / media / jobs / tools / records，`ipc.ts` 从 2.8k 降到 43 行（只保留注册入口）。

## 仍然值得做的（按优先级）

### P1：拆分巨型文件

| 文件 | 行数 | 建议 |
|---|---:|---|
| `src/main/library.ts` | 102 行 | 纯桶文件；14 个域模块在 `library/*.ts` |
| `src/renderer/.../SettingsPanel.tsx` | ~3.0k | 拆 AI / ASR / 检索 / 数据 / 插件桥 section |
| `src/renderer/.../LibraryPanel.tsx` | ~2.3k | 拆列表、详情、标签/合集、批量操作 |

为什么现在没动：`library.ts` 与两个 React 组件没有组件级测试兜底，直接拆容易“编译通过、交互坏掉”。
`ipc` 域现在有 9 条 E2E（设置/库/笔记/回收站/任务/AI 校验/历史导出）兜底，可以照着同样的节奏来；
`library.ts` 建议先拆出 schema 与 search（有单测覆盖），再动数据写入部分。

### P1：收敛 JSON 边界的 `any`

已全部收口：外部响应改为具体结构，跨模块用 `src/shared/json.ts` 的读取器
外部 API 响应。建议：

1. 定义 `JsonValue` / `JsonObject`；
2. 每个外部响应先 `unknown`，再用小型 `readString/readNumber/readArray` 收窄；
3. 只对真正动态的字段保留 `any`，并在 ESLint 里按目录白名单。

这比“把 any 改成 unknown 再强转”更有价值，能减少运行期 `undefined`。

### P2：把冒烟放进 CI

`npm run smoke` 目前只在本地跑。发布 workflow 是 Windows，可以在打包前加一步
`npm run smoke`；如果 GitHub 托管的 Windows 会话能稳定启动 Electron，就能在
发布前拦住“窗口打不开/ preload 没注入”这类问题。

### P2：桌面与插件的重复逻辑

YouTube 解析、URL 规范化、时长格式化在两边各有一份。短期可以接受（一边 TS、
一边原生 JS），长期建议抽成不依赖 Electron/浏览器的纯函数包，至少共享测试向量。

### P3：文档继续瘦身

`ARCHITECTURE.md` 仍有 600 行。可以按“数据层 / 浏览器与字幕 / AI / 安装器”
拆成四篇，ARCHITECTURE 只留总览和链接。当前有 `REPO-MAP.md` 兜底，不急。

### P3：可访问性与国际化

弹窗焦点陷阱、键盘导航、`aria-*` 覆盖不完整；界面只支持中文。
自用阶段不急，但这是“给人用”的下一层。

## 重构顺序建议

1. 补 5 条桌面 E2E；
2. 拆 `ipc.ts`（纯搬运，不改行为）；
3. 拆 `library.ts`；
4. 收敛 `any`；
5. 拆两个最大的 React 组件。

每一步都保持 `typecheck + lint + test + smoke` 全绿再提交。
