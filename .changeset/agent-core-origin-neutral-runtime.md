---
'@zhin.js/agent': major
---

Make the full Agent Core origin-neutral by removing legacy IM Message and Plugin
lifecycle dependencies from model execution, compaction, and tool hooks. Tool
security remains exclusively owned by the required per-turn
`ToolExecutionAuthority`.
