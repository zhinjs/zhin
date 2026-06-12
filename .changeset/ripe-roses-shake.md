---
"@zhin.js/ai": minor
"@zhin.js/agent": minor
"@zhin.js/core": minor
---

refactor: remove legacy Agent class (1199 lines), migrate ChatMessage → AgentMessage, extract plugin-context.ts

- Delete legacy `Agent` class and its tests from `@zhin.js/ai`
- Extract `userMessageToFilterText()` as standalone utility
- Migrate `ChatMessage` → `AgentMessage` in prompt, session-io, task-continuation modules
- Remove Agent-related re-exports from ai/agent/core/zhin packages
- Extract AsyncLocalStorage + getPlugin into `plugin-context.ts` in core
