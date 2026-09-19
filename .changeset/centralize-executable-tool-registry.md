---
"@zhin.js/agent": patch
---

Centralize each turn's executable tool snapshot in `ExecutableToolRegistry`, removing duplicate mutable maps from full and standalone Agent loops and keeping model projection and runtime lookup on one authority.
