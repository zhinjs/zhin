---
"@zhin.js/adapter-email": patch
---

Report observed IMAP readiness and connection loss in endpoint health, and log successful SMTP verification plus IMAP startup at info level.

Normalize incoming sender identities to mailbox addresses so display names do not prevent conversation allowlist matching. Start unread-mail polling only after the endpoint opens, avoiding startup consumption before admission is available.
