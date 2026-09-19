---
"@zhin.js/plugin-repeater": minor
---

Replace the process-wide Repeater singleton and reset helper with a generation-owned `RepeaterEngine` resource. Commands and middleware now resolve the exact engine from their Plugin Runtime operation scope, and plugin disposal clears only that generation's state.
