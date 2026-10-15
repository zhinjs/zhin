---
'@zhin.js/ai': patch
'@zhin.js/agent': patch
---

Provider config fixes. Provider `timeout` and `maxRetries` now take effect: they override `ai.providerResilience` for that provider, below per-model harness settings. New opt-in `firstChunkTimeoutMs` / `chunkTimeoutMs` abort streams that connect but go silent, and the stall is retried and failed over like any timeout. `authScheme` now works for every scheme (`Token`, `Bearer`, `''`) on chat requests and model discovery alike. The `sdk: openai` `baseUrl` gets `/v1` on a bare proxy root, like the other OpenAI-protocol providers; `compat.appendV1: false` keeps the old as-written behaviour. `compat.supportsDeveloperRole: false` sends `system` instead of `developer` to reasoning models. OpenAI refusals now surface as a content-policy message instead of an empty reply. MiniMax `baseUrl` values ending in `/anthropic` or naming only a host are completed to `/anthropic/v1`, and `@ai-sdk/minimax` is declared as an optional peer dependency. `compat.supportsReasoningContent` and `compat.toolCallsInAssistant` are deprecated no-ops, and gateway presets no longer set them.
