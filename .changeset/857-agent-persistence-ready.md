---
"@zhin.js/cli": patch
"@zhin.js/agent": patch
---

Fix the occasional 5 s stall on an Agent turn (`SessionSystem waitForPersistence: timeout`) when `@zhin.js/workroom` is not installed. Only the Workroom persistence coordinator marked Agent persistence ready, so in Agent-only setups the first turn of every new Agent generation waited for the fallback timer. The Agent host now marks readiness itself when Workroom is absent, and `waitForPersistence` clears its fallback timer once readiness arrives (#857).
