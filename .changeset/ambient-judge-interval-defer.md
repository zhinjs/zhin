---
"@zhin.js/cli": patch
"@zhin.js/ai": patch
"@zhin.js/runtime": patch
---

Ambient engagement no longer drops a burst that lands inside `judgeIntervalMs`: it waits for the window to end on the same ticket (a newer message still supersedes it), re-checks cooldown, hourly cap and conversation state, then judges the latest messages. Previously such a burst was skipped with `judge_interval` and never re-judged unless someone spoke again.
