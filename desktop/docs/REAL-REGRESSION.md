# 真实回归记录

> 版本：0.30.1（合并 Release v2.17.2）
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
| 多轨切换 | ✅ | 同视频首次查询 2 轨 AI 中文，二次查询 1 轨，身份校验未串轨 |
| AI 总结 | ✅ | `deepseek-flash`，4242 字，流式完成 |
| AI 对话 | ✅ | 同片字幕问答 891 字，带时间点引用 |
| 字幕翻译 | ✅ | 20 行译为 English，时间轴保持 |
| AI 优化 | ✅ | 30 行输入，返回 10 处改动（如 `IPHONE` → `iPhone`） |
| AI 章节 | ✅ | 12 段，含标题与起止时间 |
| 真实 ASR | ✅ | `BV1GJ411x7h7` 213 秒 / 1.1 MB 音轨；2 段切片；10 行；29 秒；SenseVoice |
| B 站音轨候选 | ✅ | 3 条 candidate，首条 `playurl-api（已验证）` |
| 音轨 Range | ✅ | 1024 字节，`application/octet-stream` |
| Exa 在线搜索 | ✅ | 5 条真实结果 |
| 打包版 ffmpeg | ✅ | 之前 0.2.0 打包版 `asr-test.log: done lines=6` |
| URL 批量完整入库 | ✅ | 2 个 URL：2 成功 / 0 失败；库从 1 增到 3；后台标签自动关闭 |
| URL 批量失败分支 | ✅ | 1 正常 + 1 非 B 站链接 + 1 重复：成功 1、失败 1、重复去重；失败不阻塞 |
| 失效 BV / 404 | ✅ | 1 秒内失败「视频页面无效或已失效」，标签自动关闭 |
| 检索相关性排序 | ✅ | 无关结果被过滤 |

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
2. **真实 MCP 服务**：仍只有本地 mock；需要用户提供真实 HTTP/SSE MCP 服务。
3. **ASR 语种**：音乐视频中 SenseVoice 自动语种出现中/韩混出，属于模型自动识别限制；后续可按视频语言固定 `asr.language`。
4. **长视频/成本**：本次 AI 视频 24:52、字幕 751 行，未统计真实 token 费用。
5. **未签名**：SmartScreen 仍会提示；签名按当前决定暂不做。

## 结论

真实字幕、AI 总结/对话/翻译/优化/章节、真实 ASR、搜索、音轨链路均已跑通。  
剩余风险集中在 URL 批量完整入库、真实 MCP、ASR 语种与长视频成本，而不是主链路不可用。
