---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/runtime": patch
---

Add optional public R2 publishing for generated and outbound inline images, plus approval-gated workspace image uploads. Keep image bytes out of tool results and subsequent context when storage is enabled.

Keep MCP image originals in a scoped local store with seven-day retention and bounded capacity. Expose on-demand inspection through `get_local_assets`, projecting images only into the next model request and sharing perception limits with authorized child turns.
