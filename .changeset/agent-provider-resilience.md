---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
---

Provider resilience for agent turns: classify provider errors (rate limit, timeout, 5xx, network, empty reply, malformed tool call), retry with exponential backoff honouring Retry-After, per-request timeout, fallback across `modelCandidates`, and per-model quirk presets (`emptyReplyRetries`, `requestTimeoutMs`; MiniMax M-series re-asks once on an empty reply). Configured via `ai.agent.providerResilience` with conservative defaults.
