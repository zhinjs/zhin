---
'@zhin.js/tool': major
'@zhin.js/agent': major
---

Require every Tool invocation to carry immutable permission, unattended, and network policy into `ToolExecutionContext`. Tool transports can now enforce the exact fixed-Turn authority at each side-effect boundary without process-global execution context.
