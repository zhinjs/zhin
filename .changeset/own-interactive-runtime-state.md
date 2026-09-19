---
"@zhin.js/core": minor
"zhin.js": minor
---

Remove the duplicate classic interactive handler registry and process-global keyboard fallback store. `ImRuntime` now owns one encapsulated interactive router whose handlers and fallback mappings are isolated by runtime instance, generation, and conversation.
