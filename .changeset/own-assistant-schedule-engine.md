---
"@zhin.js/kernel": patch
"@zhin.js/core": patch
"@zhin.js/agent": patch
"zhin.js": patch
---

Remove process-global ScheduleEngine and Scheduler getters and setters. Each assistant ScheduleJobEngine now owns and disposes an isolated scheduler, preventing cross-runtime job collisions and stale timers.
