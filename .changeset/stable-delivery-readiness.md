---
"@zhin.js/cli": patch
"@zhin.js/runtime": patch
---

Add snapshot-scoped readiness probes and `zhin doctor --live` for required database, endpoint slots and Agent bindings. Load optional Agent and Workroom dependencies on demand so IM-only projects can start without the AI stack, while preserving Agent command help.
