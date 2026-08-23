---
"@zhin.js/agent": major
---

Close lifecycle races across IM activity indicators, subagent cancellation and schedule feedback: retry inactive starts, serialize native typing keepalives with cleanup, await generation disposal without task-observer self-deadlocks, propagate subagent abort signals without delivering retired-generation results, preserve spawn/start/finish ordering, and make same-scene schedule locks executor-owned and lifecycle-drained. The deprecated global schedule-lock drain remains exported for compatibility but now fails explicitly with migration guidance instead of falsely reporting that generation-owned executors were drained.
