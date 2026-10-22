# 真实回归记录

> 版本：0.30.7（合并 Release v2.17.8）
> 日期：2026-10-22
> 环境：Windows、DeepSeek API Key、SiliconFlow ASR Key、B 站已登录（`SESSDATA` 存在）。

## 前置条件

1. 桌面端「设置 → AI 平台」填好可用 Key。
2. 桌面端「设置 → 语音识别（ASR）」填好 Key。
3. 在桌面端完成 B 站扫码登录。
4. 准备有官方字幕的视频，以及一个无字幕/短公开视频用于 ASR。

本次三项均已满足：

- AI：DeepSeek
- ASR：SiliconFlow `FunAudioLLM/SenseVoiceSmall`
- B 站：已登录

## 实测结果

| 链路 | 结果 | 证据 |
|---|---|---|
| 官方字幕抓取 | ✅ | `BV1xrnz6gEVD`：1 轨 / 751 行，`needLogin=false` |
| 多轨切换 | ✅ | 同视频 2 轨 AI 中文（含 1 行广告轨）；默认异步选正文最多的正片轨（751 行） |
| AI 总结 | ✅ | `deepseek-flash`；开启核对后 4 项/6 条证据，语义判定执行，总结 3592 字 |
| AI 对话 | ✅ | 同片字幕问答 891 字，带时间点引用 |
| 字幕翻译 | ✅ | 20 行译为 English，时间轴保持 |
| AI 优化 | ✅ | 30 行输入，返回 10 处改动（如 `IPHONE` → `iPhone`） |
| AI 章节 | ✅ | 12 段，含标题与起止时间 |
| 真实 ASR | ✅ | `BV1GJ411x7h7` 213 秒 / 1.1 MB；2 段；10 行；`language=en` 时英文输出明显改善 |
| B 站音轨候选 | ✅ | 3 条 candidate，首条 `playurl-api（已验证）` |
| 音轨 Range | ✅ | 1024 字节，`application/octet-stream` |
| Exa 在线搜索 | ✅ | 5 条真实结果 |
| 打包版 ffmpeg | ✅ | 之前 0.2.0 打包版 `asr-test.log: done lines=6` |
| URL 批量完整入库 | ✅ | 2 个 URL：2 成功 / 0 失败；库从 1 增到 3；后台标签自动关闭 |
| URL 批量失败分支 | ✅ | 1 正常 + 1 非 B 站链接 + 1 重复：成功 1、失败 1、重复去重；失败不阻塞 |
| 失效 BV / 404 | ✅ | 1 秒内失败「视频页面无效或已失效」，标签自动关闭 |
| 检索相关性排序 | ✅ | 无关结果被过滤 |
| 真实 MCP HTTP | ✅ | Exa MCP：tools=`web_search_exa`/`web_fetch_exa`；真实搜索 GPT-5 返回网页内容 |
| 总结联网核对 | ✅ | 12 项 → 10 条证据；上下文查询 + 标签相关性 + 语义判定 |
| Markdown 表格 | ✅ | GFM 表格静态渲染验证 |
| 字幕身份守卫 | ✅ | 请求带 `expectSignature`，bundle 签名不一致拒绝 |
| 热门评论 | ✅ | B 站接口取 12 条热门评论，注入总结；总结 4400 字 |

## 本次新增测试入口

```bash
# 真实 AI：总结 / 对话 / 翻译 / 优化 / 章节
BSUB_LIVE_AI_TEST=1

# 真实 ASR
BSUB_LIVE_ASR_TEST=1
```

用正式 profile 运行：

```bash
BSUB_USER_DATA="$APPDATA/bsub-desktop" \
BSUB_LIVE_AI_TEST=1 \
BSUB_START_URL="https://www.bilibili.com/video/BV1xrnz6gEVD" \
npm run dev
```

## 已知问题 / 待补

1. **URL 批量边界**：非法链接/重复/失效 BV 已测；无字幕视频的失败分支未测。
2. **真实 MCP SSE**：HTTP 已用 Exa 真实端点验证；SSE 仍只有 mock。
3. **ASR 语种**：自动模式仍可能混出；显式设置 `asr.language=en` 已实测生效。
4. **长视频/成本**：本次 AI 视频 24:52、字幕 751 行，未统计真实 token 费用。
5. **核对词质量**：已过滤口语/泛词，但语音错字（如 DOO）仍可能被当成术语；后续可接上下文重排。
6. **判定覆盖**：AI 只对已搜到的证据判定；搜索失败/无证据的项仍为空。
7. **未签名**：SmartScreen 仍会提示；签名按当前决定暂不做。

## 结论

真实字幕、AI 总结/对话/翻译/优化/章节、真实 ASR、搜索、音轨链路均已跑通。  
剩余风险集中在 URL 批量完整入库、真实 MCP、ASR 语种与长视频成本，而不是主链路不可用。
