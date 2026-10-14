---
"@zhin.js/agent": patch
---

Tighten agent turns started by ordinary group members (not master, not in `trigger.trusted`): no bash, read-only files, and no outbound messaging tools. Restricted tools are hidden and also denied at execution with a clear reason (#719).
