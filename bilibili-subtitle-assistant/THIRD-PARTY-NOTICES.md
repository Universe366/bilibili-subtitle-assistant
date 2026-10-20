# 第三方组件与许可证

本项目自己的代码使用 [`LICENSE`](LICENSE)（MIT）。

## FFmpeg.wasm / FFmpeg core

`bilibili-subtitle-assistant/vendor/ffmpeg/` 包含：

- `ffmpeg-core.js`、`ffmpeg-core.wasm`：由 [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) 构建的 FFmpeg WebAssembly 核心；
- `ffmpeg-api.js`、`ffmpeg-worker.js`：本项目打过补丁的 ffmpeg.wasm 包装层。

**FFmpeg core 的许可证不是 MIT。** 经检查，仓库内 `ffmpeg-core.wasm` 包含 `--enable-gpl`、`libx264`、`libx265` 等编译标记，属于 **GPL-2.0-or-later** 构建（FFmpeg 默认是 LGPL-2.1-or-later，但链接 GPL-only 组件后整体按 GPL 分发）。

- FFmpeg 源码：https://ffmpeg.org/download.html
- ffmpeg.wasm 源码与构建脚本：https://github.com/ffmpegwasm/ffmpeg.wasm
- GPL-2.0 许可证全文：[`LICENSES/GPL-2.0.txt`](LICENSES/GPL-2.0.txt)

本项目通过在 GitHub 公开仓库分发对应源码与构建产物来满足 GPL 的源码提供要求；`vendor/ffmpeg/` 里的包装层补丁也包含在同一仓库中。

## 其它

`verify/` 下的测试依赖（jsdom、esbuild 等）只用于开发，不随扩展发布，适用其各自的许可证。
