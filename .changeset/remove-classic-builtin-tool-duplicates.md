---
"@zhin.js/agent": patch
"zhin.js": patch
---

Remove the unused classic `createBuiltinTools()` aggregate and the duplicate class-based file, web-fetch, and TODO Tool implementations. These capabilities are now exposed only as generation-owned `@zhin.js/tool` definitions and executed through `ToolIndex` and `TurnToolRuntime`.
