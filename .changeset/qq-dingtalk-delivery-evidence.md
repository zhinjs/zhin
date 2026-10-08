---
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-dingtalk": patch
---

Reject QQ outbound responses carrying a nonzero platform error even when they contain a message ID. Classify DingTalk HTTP client rejection separately from uncertain server/network outcomes and avoid exposing raw platform response text in delivery errors.
