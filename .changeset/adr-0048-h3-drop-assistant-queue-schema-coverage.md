---
"@zhin.js/runtime": patch
---

Align host-config schema coverage with ADR 0048 H3: `assistant.queue` is no longer a schema property (startup rejects the key; retries live inside `TimerScheduler`). Drop the coverage paths and null-retention fixtures that still walked `assistant.queue.maxConcurrency`.
