---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

ADR 0038 slice D: before sending, a turn whose sender followed up into a merge window drops its stale reply (audit `merge_reply_stale_discarded`) and the next merged turn answers old and new messages together; replies of turns that called a tool or hit the hard gate, and a sender chain already dropped once, are sent anyway (`merge_reply_stale_sent`).
