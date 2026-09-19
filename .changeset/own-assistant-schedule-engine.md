---
"@zhin.js/kernel": minor
"@zhin.js/core": minor
"@zhin.js/agent": minor
"zhin.js": minor
---

Remove process-global ScheduleEngine and Scheduler getters and setters. Each assistant ScheduleJobEngine now owns and disposes an isolated scheduler, preventing cross-runtime job collisions and stale timers.
