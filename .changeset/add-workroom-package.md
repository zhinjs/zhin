---
"@zhin.js/workroom": patch
"@zhin.js/agent": patch
---

Extract the Workroom, Portfolio and Data Governance domain code from `@zhin.js/agent` into the new `@zhin.js/workroom` package. Compatibility stubs at the old internal agent paths are removed in the A4b-era release (see `move-workroom-runtime`); import from `@zhin.js/workroom`.
