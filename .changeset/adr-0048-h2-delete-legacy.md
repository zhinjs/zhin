---
"@zhin.js/agent": patch
"@zhin.js/runtime": patch
"@zhin.js/service-activity-feedback": patch
"@zhin.js/workroom": patch
---

ADR 0048 H2: delete the sub-agent runtime, `spawn_task`, deferred workers, detached tasks, the standalone `AIService.createAgent` / `runAgent` / `createAgentSession` loop and the `ai.subagent.*` / `subagent_*` events. `ai.agent.subagentTurnMode`, `maxParallelSubagents`, `subagentAutoContinue`, `subagentDirectImDelivery`, `subagentTools`, `subagentTurnWaitMs`, `subagentExecApprovalMode`, `workerExecApprovalMode`, `workerBaseTools`, `deferredAutoContinue`, `deferredAutoContinueMaxDepth` and `ai.agents.<name>.permission.task` now fail startup with a migration hint; declare collaboration in `agents/<name>/agent.json` instead.
