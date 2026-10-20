---
"@zhin.js/core": patch
"@zhin.js/agent": patch
"zhin.js": patch
"@zhin.js/feature-kit": patch
"@zhin.js/testing": patch
---

Plugins can now import the AI completion contract from the `zhin.js` main entry without depending on `@zhin.js/agent` (#877). `@zhin.js/core` defines `aiCompletionToken` (same id, and `@zhin.js/agent` re-exports the same object), the `AiCompletion*` / `UsageSubject` types, `usageSubjectFromMessage(message)` (same quota key rules as Agent turns; returns `undefined` when the message has no sender), `isAiCompletionQuotaError(error)` and `hasResource(context, token)`. Construction and capability contexts gain an optional `has(token)` member (the built-in ones and the `@zhin.js/testing` fake plugin implement it), so plugins can check for optional resources without try/catch.
