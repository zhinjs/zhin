---
"@zhin.js/workroom": patch
"@zhin.js/agent": patch
---

Extract the Workroom, Portfolio and Data Governance domain code from `@zhin.js/agent` into the new `@zhin.js/workroom` package. `@zhin.js/agent` re-exports it unchanged (no export name changes); the old internal paths remain as temporary compatibility re-exports.
