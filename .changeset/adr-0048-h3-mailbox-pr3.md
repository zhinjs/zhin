---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/runtime": patch
---

ADR 0048 H3 PR-3 (closes #1179): due timers become `timer` Mail on the host Mailbox (lane `timer:<jobId>`). `TimerScheduler` + `createTimerMailDueHandler` replace `ScheduleJobEngine` / `JobWorker` / `job-scheduler` / `job-utils`. Kernel `ScheduleEngine` remains the clock; N retries / dead-letter stay a projection over `ScheduleExecutionQueue`. Event ingress triggers timer / event Mail. Eval Gap A `deliverTimerMailInbound` is real; harness-timer-*×4 unskipped.

**Breaking removals:** `ScheduleJobEngine`, `JobWorker`, and the `assistant.queue` config key. A config that still sets `assistant.queue` fails startup with a migration hint (retries are internal to `TimerScheduler`; Mailbox policy stays under `ai.agent.mailbox`).
