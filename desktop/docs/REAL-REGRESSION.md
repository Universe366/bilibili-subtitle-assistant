# 真实回归清单

> 目标：在真实 AI / ASR Key、真实 B 站登录态下，把 mock 验证过的链路再跑一遍。
> 当前版本：0.14.0。

## 前置条件

1. 桌面端「设置 → AI 平台」填好一个可用 Key，点「保存并测试」。
2. 桌面端「设置 → 语音识别（ASR）」填好 Key，模型与音频格式保持默认或按平台选择。
3. 在桌面端打开 `https://passport.bilibili.com/login` 完成扫码登录。
4. 准备一个**有官方字幕**的 B 站视频（AI 字幕需要登录）。

## 当前已完成的真实链路

| 链路 | 结果 | 证据 |
|---|---|---|
| Exa 在线搜索 | ✅ | 5 条结果，BibiGPT / Edge 插件等 |
| B 站音轨候选 | ✅ | 3 条 candidate，首条 `playurl-api（已验证）` |
| 音轨 Range 下载 | ✅ | 1024 字节，`application/octet-stream` |
| 字幕登录门禁 | ✅ | `needLogin=true`，未登录不误入库 |
| 打包版 ffmpeg | ✅ | `asr-test.log: done lines=6` |
| URL 批量后台标签 | ✅ | 打开、等待、登录提示、关闭 |
| 检索相关性排序 | ✅ | 无关结果被过滤 |

## 待真实回归

| 链路 | 需要的凭据 |
|---|---|
| 字幕抓取 / 多轨切换 | B 站登录 |
| URL 批量完整入库 | B 站登录 |
| AI 总结 / 对话 | AI Key |
| 字幕翻译 | AI Key |
| AI 优化 + 联网核对 | AI Key + 检索 Key（或免 Key 引擎） |
| AI 章节 | AI Key |
| ASR 语音转录 | ASR Key |

## 建议步骤

1. 填 Key、登录后，先打开一个有字幕的视频，确认「字幕诊断」里 sources/tracks 不为空。
2. 依次跑：总结 → 对话 → 翻译 → 优化 → 章节。
3. 找一个**无字幕**视频跑「转写」，确认 M4A/WAV、平台与进度。
4. 批量页粘贴 1~2 个链接，确认入库与历史。
5. 如失败，把「诊断」复制内容和 toast 第二行发出来。

## 当前环境检查结果

- `%APPDATA%\bsub-desktop\settings.json`：AI 平台 Key 全空，无 ASR 配置段。
- B 站 cookies：无 `SESSDATA`，`isLogin=false`。
- 因此真实 AI / ASR / 字幕 / URL 入库无法在当前环境继续，需先完成前置条件。
