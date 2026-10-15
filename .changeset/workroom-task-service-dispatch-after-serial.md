---
"@zhin.js/workroom": patch
---

Room Task: subscribers are dispatched after the Room serial section so re-entrant `execute` no longer deadlocks; the DB journal validates `expectedSequence` for empty batches (matching the memory journal); assigning a Task to its current assignee is rejected.
