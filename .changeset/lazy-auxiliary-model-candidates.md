---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
---

Resolve summary and perception models only when they are used. Plain chat no longer validates unused auxiliary Drivers, and a successful perception primary does not validate its backups. Compaction resolves its summary model only after finding a prefix to summarize, while retaining the current operation's graph, deployment summary source, failure handling and cancellation.

`ModelExecutionScope.summary`, `perception` and `perceptionFallbacks` now expose declared candidates: call `resolve()` to obtain an executable model bundle. Consumers of this API must update both `@zhin.js/ai` and `@zhin.js/agent` to versions containing this changeset; older paired releases do not provide the deferred compaction execution contract.
