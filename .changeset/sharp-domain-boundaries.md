---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Separate Workroom, Portfolio, and Data Governance domain contracts from Agent runtime composition. Assignment grants, disclosure authority, remote execution, governed dispatch reasons, catalog validation, and effect blocker ports now belong to their domain modules; the local model assignment adapter moves to `@zhin.js/agent/runtime`. Remove the deprecated Workroom catalog config aliases and enforce the domain dependency direction in the architecture harness.
