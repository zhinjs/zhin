---
"@zhin.js/core": patch
"@zhin.js/im-contract": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Give each IM runtime one dedicated conversation owner for event-store replacement, inbound and outbound fact recording, notice normalization, reference lookup, context aggregation, and consumer cursors. Split the conversation contract into reader and writer ports so Agent and CLI receive only the read capability while Core retains mutation authority.
