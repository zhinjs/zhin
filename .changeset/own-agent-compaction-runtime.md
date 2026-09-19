---
'@zhin.js/agent': minor
---

Move conversation compaction state into a host-owned `AgentCompactionRuntime`. Automatic compaction, manual compaction, lifecycle cleanup, and stability metrics now operate on the same explicit runtime instance, so multiple Agent hosts cannot share or evict each other's session state.

Remove the process-global compaction state helpers. `@zhin.js/agent/memory` now exposes the class-based runtime, including instance-local metrics, LRU pressure eviction, and cleanup.
