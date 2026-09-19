---
"@zhin.js/ai": minor
"@zhin.js/agent": minor
"@zhin.js/core": minor
---

Make `UserMessage.actor` the sole participant identity authority across IM trigger, Agent ingress, persistence, LLM rendering, session-tree previews, and compaction. Remove sender identity from `agent_messages.extra`, delete text-based sender recovery and duplicate sender types/helpers, and keep Core AI trigger results limited to canonical user content.
