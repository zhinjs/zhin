---
"@zhin.js/workroom": patch
"@zhin.js/agent": patch
---

Extract the Workroom, Portfolio and Data Governance domain code from `@zhin.js/agent` into the new `@zhin.js/workroom` package. Compatibility stubs at the old internal agent paths were removed in A4b (see `move-workroom-runtime`), together with the `./workroom/*.js`-style deep exports; `@zhin.js/workroom` exposes only its package root. Import from `@zhin.js/workroom`.
