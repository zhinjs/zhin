---
"@zhin.js/agent": minor
"@zhin.js/cli": patch
---

Move Agent Host composition, database activation, runtime introspection, and MCP lifecycle helpers to `@zhin.js/agent/runtime`, and remove the classic `ToolRuntime` machinery from the package root. `composeZhinAgentRuntime` now returns its narrow Host contract directly, so the CLI no longer crosses the package boundary through `asPrivate`.
