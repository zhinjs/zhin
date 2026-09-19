---
"@zhin.js/kernel": minor
"@zhin.js/core": minor
"zhin.js": minor
---

Remove process-global expression and proxy caches from Kernel evaluation. Every evaluation now compiles independently and owns its proxy identity map for the lifetime of one sandbox, so unrelated runtimes cannot share hidden evaluator state.
