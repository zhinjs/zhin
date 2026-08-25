---
"@zhin.js/cli": patch
"@zhin.js/core": patch
"@zhin.js/host-http": patch
---

Prevent concurrent Workroom discussions from losing their Orchestrator handoff, route those handoffs before ordinary commands, resolve cross-Endpoint projection replies through their canonical message reference, respect the global AI trigger switch, and reject unknown canonical Console session keys when the durable inbox is available.
