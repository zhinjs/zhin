---
'@zhin.js/agent': major
'@zhin.js/cli': patch
---

Replace the process-global semantic-memory repository and classic memory tools with a generation-owned `SemanticMemoryRuntime` and native ToolFeature definitions. Enabling semantic memory now requires a ready Database Host and `memory_entries` model; invalid candidates fail closed instead of silently using process-global or ephemeral memory.

Completed orchestration runs are no longer written to semantic memory implicitly. Persisting a run summary now requires an explicit, authorized memory write through the generation-owned tool/runtime, so orchestration completion and durable user memory no longer share a hidden side effect.
