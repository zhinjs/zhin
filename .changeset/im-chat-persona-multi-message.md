---
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

IM conversation turns now get a chat prompt: the workspace persona (SOUL.md) leads, a chat style section replaces the report-style one, and the coding-workflow sections are reduced to a short "workspace tasks" note; critical rules no longer claim to override the persona. Structured replies become `{"messages":[{"segments":[...]}]}` so the model can send several short messages, delivered in order with a short pause; a legacy single `{segments}` reply is still accepted. Workspace prompt files may use a `{{nickname}}` slot filled from `ai.agents.<name>.nickname` (default `Zhin`).
