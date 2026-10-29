---
"@zhin.js/agent": patch
---

ADR 0042 §7/§8 (fewer rounds, measurement). Default `maxIterations` now depends on the scene: group chat 6, private chat 10, master private chat 15 (a `modelHarness` override or a customised `ai.agent.maxIterations` still wins; built-in per-model limits are never raised). When one iteration remains, the tool result tells the model to reply with what it has. A one-time hint fires when the same tool family is called 3 times in a row without new information (identical results, searches that match nothing, the same file re-read), recorded as `spin_hint` / `last_iteration_nudge` entries on the turn trace. The orchestration rule merges "send independent queries as parallel tool calls in one message" into the existing parallel `spawn_task` bullet (net size unchanged). Adds `pnpm eval:budget`: a deterministic offline first-turn token measurement (group first turn, group 6th turn, master private tool turn) with a committed baseline.
