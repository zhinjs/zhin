---
'@zhin.js/ai': patch
'@zhin.js/agent': patch
---

Gemini provider fixes (#769). Gemini chat models now default to multimodal input, and images go out as typed file parts. Gemini 3 function-call thought signatures round-trip. SAFETY, RECITATION and blocked-prompt refusals, empty MAX_TOKENS replies and MALFORMED_FUNCTION_CALL now show up as visible errors instead of empty replies. Gemini `RetryInfo.retryDelay`, `API_KEY_INVALID` and RPC statuses feed retry classification. A new provider-config `providerOptions` field carries `safetySettings` and `thinkingConfig`, and opt-in `contextCache: { mode: 'explicit' }` adds explicit Gemini `cachedContents` with TTL refresh and invalidation. The nightly real-model evals now run on Gemini (`GEMINI_API_KEY`), with new multimodal eval cases.
