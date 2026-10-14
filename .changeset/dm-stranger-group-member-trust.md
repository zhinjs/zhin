---
'@zhin.js/agent': patch
---

**Behaviour change (#753):** IM private chats from senders who are neither the owner (`master`) nor on `trigger.trusted` now get the `group_member` trust level instead of `trusted_member`. Such stranger DMs no longer get `bash`, file-write or send-to-other-conversation tools. Owner DMs, trusted-list DMs and non-IM ingress (HTTP, CLI, schedules) are unchanged. To restore full authority for a DM user, add their ID to `trigger.trusted`.
