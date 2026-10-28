---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Merged turns narrow permissions to every sender (ADR 0038 slice B1): when a group merge window answers several members in one turn, the tools, skills and sub-agents the model sees are the intersection of what each member sees on their own, and the turn's roles and permissions are intersected as well. Merging can only narrow what a turn may do, never widen it. `ai.agent.inboundQueue.merge.enabled` stays off by default until slice B2 (`onBehalfOf` review and approval-card limits).
