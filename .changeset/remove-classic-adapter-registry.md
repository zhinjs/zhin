---
'@zhin.js/core': patch
'zhin.js': patch
---

Remove the unused process-global `Adapter.Registry`, `Adapter.register`, and `Adapter.Factory` APIs. Adapter definitions and live instances are now discovered and owned only by the current generation's `AdapterIndex`.
