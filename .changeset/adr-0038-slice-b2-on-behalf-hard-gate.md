---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/ai": patch
"@zhin.js/runtime": patch
---

ADR 0038 切片 B2：合并回合里有副作用的工具调用按 `onBehalfOf` 指向的发送者复核（缺省按权限最低者），不通过写 `merge_on_behalf_denied`；合并回合最多 1 张新审批卡；新增 `ai.agent.toolHardGate.maxPendingPerScene`（默认 3），每群待审卡超限 fail closed（`hard_gate_scene_pending_cap`）；群聊合流 `inboundQueue.merge.enabled` 默认改为开启。
