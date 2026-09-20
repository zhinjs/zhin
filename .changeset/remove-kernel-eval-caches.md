---
"@zhin.js/kernel": patch
"@zhin.js/core": patch
"zhin.js": patch
---

Remove process-global expression and proxy caches from Kernel evaluation. Every evaluation now compiles independently and owns its proxy identity map for the lifetime of one sandbox, so unrelated runtimes cannot share hidden evaluator state.
