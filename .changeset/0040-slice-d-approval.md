---
'@zhin.js/agent': patch
'@zhin.js/cli': patch
---

ADR 0040 slice D: a self-change that passes its trial is submitted for approval as a `self` card in the hard-gate approval queue — always delivered to the owner's private chat (never settled in a business group), human-only, bound to the content hash, one pending change per conversation, 24-hour timeout, re-issued after restart; Console lists, approves and rejects changes.
