---
"@zhin.js/adapter-qq": patch
---

Send QQ replies as passive messages. The Endpoint never passed the user message's `msg_id`, so every reply went out as an active message (quota-limited, blocked when the user turns off active messages). It now records each conversation's recent `msg_id` and interaction `event_id` and replies passively within the platform limits (group 5 min × 5, C2C 60 min × 4, guild 5 min), preferring an explicit reply segment. An expired or exhausted source falls back to one active message; an unknown outcome or a content rejection never does. Conversations that refuse active messages are skipped for an hour, and Markdown the platform does not allow is resent as plain text. Requires `qq-official-bot` 1.3.3, which accepts the Endpoint's per-source `msg_seq` so a retried passive reply is deduplicated by the platform.
