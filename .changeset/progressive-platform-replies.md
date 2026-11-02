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
"@zhin.js/plugin-runtime": patch
---

Enable progressive final answers by default in supported QQ C2C, Telegram private drafts, Slack threads, Lark cards and Sandbox conversations. Set an adapter's streaming option to false to retain complete-message delivery. Outbound middleware must explicitly opt in with incremental: true; other middleware and unsupported scenes retain complete-message delivery. Discord retains complete-message delivery.

Preserve source-account leases, media order and confirmed delivery facts across cancellation, capacity rollover and follow-up answer phases. Preview drafts and uncertain outcomes do not become sent history. Bound each reply's semantic snapshot to 1 MiB, retain confirmed prefixes on failure and avoid replaying published answers.

Project the latest confirmed message revision into paginated conversation history and synchronize Sandbox message updates across connections. Existing adapter implementations and complete-send callers remain compatible.

Keep confirmed content when stream closing fails, preserve reply routing across physical containers, and stop unsupported Markdown continuations without replay or plain-text downgrade. Add rebuildable revision metadata and indexes to the existing conversation event table for bounded history reads; original events and retention remain unchanged.
