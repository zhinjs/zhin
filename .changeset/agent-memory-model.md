---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
---

Semantic memory gets a data model and write policy (#733). Entries now carry `kind` (user_fact / preference / task_state / episodic), the writing turn and its trust level, `last_used_at` and a bounded version history; existing `memory_entries` tables gain the new columns at startup without losing rows. `memory_upsert` attributes writes to the turn (the model can no longer set `source`), keeps group members out of global/platform memory and away from facts written at a higher trust level, defaults group-member writes to their own `user` scope, and gives `task_state` a bounded expiry that can be tied to a task.
