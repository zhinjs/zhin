---
"@zhin.js/agent": patch
---

ADR 0041 slice D: system prompt assembly now runs on a `PromptSegmentRegistry`. Built-in sections map onto text segment kinds (`system` → `environment` → `role_rules` → `platform` → `scene`, descending weight within a kind), so the persona/style rules now follow the security rules instead of leading the prompt, and the volatile git status moves into `scene`. Plugins contribute segments through `promptSegmentToken` (released with their generation); `mergeMessageSegments` is the pure chronological merge for message segments (tie order, tool pairing, event relocation, append-only). `PromptAssemblyRegistry` is a deprecated adapter over text segments. `describePromptSectionsForDebug`, the context-budget report and `zhin trace` list each segment's id / kind / weight / chars / trimmed. `buildRichSystemPromptParts` exposes the stable prefix and `scene` split (cache breakpoint offset).
