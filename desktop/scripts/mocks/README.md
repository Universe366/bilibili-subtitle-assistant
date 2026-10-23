# 本地 mock 服务

用于本地验证 AI / ASR / MCP / 桥链路，不属于产品代码，不参与打包。

```bash
node scripts/mocks/mock-ai.mjs          # OpenAI 兼容流式总结
node scripts/mocks/mock-anthropic.mjs   # Anthropic /v1/messages
node scripts/mocks/mock-verify.mjs      # 总结核对
node scripts/mocks/mock-mcp.mjs         # MCP HTTP
node scripts/mocks/mock-mcp-sse.mjs     # MCP SSE
node scripts/mocks/mock-asr.mjs         # ASR
node scripts/mocks/bridge-test.mjs      # 模拟插件推送（桌面端需先启动）
