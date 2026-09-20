---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"zhin.js": patch
---

Publish `generate_image` as a generation-owned native Tool Feature for both main and subagent turns. Provider lookup and image defaults now stay with the Host-owned `AIService`, execution follows the canonical `ToolIndex` and `TurnToolRuntime` path, and the detached class-based implementation is removed.
