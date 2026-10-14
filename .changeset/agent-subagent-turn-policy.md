---
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/runtime": patch
---

Add opt-in in-turn sub-agents (`ai.agent.subagentTurnMode: sync`) on the plugin-runtime turn path. Sub-agents inherit the parent turn policy, never wider (no bash unless the parent can run it); approvals go to the parent conversation and requester. DeferredWorkerRunner now offers no bash unless given a frozen turn policy snapshot.
