---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/runtime": patch
---

模型请求首个响应超时（#1250 model-request-hangs-no-timeout）：`ai.agent.providerResilience` 新增 `firstResponseTimeoutMs`（默认 30000，0 关闭），`requestTimeoutMs` 默认值由 180000 降为 120000。在时限内收不到响应头或首个流事件即判定模型服务无响应（新增 `ProviderErrorKind` `no_response`）：不在同一模型上重试，回合经正常出站链回复「模型服务无响应」；写 `provider_timeout` warn 日志（会话、回合 id、用途、Provider 别名、模型、阶段、时限，不含内容与密钥），回合 trace 时间线记录 `model_timeout`。`StreamOptions` 新增 `onResponseStart`，SDK 传输在收到响应头时调用。
