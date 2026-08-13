---
"@zhin.js/tool": patch
"@zhin.js/agent": patch
"@zhin.js/mcp": patch
---

Make canonical invocation origin and principal display identity part of every
Tool execution context. IM, HTTP, A2A, Schedule, Internal, and MCP callers now
carry structured origin data through ToolIndex instead of requiring tools to
read a legacy IM Message side channel.
