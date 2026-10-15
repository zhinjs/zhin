---
'@zhin.js/ai': patch
'@zhin.js/agent': patch
---

fix(ai): `completeText`（压缩、上下文摘要、子 agent 摘要）与主对话路径对齐。
- 经现有 provider 韧性层（`createResilientCompletionPort`）做错误分类、退避重试、单次超时（默认 180s）和同 provider 模型 fallback；SDK 自带重试置 0，避免重试叠加。
- `TextCompleteOptions` 新增 `signal`、`timeoutMs`、`fallbackModels`、`resilience`；压缩与摘要调用方在有取消信号时透传，取消不再走降级摘要，也不计入自动压缩熔断。
- 只返回正文，绝不把模型的 thinking 当摘要；内容安全 / 长度失败抛出 `CompletionFailureError`（消息即面向用户的说明）。
- 未指定模型时优先使用 provider 配置的 `defaultModel`。
