---
"@zhin.js/command": patch
"@zhin.js/component": patch
"@zhin.js/core": patch
---

Resolve command permissions and command/component contexts from the current operation snapshot when unchanged projections are reused after hot reload. Preserve old snapshots for draining operations.
