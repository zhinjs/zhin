---
'@zhin.js/mcp': patch
---

remove(host/mcp): delete legacy MCP scaffolding tools

Remove handlers.ts, tools.ts, prompts.ts, and resources.ts (1,358 lines)
which contained outdated scaffolding code for plugin/command/component
generation. These were not part of the core MCP server functionality and
had no active consumers. mesh-auth.ts updated to remove orphaned imports.
