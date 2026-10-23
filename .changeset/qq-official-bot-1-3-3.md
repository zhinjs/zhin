---
"@zhin.js/adapter-qq": patch
---

Upgrade `qq-official-bot` to 1.3.3 and send the passive-reply `msg_seq` the Endpoint assigns per source, so the platform's `msg_id + msg_seq` deduplication protects a retried passive reply.
