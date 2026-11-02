---
"@zhin.js/adapter": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/cli": patch
"@zhin.js/core": patch
"@zhin.js/im-contract": patch
"@zhin.js/middleware": patch
---

Deliver validated final answers progressively through configured QQ C2C, Telegram drafts, Slack streams, Lark cards and Sandbox updates. Keep complete-message delivery for unsupported scenes, disabled adapters and outbound middleware that does not explicitly support revisions. Discord retains complete-message delivery.

Preserve source-account leases, media order and confirmed delivery facts across cancellation, capacity rollover and follow-up answer phases. Preview drafts and uncertain outcomes do not become sent history. Bound each reply's semantic snapshot to 1 MiB, retain confirmed prefixes on failure and avoid replaying published answers.

Project the latest confirmed message revision into paginated conversation history and synchronize Sandbox message updates across connections. Existing adapter implementations and complete-send callers remain compatible.
