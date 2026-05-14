---
"@zhin.js/bridge-ipc": minor
"@zhin.js/bridge-supervisor": minor
"@zhin.js/bridge-outbound-gate": minor
"@zhin.js/bridge-inbound-glue": minor
"@zhin.js/bridge-miao-child": minor
"@zhin.js/docs": patch
"@zhin.js/agent": patch
---

feat(bridge): add v1 IPC glue stack and DX docs ([#404](https://github.com/zhinjs/zhin/issues/404)).

Also: fix `phaseTrace` test to assert on `Logger.prototype.info` (matches `ZhinAgent` implementation) so CI is stable.
