---
"@zhin.js/adapter-qq": patch
"@zhin.js/cli": patch
"@zhin.js/core": patch
"@zhin.js/adapter": patch
---

Bound QQ startup to 30 seconds with cancellation and late-client cleanup, own asynchronous CLI startup failures, and patch qq-official-bot session startup so authentication/receiver failures reject the returned promise without orphan rejection or lost synchronous readiness.

Encode native QQ callback buttons with official action type 1, subscribe to interaction events by default, and map SDK action notices into canonical clicks with platform ACK and honest source-message association metadata.

Reject outbound messages containing segments excluded by an explicit adapter supported policy, and reject unimplemented QQ share cards instead of silently dropping title/description/URL while confirming neighboring text.
