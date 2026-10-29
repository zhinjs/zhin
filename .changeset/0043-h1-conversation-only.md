---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
---

ADR 0043 §1 (H1): history stores conversation only. Per-turn context blocks (`[Turn context]` with time, told ledger, recalled memory, tone hint, merged-turn and danmaku lines; `deferred-tools`, `workspace-rules`, `skill:*`, `file-memory:*`, `session-rules:*`, `session-guidance`, `session-identity`, `active-skills`, `deferred-catalog-summary`, `quote-guidance`) are now marked `perTurn` when built and dropped by `normalizeUserMessageForStorage`; the current message sent to the model is unchanged. `projectPromptContext` also strips them (identified by flag, contextRef key or legacy text prefix) from every earlier user message, so rows stored before this change stop replaying them; stored data is never rewritten.
