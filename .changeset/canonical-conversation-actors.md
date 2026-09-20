---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/core": patch
---

Make `UserMessage.actor` the sole participant identity authority across IM trigger, Agent ingress, persistence, LLM rendering, session-tree previews, and compaction. Remove sender identity from `agent_messages.extra`, delete text-based sender recovery and duplicate sender types/helpers, and keep Core AI trigger results limited to canonical user content.
