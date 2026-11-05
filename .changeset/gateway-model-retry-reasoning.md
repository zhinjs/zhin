---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
---

Restore MiniMax and Gemini empty-reply retry presets through the supported Anthropic and OpenCode Drivers, and default DeepSeek to one same-model extra attempt. Service defaults and exact-model overrides can still disable these presets with `emptyReplyRetries: 0`. The existing precedence over global resilience settings, Driver identity checks, exploration budgets and tool execution remain unchanged.

Preserve the model's declared thinking capability in SDK execution metadata, separately from its internal replay protocol. DeepSeek-compatible tool-call histories retain their required placeholder when a gateway omits reasoning; Google, Ollama, Anthropic and OpenAI native protocols do not acquire fabricated thinking. Real reasoning and signed/encrypted state are preserved; model capabilities are not inferred from names and no new user configuration is added.
