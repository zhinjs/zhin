---
"@zhin.js/adapter-email": patch
---

Use the shared endpoint lifecycle for IMAP recovery, settle startup on stop, and isolate retired transport/fetch callbacks. Keep polling admission in flight through MIME parsing and dispatch; deduplicate completed mailbox/UIDVALIDITY/UID admissions within a bounded instance cache and permit failed admission retry. Document markSeen, restart and uncertain SMTP delivery boundaries.

Require SMTP recipient acceptance evidence instead of confirming a locally generated Message-ID alone. Map explicit SMTP rejection safely and preserve partial/network outcomes as delivery-unconfirmed without retry. Reject unmapped canonical reply/unknown segments before SMTP instead of silently dropping them.
