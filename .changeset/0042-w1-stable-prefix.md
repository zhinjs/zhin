---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

ADR 0042 §1: the IM system prompt is now built as a byte-stable prefix (system / environment / role_rules / platform, plus the platform reply instruction and exploration guidance) and a per-turn scene tail (scene line, network note, pre-fetched data). The AI request context carries `systemPromptCacheBreakpoint`; Anthropic receives two system blocks with `cache_control` on the stable block only, Gemini receives two system parts, and other providers still get one string with the stable part first. Gemini explicit context caching now caches only the stable system part plus tools (the scene tail moves into `contents`), treats a 404/unsupported `createCachedContent` as permanent for that model, and logs the reason once per model with the API error message instead of on every prefix change.
