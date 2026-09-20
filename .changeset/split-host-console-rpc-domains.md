---
"@zhin.js/host-http": patch
---

Split extended Console RPC into a thin protocol dispatcher plus cohesive schedule, inbox, login, Endpoint-management, and Workroom control modules. Keep request parsing and generation-leased Endpoint execution behind explicit internal helpers while preserving the package-root API and wire protocol.
