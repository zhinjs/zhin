---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Move Agent Host composition, database activation, runtime introspection, and MCP lifecycle helpers to `@zhin.js/agent/runtime`, and remove the classic `ToolRuntime` machinery from the package root. `composeZhinAgentRuntime` now returns the composed runtime carrying its internal Host contract, so the CLI no longer imports or calls `asPrivate` itself.
